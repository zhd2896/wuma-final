"""Seat-token remote room lifecycle over the canonical game engine."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
import secrets

from backend.app.core.errors import ApiError
from backend.app.engine_adapter.node_worker import NodeEngineAdapter
from backend.app.schemas.game import GameReview, LegalMovesResponse, Move
from backend.app.services.game_service import GameService
from backend.app.schemas.remote import (CreateRoomRequest, JoinRoomRequest,
                                         MatchRoomRequest, PendingUndoResponse,
                                         RemoteMoveRequest, RemoteMoveResponse,
                                         RemoteOperationRequest, RemoteRoomResponse)
from backend.app.services.game_store import GameStore, StoredRemoteRoom


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


class RemoteService:
    def __init__(self, adapter: NodeEngineAdapter, store: GameStore, game_service: GameService):
        self.adapter = adapter
        self.store = store
        self.game_service = game_service

    @staticmethod
    def _new_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def _new_code() -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return "".join(secrets.choice(alphabet) for _ in range(8))

    @staticmethod
    def _seat(room: StoredRemoteRoom, token: str | None, user_id: str | None = None) -> str:
        if not token:
            raise ApiError("REMOTE_ACCESS_DENIED", "A room seat token is required")
        digest = token_hash(token)
        if hmac.compare_digest(room.host_token_hash, digest):
            seat, owner = "A", room.host_user_id
        elif room.guest_token_hash and hmac.compare_digest(room.guest_token_hash, digest):
            seat, owner = "B", room.guest_user_id
        else:
            raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")
        if user_id is not None and owner is not None and owner != user_id:
            raise ApiError("REMOTE_ACCESS_DENIED", "Seat belongs to another account")
        return seat

    async def _view(self, room: StoredRemoteRoom, token: str,
                    new_token: str | None = None, user_id: str | None = None) -> RemoteRoomResponse:
        seat = self._seat(room, token, user_id)
        game = await self.store.get_snapshot(room.game_id)
        status = room.status
        if status == "WAITING" and room.expires_at <= utc_now():
            status = "EXPIRED"
        if status == "PLAYING" and game.state.game_status == "FINISHED":
            status = "FINISHED"
        pending = await self.store.get_pending_remote_undo(room.game_id)
        pending_response = None
        if pending is not None:
            pending_response = PendingUndoResponse(
                id=pending.id, requester=pending.requester,
                responder=pending.responder, base_revision=pending.base_revision,
                anchor_turn=pending.anchor_turn, revert_count=pending.revert_count,
                status=pending.status,
            )
        return RemoteRoomResponse(game_id=room.game_id, seat=seat,
                                  account_bound=(room.host_user_id if seat == "A" else room.guest_user_id) is not None,
                                  room_status=status, invite_code=room.invite_code,
                                  public=room.public, expires_at=room.expires_at,
                                  version=game.version, ply_count=game.ply_count,
                                  state=game.state,
                                  token=new_token, pending_undo=pending_response)

    async def create(self, body: CreateRoomRequest, user_id: str | None = None) -> RemoteRoomResponse:
        state = await self.adapter.initialize("A")
        token = self._new_token()
        expires_at = utc_now() + timedelta(minutes=30)
        for _ in range(5):
            try:
                room = await self.store.create_remote_room(
                    state, token_hash(token), self._new_code(), body.device_id,
                    body.public, expires_at, user_id)
                return await self._view(room, token, token, user_id)
            except ApiError as error:
                if error.code != "REMOTE_CODE_CONFLICT":
                    raise
        raise ApiError("REMOTE_CODE_CONFLICT", "Could not allocate an invite code")

    async def join(self, body: JoinRoomRequest, user_id: str | None = None) -> RemoteRoomResponse:
        token = self._new_token()
        room = await self.store.join_remote_room(body.invite_code,
                                                  token_hash(token), body.device_id,
                                                  utc_now(), user_id)
        return await self._view(room, token, token, user_id)

    async def match(self, body: MatchRoomRequest, user_id: str | None = None) -> RemoteRoomResponse:
        state = await self.adapter.initialize("A")
        token = self._new_token()
        now = utc_now()
        for _ in range(5):
            try:
                room = await self.store.match_remote_room(
                    state, token_hash(token), self._new_code(), body.device_id,
                    now + timedelta(minutes=30), now, user_id)
                return await self._view(room, token, token, user_id)
            except ApiError as error:
                if error.code != "REMOTE_CODE_CONFLICT":
                    raise
        raise ApiError("REMOTE_CODE_CONFLICT", "Could not allocate an invite code")

    async def get(self, game_id: str, token: str | None, user_id: str | None = None) -> RemoteRoomResponse:
        room = await self.store.get_remote_room(game_id)
        return await self._view(room, token or "", user_id=user_id)

    async def cancel(self, game_id: str, token: str | None, user_id: str | None = None) -> RemoteRoomResponse:
        room = await self.store.get_remote_room(game_id)
        if self._seat(room, token, user_id) != "A":
            raise ApiError("REMOTE_ACCESS_DENIED", "Only the host can cancel")
        cancelled = await self.store.cancel_remote_room(game_id, token_hash(token or ""), user_id)
        return await self._view(cancelled, token or "", user_id=user_id)

    async def legal_moves(self, game_id: str, token: str | None,
                          from_node: str | None, user_id: str | None = None) -> LegalMovesResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            room = await self.store.get_remote_room(game_id)
            seat = self._seat(room, token, user_id)
            game = await self.store.get_snapshot(game_id)
            if room.status != "PLAYING" or game.state.game_status != "PLAYING":
                raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Room is not active")
            if await self.store.get_pending_remote_undo(game_id) is not None:
                raise ApiError("REMOTE_UNDO_PENDING", "An undo request is pending")
            if game.state.current_player != seat:
                raise ApiError("NOT_YOUR_TURN", "Wait for your turn")
            moves = await self.adapter.legal_moves(game.state)
            if from_node is not None:
                moves = [move for move in moves if move.from_node == from_node]
            return LegalMovesResponse(moves=moves)

    async def move(self, game_id: str, token: str | None,
                   body: RemoteMoveRequest, user_id: str | None = None) -> RemoteMoveResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            room = await self.store.get_remote_room(game_id)
            seat = self._seat(room, token, user_id)
            existing = await self.store.get_remote_move(game_id, body.client_request_id)
            move = Move(from_node=body.from_node, to_node=body.to_node)
            if existing is not None:
                if (existing.reverted_revision is not None or
                    existing.turn.before_state.current_player != seat or
                    existing.turn.move != move or
                    existing.created_revision - 1 != body.expected_version):
                    raise ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")
                return RemoteMoveResponse(version=existing.created_revision,
                                          ply_count=existing.turn_number,
                                          turn=existing.turn)
            if await self.store.get_pending_remote_undo(game_id) is not None:
                raise ApiError("REMOTE_UNDO_PENDING", "An undo request is pending")
            game = await self.store.get_snapshot(game_id)
            if room.status != "PLAYING":
                raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
            if game.state.game_status != "PLAYING":
                raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
            if game.version != body.expected_version:
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
            if game.state.current_player != seat:
                raise ApiError("NOT_YOUR_TURN", "Wait for your turn")
            turn = await self.adapter.execute_turn(game.state, move)
            stored = await self.store.commit_remote_turn(game_id, token_hash(token or ""),
                                                         body.expected_version,
                                                         body.client_request_id, turn, user_id)
            return RemoteMoveResponse(version=stored.created_revision,
                                      ply_count=stored.turn_number, turn=stored.turn)

    async def request_undo(self, game_id: str, token: str | None,
                           body: RemoteOperationRequest, user_id: str | None = None) -> RemoteRoomResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            room = await self.store.get_remote_room(game_id)
            self._seat(room, token, user_id)
            await self.store.create_remote_undo(
                game_id, token_hash(token or ""), body, user_id)
            return await self._view(room, token or "", user_id=user_id)

    async def resolve_undo(self, game_id: str, request_id: str,
                           token: str | None, body: RemoteOperationRequest,
                           action: str, user_id: str | None = None) -> RemoteRoomResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            room = await self.store.get_remote_room(game_id)
            self._seat(room, token, user_id)
            await self.store.resolve_remote_undo(
                game_id, request_id, token_hash(token or ""), body, action, user_id)
            return await self._view(room, token or "", user_id=user_id)

    async def resign(self, game_id: str, token: str | None,
                     body: RemoteOperationRequest, user_id: str | None = None) -> RemoteRoomResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            room = await self.store.get_remote_room(game_id)
            self._seat(room, token, user_id)
            await self.store.commit_remote_resign(
                game_id, token_hash(token or ""), body, user_id)
            return await self._view(room, token or "", user_id=user_id)

    async def get_review(self, game_id: str, token: str | None, user_id: str | None = None) -> GameReview:
        room = await self.store.get_remote_room(game_id)
        seat = self._seat(room, token, user_id)
        review = await self.game_service._get_review(game_id, seat, remote=True)
        await self.authorize(game_id, token, user_id)
        return review

    async def create_review(self, game_id: str, token: str | None, user_id: str | None = None) -> GameReview:
        room = await self.store.get_remote_room(game_id)
        seat = self._seat(room, token, user_id)
        review = await self.game_service._create_review(game_id, seat, remote=True,
            remote_user_id=user_id, remote_token_hash=token_hash(token or ""))
        await self.authorize(game_id, token, user_id)
        return review

    async def authorize(self, game_id: str, token: str | None, user_id: str | None) -> None:
        room = await self.store.get_remote_room(game_id)
        self._seat(room, token, user_id)

    async def recover(self, game_id: str, user_id: str | None,
                      claim_token: str | None = None, claim: bool = False) -> RemoteRoomResponse:
        if user_id is None:
            raise ApiError("AUTH_REQUIRED", "An account is required to recover a seat")
        if claim and not claim_token:
            raise ApiError("REMOTE_ACCESS_DENIED", "Original seat token is required")
        token = self._new_token()
        room = await self.store.recover_remote_room(game_id, user_id, token_hash(token),
            token_hash(claim_token) if claim else None)
        return await self._view(room, token, token, user_id)
