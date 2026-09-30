"""Transactional room and remote request persistence."""

import hmac
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import (GameMoveModel, GameTerminalEventModel,
                                   RemoteRoomModel, RemoteUndoRequestModel, utc_now)
from backend.app.db.repositories.game import GameRepository
from backend.app.db.repositories.move import MoveRepository
from backend.app.schemas.game import GameState, TurnResult
from backend.app.services.game_store import (StoredMove, StoredRemoteRoom,
                                             StoredRemoteUndoRequest)


class RemoteRepository:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def stored(row: RemoteRoomModel) -> StoredRemoteRoom:
        return StoredRemoteRoom(row.game_id, row.invite_code, row.host_token_hash,
                                row.guest_token_hash, row.host_device_id,
                                row.guest_device_id, row.public, row.status,
                                row.expires_at)

    def create(self, state: GameState, token_hash: str, code: str,
               device_id: str, public: bool,
               expires_at: datetime) -> StoredRemoteRoom:
        game_id = GameRepository(self.session).create_game(state, "REMOTE", None, None)
        room = RemoteRoomModel(game_id=game_id, invite_code=code,
                               host_token_hash=token_hash, guest_token_hash=None,
                               host_device_id=device_id, guest_device_id=None,
                               public=public, status="WAITING", expires_at=expires_at,
                               created_at=utc_now(), updated_at=utc_now())
        self.session.add(room)
        self.session.flush()
        return self.stored(room)

    def get(self, game_id: str, lock: bool = False) -> RemoteRoomModel:
        query = select(RemoteRoomModel).where(RemoteRoomModel.game_id == game_id)
        if lock:
            query = query.with_for_update()
        row = self.session.scalar(query)
        if row is None:
            raise ApiError("REMOTE_ROOM_NOT_FOUND", "Room not found")
        return row

    def join(self, code: str, token_hash: str, device_id: str,
             now: datetime) -> StoredRemoteRoom:
        row = self.session.scalar(select(RemoteRoomModel)
                                  .where(RemoteRoomModel.invite_code == code)
                                  .with_for_update())
        if row is None:
            raise ApiError("REMOTE_ROOM_NOT_FOUND", "Room not found")
        if row.status != "WAITING" or row.expires_at <= now:
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Room is no longer available")
        if row.host_device_id == device_id:
            raise ApiError("REMOTE_SELF_JOIN", "Use another device to join")
        row.guest_token_hash = token_hash
        row.guest_device_id = device_id
        row.status = "PLAYING"
        row.updated_at = utc_now()
        self.session.flush()
        return self.stored(row)

    def match(self, state: GameState, token_hash: str, code: str,
              device_id: str, expires_at: datetime,
              now: datetime) -> StoredRemoteRoom:
        row = self.session.scalar(select(RemoteRoomModel).where(
            RemoteRoomModel.public.is_(True), RemoteRoomModel.status == "WAITING",
            RemoteRoomModel.expires_at > now,
            RemoteRoomModel.host_device_id != device_id,
        ).order_by(RemoteRoomModel.created_at, RemoteRoomModel.game_id)
            .with_for_update(skip_locked=True).limit(1))
        if row is None:
            return self.create(state, token_hash, code, device_id, True, expires_at)
        row.guest_token_hash = token_hash
        row.guest_device_id = device_id
        row.status = "PLAYING"
        row.updated_at = utc_now()
        self.session.flush()
        return self.stored(row)

    def cancel(self, game_id: str, token_hash: str) -> StoredRemoteRoom:
        row = self.get(game_id, lock=True)
        if not hmac.compare_digest(row.host_token_hash, token_hash):
            raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")
        if row.status != "WAITING":
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Room is no longer waiting")
        row.status = "CANCELLED"
        row.updated_at = utc_now()
        self.session.flush()
        return self.stored(row)

    def get_move(self, game_id: str, request_id: str) -> StoredMove | None:
        row = self.session.scalar(select(GameMoveModel).where(
            GameMoveModel.game_id == game_id,
            GameMoveModel.client_request_id == request_id))
        return None if row is None else StoredMove(
            turn_number=row.turn_number, actor_type=row.actor_type,
            turn=TurnResult.model_validate(row.turn_result), search=None,
            game_move_id=row.id, created_revision=row.created_revision,
            reverted_revision=row.reverted_revision,
            client_request_id=row.client_request_id)

    @staticmethod
    def seat(room: RemoteRoomModel, token_hash: str) -> str:
        if hmac.compare_digest(room.host_token_hash, token_hash):
            return "A"
        if room.guest_token_hash and hmac.compare_digest(room.guest_token_hash, token_hash):
            return "B"
        raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")

    def get_undo(self, game_id: str, request_id: str,
                 lock: bool = False) -> RemoteUndoRequestModel | None:
        query = select(RemoteUndoRequestModel).where(
            RemoteUndoRequestModel.game_id == game_id,
            RemoteUndoRequestModel.id == request_id,
        )
        if lock:
            query = query.with_for_update()
        return self.session.scalar(query)

    def get_pending_undo(self, game_id: str) -> RemoteUndoRequestModel | None:
        return self.session.scalar(select(RemoteUndoRequestModel).where(
            RemoteUndoRequestModel.game_id == game_id,
            RemoteUndoRequestModel.status == "PENDING",
        ).with_for_update())

    def stored_undo(self, row: RemoteUndoRequestModel) -> StoredRemoteUndoRequest:
        return StoredRemoteUndoRequest(
            id=row.id, game_id=row.game_id, requester=row.requester,
            responder=row.responder,
            create_client_request_id=row.create_client_request_id,
            base_revision=row.base_revision, anchor_turn=row.anchor_turn,
            revert_count=row.revert_count, status=row.status,
            resolve_client_request_id=row.resolve_client_request_id,
            resolve_expected_version=row.resolve_expected_version,
            resolve_action=row.resolve_action,
        )

    def commit_turn(self, game_id: str, token_hash: str,
                    expected_version: int, request_id: str,
                    turn: TurnResult) -> StoredMove:
        games = GameRepository(self.session)
        game = games.get_game(game_id, lock=True)
        room = self.get(game_id, lock=True)
        seat = self.seat(room, token_hash)
        existing = self.get_move(game_id, request_id)
        if existing is not None:
            if (existing.reverted_revision is not None or
                existing.turn.before_state.current_player != seat or
                existing.turn.move != turn.move or
                existing.created_revision - 1 != expected_version):
                raise ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")
            return existing
        undo_request = self.session.scalar(select(RemoteUndoRequestModel.id).where(
            RemoteUndoRequestModel.game_id == game_id,
            (RemoteUndoRequestModel.create_client_request_id == request_id)
            | (RemoteUndoRequestModel.resolve_client_request_id == request_id),
        ))
        terminal_request = self.session.scalar(select(GameTerminalEventModel.id).where(
            GameTerminalEventModel.game_id == game_id,
            GameTerminalEventModel.client_request_id == request_id,
        ))
        if undo_request is not None or terminal_request is not None:
            raise ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")
        if room.status != "PLAYING":
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
        if self.get_pending_undo(game_id) is not None:
            raise ApiError("REMOTE_UNDO_PENDING", "An undo request is pending")
        if game.status != "PLAYING":
            raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
        if game.current_player != seat:
            raise ApiError("NOT_YOUR_TURN", "Wait for your turn")
        if game.version != expected_version or GameState.model_validate(game.current_state) != turn.before_state:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
        turn_number = game.ply_count + 1
        games.update_game_state(game, expected_version, turn.state)
        MoveRepository(self.session).create_move(
            game_id, turn_number, expected_version + 1,
            turn, "HUMAN", None, request_id)
        self.session.flush()
        saved = self.get_move(game_id, request_id)
        assert saved is not None
        return saved
