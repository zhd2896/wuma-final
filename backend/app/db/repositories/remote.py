"""Transactional room and remote request persistence."""

import hmac
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.errors import ApiError
from backend.app.db.models import GameMoveModel, RemoteRoomModel, utc_now
from backend.app.db.repositories.game import GameRepository
from backend.app.db.repositories.move import MoveRepository
from backend.app.schemas.game import GameState, TurnResult
from backend.app.services.game_store import StoredMove, StoredRemoteRoom


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
            row.turn_number, row.actor_type,
            TurnResult.model_validate(row.turn_result), None, row.id)

    def commit_turn(self, game_id: str, token_hash: str,
                    expected_version: int, request_id: str,
                    turn: TurnResult) -> StoredMove:
        room = self.get(game_id, lock=True)
        seat = "A" if hmac.compare_digest(room.host_token_hash, token_hash) else (
            "B" if room.guest_token_hash and
            hmac.compare_digest(room.guest_token_hash, token_hash) else None)
        if seat is None:
            raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")
        existing = self.get_move(game_id, request_id)
        if existing is not None:
            if (existing.turn.before_state.current_player != seat or
                existing.turn.move != turn.move or
                existing.turn_number - 1 != expected_version):
                raise ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")
            return existing
        if room.status != "PLAYING":
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
        games = GameRepository(self.session)
        game = games.get_game(game_id)
        if game.current_player != seat:
            raise ApiError("NOT_YOUR_TURN", "Wait for your turn")
        if game.version != expected_version or GameState.model_validate(game.current_state) != turn.before_state:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
        games.update_game_state(game, expected_version, turn.state)
        MoveRepository(self.session).create_move(game_id, expected_version + 1,
                                                 turn, "HUMAN", None, request_id)
        self.session.flush()
        saved = self.get_move(game_id, request_id)
        assert saved is not None
        return saved
