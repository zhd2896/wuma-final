"""MySQL unit of work: one versioned game update and move insert per transaction."""

import asyncio
import hashlib
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import create_engine, select, text, func, or_, and_, update, case
from sqlalchemy.exc import IntegrityError, SQLAlchemyError, OperationalError
from sqlalchemy.orm import sessionmaker

from backend.app.core.errors import ApiError
from backend.app.db.models import (AiAnalysisModel, CoachHintModel, GameModel, GameMoveModel,
                                    GameReviewModel, GameTerminalEventModel,
                                    GameUndoEventModel, MoveReviewModel,
                                    RemoteUndoRequestModel, RemoteRoomModel, ReviewExplanationModel, UserModel,
                                    TrainingRecordModel, AuthSessionModel, utc_now)
from backend.app.db.repositories.game import GameRepository
from backend.app.db.repositories.remote import RemoteRepository
from backend.app.db.repositories.move import MoveRepository
from backend.app.schemas.game import (
    GameOperationRequest, GameOperationResponse, GameReview, GameState, PositionAnalysis,
    SearchResult, TurnResult, ReviewConfig,
)
from backend.app.schemas.remote import RemoteOperationRequest
from backend.app.schemas.explanation import ExplanationBundle
from backend.app.schemas.coach import CoachHint
from backend.app.schemas.training import (TrainingAnswerResult, TrainingItemInternal,
                                          TrainingSource)
from backend.app.db.repositories.training import TrainingRepository
from backend.app.services.player_skill import SkillEvidence, calculate_skill_profile
from backend.app.services.game_store import (StoredGame, StoredMove, StoredRemoteRoom,
                                             StoredRemoteUndoRequest,
                                             StoredTerminalEvent)


class MySQLGameStore:
    def __init__(self, database_url: str):
        self.engine = create_engine(database_url, pool_pre_ping=True, isolation_level="REPEATABLE READ")
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    async def ping(self) -> None:
        await asyncio.to_thread(self._ping)

    async def register_device(self, token_hash: str) -> str:
        return await asyncio.to_thread(self._register_device, token_hash)

    def _register_device(self, token_hash: str) -> str:
        try:
            with self.sessions.begin() as session:
                user_id = uuid4().hex
                session.add(UserModel(id=user_id, external_user_id="device:" + token_hash,
                                      nickname="本机棋手"))
                session.flush()
                return user_id
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def login_wechat(self, identity: str, token_hash: str, expires_at: datetime,
                           device_hash: str | None = None) -> str:
        return await asyncio.to_thread(self._login_wechat, identity, token_hash, expires_at, device_hash)

    def _login_wechat(self, identity: str, token_hash: str, expires_at: datetime,
                      device_hash: str | None) -> str:
        # Unique external identity serializes competing first logins. Retry a fresh transaction
        # after duplicate-key or MySQL deadlock; all ownership changes remain atomic.
        for attempt in range(3):
            try:
                with self.sessions.begin() as session:
                    external = "wechat:" + hashlib.sha256(identity.encode()).hexdigest()
                    target = session.scalar(select(UserModel).where(
                        UserModel.external_user_id == external).with_for_update())
                    source = session.scalar(select(UserModel).where(
                        UserModel.external_user_id == "device:" + device_hash).with_for_update()) if device_hash else None
                    if target is None:
                        target = source or UserModel(id=uuid4().hex, nickname="微信棋手")
                        target.external_user_id = external
                        target.nickname = "微信棋手"
                        session.add(target)
                        session.flush()
                    if source is not None and source.id != target.id:
                        rooms = session.scalars(select(RemoteRoomModel).where(or_(
                            RemoteRoomModel.host_user_id == source.id,
                            RemoteRoomModel.guest_user_id == source.id)).with_for_update()).all()
                        if any(room.host_user_id == target.id or room.guest_user_id == target.id for room in rooms):
                            raise ApiError("REMOTE_ACCOUNT_CONFLICT", "Accounts occupy opposite seats; keep the original account")
                        for room in rooms:
                            if room.host_user_id == source.id:
                                room.host_user_id = target.id
                            if room.guest_user_id == source.id:
                                room.guest_user_id = target.id
                        session.execute(update(GameModel).where(GameModel.user_id == source.id).values(user_id=target.id))
                        session.execute(update(TrainingRecordModel).where(
                            TrainingRecordModel.user_id == source.id).values(user_id=target.id))
                        source.external_user_id = None
                    session.add(AuthSessionModel(token_hash=token_hash, user_id=target.id,
                        expires_at=expires_at.astimezone(timezone.utc).replace(tzinfo=None)))
                    session.flush()
                    return target.id
            except (IntegrityError, OperationalError) as exc:
                if attempt == 2:
                    raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc
            except SQLAlchemyError as exc:
                raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc
        raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed")

    async def resolve_device(self, token_hash: str) -> str | None:
        return await asyncio.to_thread(self._resolve_device, token_hash)

    def _resolve_device(self, token_hash: str) -> str | None:
        try:
            with self.sessions() as session:
                account = session.get(AuthSessionModel, token_hash)
                if account is not None:
                    return account.user_id if account.expires_at > utc_now() else None
                return session.scalar(select(UserModel.id).where(
                    UserModel.external_user_id == "device:" + token_hash))
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    @staticmethod
    def _personal_ownership(user_id):
        participant = select(RemoteRoomModel.game_id).where(or_(
            RemoteRoomModel.host_user_id == user_id, RemoteRoomModel.guest_user_id == user_id), or_(
            RemoteRoomModel.status.in_(("PLAYING", "FINISHED")),
            and_(RemoteRoomModel.status == "WAITING", RemoteRoomModel.expires_at > utc_now())))
        return or_(and_(GameModel.mode != "REMOTE", GameModel.user_id == user_id),
                   and_(GameModel.mode == "REMOTE", GameModel.id.in_(participant)))

    @staticmethod
    def _personal_seat(room, user_id):
        if room is None:
            return None
        return "A" if room.host_user_id == user_id else "B" if room.guest_user_id == user_id else None

    async def personal_games(self, user_id: str, limit: int,
                             cursor: tuple[datetime, str] | None,
                             status: str | None = None) -> tuple[list[dict], bool]:
        return await asyncio.to_thread(self._personal_games, user_id, limit, cursor, status)

    def _personal_games(self, user_id: str, limit: int,
                        cursor: tuple[datetime, str] | None,
                        status: str | None) -> tuple[list[dict], bool]:
        try:
            with self.sessions() as session:
                query = select(GameModel).where(self._personal_ownership(user_id))
                if status is not None:
                    query = query.where(GameModel.status == status)
                if cursor:
                    when, game_id = cursor
                    naive = when.astimezone(timezone.utc).replace(tzinfo=None)
                    query = query.where(or_(GameModel.created_at < naive,
                                            and_(GameModel.created_at == naive,
                                                 GameModel.id < game_id)))
                rows = session.scalars(query.order_by(GameModel.created_at.desc(),
                                                       GameModel.id.desc()).limit(limit + 1)).all()
                selected = rows[:limit]
                rooms = {room.game_id: room for room in session.scalars(select(RemoteRoomModel).where(
                    RemoteRoomModel.game_id.in_([row.id for row in selected]))).all()} if selected else {}
                reviews = set(session.execute(select(GameReviewModel.game_id, GameReviewModel.reviewed_player).where(
                    GameReviewModel.game_id.in_([row.id for row in selected]))).all()) if selected else set()
                result = []
                for row in selected:
                    result.append({"gameId": row.id, "mode": row.mode,
                                   "seat": self._personal_seat(rooms.get(row.id), user_id),
                                   "status": row.status, "winner": row.winner,
                                   "winnerReason": row.winner_reason,
                                   "startedAt": row.started_at.replace(tzinfo=timezone.utc).isoformat(),
                                   "finishedAt": row.finished_at.replace(tzinfo=timezone.utc).isoformat()
                                   if row.finished_at else None,
                                   "turns": row.ply_count,
                                   "reviewAvailable": any(game_id == row.id and (row.mode != "REMOTE" or player == self._personal_seat(rooms.get(row.id), user_id)) for game_id, player in reviews),
                                   "cursorDate": row.created_at.replace(tzinfo=timezone.utc).isoformat()})
                return result, len(rows) > limit
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def personal_profile(self, user_id: str) -> dict:
        return await asyncio.to_thread(self._personal_profile, user_id)

    def _personal_profile(self, user_id: str) -> dict:
        try:
            with self.sessions() as session:
                nickname = session.scalar(select(UserModel.nickname).where(UserModel.id == user_id))
                if nickname is None:
                    raise ApiError("AUTH_INVALID", "Account is unavailable")
                games = session.scalar(select(func.count()).select_from(GameModel).where(
                    self._personal_ownership(user_id))) or 0
                finished = session.scalar(select(func.count()).select_from(GameModel).where(
                    self._personal_ownership(user_id),
                    GameModel.status == "FINISHED")) or 0
                training_attempts = session.scalar(select(func.count()).select_from(TrainingRecordModel).where(
                    TrainingRecordModel.user_id == user_id)) or 0
                training = session.scalar(select(func.count(func.distinct(TrainingRecordModel.training_item_id))).where(
                    TrainingRecordModel.user_id == user_id, TrainingRecordModel.result == 'CORRECT')) or 0
                correct = session.scalar(select(func.count()).select_from(TrainingRecordModel).where(
                    TrainingRecordModel.user_id == user_id,
                    TrainingRecordModel.result == "CORRECT")) or 0
                wins, losses = session.execute(select(
                    func.coalesce(func.sum(case((and_(GameModel.winner.in_(['A', 'B']),
                        GameModel.winner != GameModel.ai_player), 1), else_=0)), 0),
                    func.coalesce(func.sum(case((GameModel.winner == GameModel.ai_player, 1), else_=0)), 0)
                ).where(
                    GameModel.user_id == user_id, GameModel.mode == "AI",
                    GameModel.status == "FINISHED")).one()
                wins, losses = int(wins), int(losses)
                categories = ['GOOD', 'NORMAL', 'MISTAKE', 'BLUNDER']
                # Inner join counts a review only when at least one human move exists.
                # The game/player/version unique key makes each game contribute once.
                evidence = session.execute(select(
                    func.count(func.distinct(GameReviewModel.game_id)), func.count(MoveReviewModel.id),
                    *(func.coalesce(func.sum(case((MoveReviewModel.category == category, 1), else_=0)), 0)
                      for category in categories),
                    func.coalesce(func.sum(case((MoveReviewModel.score_loss == 0, 1), else_=0)), 0),
                    func.coalesce(func.sum(MoveReviewModel.score_loss), 0))
                    .select_from(GameModel)
                    .join(GameReviewModel, GameReviewModel.game_id == GameModel.id)
                    .join(MoveReviewModel, MoveReviewModel.game_review_id == GameReviewModel.id)
                    .where(GameModel.user_id == user_id, GameModel.mode == 'AI', GameModel.status == 'FINISHED',
                           GameModel.ai_player.in_(['A', 'B']),
                           GameReviewModel.reviewed_player != GameModel.ai_player,
                           GameReviewModel.review_config_version == ReviewConfig().version,
                           MoveReviewModel.player == GameReviewModel.reviewed_player)).one()
                skill = calculate_skill_profile(SkillEvidence(
                    wins=int(wins), losses=int(losses), training_attempts=training_attempts, training_correct=correct,
                    reviewed_games=evidence[0], reviewed_moves=evidence[1], good_moves=int(evidence[2]),
                    normal_moves=int(evidence[3]), mistakes=int(evidence[4]), blunders=int(evidence[5]),
                    best_equivalent_moves=int(evidence[6]), score_loss_sum=float(evidence[7])))
                reviewed = session.scalar(select(func.count(func.distinct(GameReviewModel.game_id)))
                    .join(GameModel, GameModel.id == GameReviewModel.game_id)
                    .outerjoin(RemoteRoomModel, RemoteRoomModel.game_id == GameModel.id)
                    .where(self._personal_ownership(user_id), or_(GameModel.mode != "REMOTE",
                        and_(RemoteRoomModel.host_user_id == user_id, GameReviewModel.reviewed_player == "A"),
                        and_(RemoteRoomModel.guest_user_id == user_id, GameReviewModel.reviewed_player == "B")))) or 0
                remote = session.execute(select(GameModel.status, GameModel.winner,
                    RemoteRoomModel.host_user_id, RemoteRoomModel.guest_user_id)
                    .join(RemoteRoomModel, RemoteRoomModel.game_id == GameModel.id)
                    .where(GameModel.mode == "REMOTE", self._personal_ownership(user_id))).all()
                remote_wins = sum(status == "FINISHED" and winner == ("A" if host == user_id else "B")
                                  for status, winner, host, guest in remote)
                remote_losses = sum(status == "FINISHED" and winner in ("A", "B") and winner != ("A" if host == user_id else "B")
                                    for status, winner, host, guest in remote)
                return {"remoteGames": len(remote), "remoteWins": remote_wins, "remoteLosses": remote_losses,
                        "id": user_id, "nickname": nickname, "games": games,
                        "finishedGames": finished, "wins": wins, "losses": losses,
                        "reviewedGames": reviewed, "training": training, "trainingAttempts": training_attempts,
                        "correct": correct, "skillProfile": skill}
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    def _ping(self) -> None:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def lock_for(self, game_id: str) -> asyncio.Lock:
        # The database CAS is the concurrency guard; no unbounded game-id cache.
        return asyncio.Lock()

    @staticmethod
    def _require_active_owner(session, user_id: str | None) -> None:
        if user_id is None:
            return  # explicit unauthenticated test/legacy operations
        # Serialize owner-bearing writes against account migration. A request authenticated
        # before a merge must not create inaccessible records under the retired source.
        owner = session.scalar(select(UserModel).where(UserModel.id == user_id).with_for_update())
        if owner is None or owner.external_user_id is None:
            raise ApiError("AUTH_INVALID", "Account was migrated; login again")

    async def create(self, state: GameState, mode: str = "LOCAL",
                     ai_player: str | None = None, ai_level: str | None = None,
                     user_id: str | None = None) -> str:
        return await asyncio.to_thread(self._create, state, mode, ai_player, ai_level, user_id)

    def _create(self, state: GameState, mode: str,
                ai_player: str | None, ai_level: str | None, user_id: str | None) -> str:
        try:
            with self.sessions.begin() as session:
                self._require_active_owner(session, user_id)
                return GameRepository(session).create_game(state, mode, ai_player, ai_level, user_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_snapshot(self, game_id: str) -> StoredGame:
        return await asyncio.to_thread(self._get_snapshot, game_id)

    def _get_snapshot(self, game_id: str) -> StoredGame:
        try:
            with self.sessions() as session:
                return GameRepository(session).get_snapshot(game_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                          actor_type: str, search: SearchResult | None = None) -> None:
        await asyncio.to_thread(self._commit_turn, game_id, expected_version, turn, actor_type, search)

    def _commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                     actor_type: str, search: SearchResult | None) -> None:
        try:
            with self.sessions.begin() as session:
                games = GameRepository(session)
                row = games.get_game(game_id, lock=True)
                if row.version != expected_version or GameState.model_validate(row.current_state) != turn.before_state:
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move")
                turn_number = row.ply_count + 1
                games.update_game_state(row, expected_version, turn.state)
                MoveRepository(session).create_move(
                    game_id, turn_number, expected_version + 1, turn, actor_type, search)
                session.flush()
        except IntegrityError as exc:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move") from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def list_moves(self, game_id: str) -> list[StoredMove]:
        return await asyncio.to_thread(self._list_moves, game_id)

    def _list_moves(self, game_id: str) -> list[StoredMove]:
        try:
            with self.sessions() as session:
                GameRepository(session).get_game(game_id)
                return MoveRepository(session).list_moves(game_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]:
        return await asyncio.to_thread(self._read_replay, game_id)

    def _read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]:
        try:
            # One InnoDB repeatable-read transaction keeps the header and turns consistent.
            with self.sessions.begin() as session:
                snapshot = GameRepository(session).get_snapshot(game_id)
                moves = MoveRepository(session).list_moves(game_id)
                return snapshot, moves
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_terminal_event(self, game_id: str) -> StoredTerminalEvent | None:
        return await asyncio.to_thread(self._get_terminal_event, game_id)

    def _get_terminal_event(self, game_id: str) -> StoredTerminalEvent | None:
        try:
            with self.sessions() as session:
                GameRepository(session).get_game(game_id)
                return GameRepository(session).get_terminal_event(game_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_undo(self, game_id: str,
                          request: GameOperationRequest) -> GameOperationResponse:
        return await asyncio.to_thread(self._commit_undo, game_id, request)

    @staticmethod
    def _operation_conflict() -> ApiError:
        return ApiError("OPERATION_REQUEST_CONFLICT", "Request ID already used")

    @staticmethod
    def _remote_request_conflict() -> ApiError:
        return ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")

    @staticmethod
    def _set_locked_game_state(row: GameModel, state: GameState,
                               version: int, ply_count: int) -> None:
        now = utc_now()
        finished = state.game_status == "FINISHED"
        row.current_state = state.model_dump(mode="json")
        row.current_player = state.current_player
        row.status = state.game_status
        row.winner = state.winner
        row.winner_reason = state.winner_reason
        row.version = version
        row.ply_count = ply_count
        row.updated_at = now
        row.finished_at = now if finished else None
        row.duration_ms = (int((now - row.started_at).total_seconds() * 1000)
                           if finished else None)

    @staticmethod
    def _validate_operation(row: GameModel, request: GameOperationRequest) -> None:
        if row.status != "PLAYING":
            raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
        if row.version != request.expected_version:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the operation")

    def _commit_undo(self, game_id: str,
                     request: GameOperationRequest) -> GameOperationResponse:
        try:
            with self.sessions.begin() as session:
                games = GameRepository(session)
                row = games.get_game(game_id, lock=True)
                if row.mode == "REMOTE":
                    raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
                existing = session.scalar(select(GameUndoEventModel).where(
                    GameUndoEventModel.game_id == game_id,
                    GameUndoEventModel.client_request_id == request.client_request_id,
                ))
                terminal = session.scalar(select(GameTerminalEventModel).where(
                    GameTerminalEventModel.game_id == game_id,
                    GameTerminalEventModel.client_request_id == request.client_request_id,
                ))
                if terminal is not None:
                    raise self._operation_conflict()
                if existing is not None:
                    if existing.before_revision != request.expected_version:
                        raise self._operation_conflict()
                    return GameOperationResponse(
                        version=existing.after_revision,
                        ply_count=existing.anchor_turn - 1,
                        state=GameState.model_validate(existing.state_after),
                        reverted_turns=existing.reverted_count,
                    )
                self._validate_operation(row, request)
                moves = MoveRepository(session)
                active = moves.active_rows(game_id)
                candidates = (active if row.mode == "LOCAL" else
                              [item for item in active if item.actor_type == "HUMAN"])
                if not candidates:
                    raise ApiError("UNDO_NOT_AVAILABLE", "No move is available to undo")
                anchor = candidates[-1]
                restored = GameState.model_validate(anchor.state_before)
                requester = (("B" if row.ai_player == "A" else "A")
                             if row.mode == "AI" else
                             GameState.model_validate(row.current_state).current_player)
                revision = row.version + 1
                reverted_count = moves.revert_from(game_id, anchor.turn_number, revision)
                self._set_locked_game_state(
                    row, restored, revision, anchor.turn_number - 1)
                session.add(GameUndoEventModel(
                    game_id=game_id,
                    client_request_id=request.client_request_id,
                    requester=requester,
                    before_revision=request.expected_version,
                    after_revision=revision,
                    anchor_turn=anchor.turn_number,
                    reverted_count=reverted_count,
                    state_after=restored.model_dump(mode="json"),
                    created_at=utc_now(),
                ))
                session.flush()
                return GameOperationResponse(
                    version=revision, ply_count=anchor.turn_number - 1,
                    state=restored, reverted_turns=reverted_count)
        except IntegrityError as exc:
            raise self._operation_conflict() from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_resign(self, game_id: str,
                            request: GameOperationRequest) -> GameOperationResponse:
        return await asyncio.to_thread(self._commit_resign, game_id, request)

    def _commit_resign(self, game_id: str,
                       request: GameOperationRequest) -> GameOperationResponse:
        try:
            with self.sessions.begin() as session:
                row = GameRepository(session).get_game(game_id, lock=True)
                if row.mode == "REMOTE":
                    raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
                undo = session.scalar(select(GameUndoEventModel).where(
                    GameUndoEventModel.game_id == game_id,
                    GameUndoEventModel.client_request_id == request.client_request_id,
                ))
                terminal = session.scalar(select(GameTerminalEventModel).where(
                    GameTerminalEventModel.game_id == game_id,
                    GameTerminalEventModel.client_request_id == request.client_request_id,
                ))
                if undo is not None:
                    raise self._operation_conflict()
                if terminal is not None:
                    if (terminal.event_type != "RESIGN"
                            or terminal.revision - 1 != request.expected_version):
                        raise self._operation_conflict()
                    return GameOperationResponse(
                        version=terminal.revision, ply_count=row.ply_count,
                        state=GameState.model_validate(terminal.state_after))
                self._validate_operation(row, request)
                before = GameState.model_validate(row.current_state)
                loser = (("B" if row.ai_player == "A" else "A")
                         if row.mode == "AI" else before.current_player)
                winner = "B" if loser == "A" else "A"
                after = before.model_copy(deep=True, update={
                    "game_status": "FINISHED", "winner": winner,
                    "winner_reason": "RESIGN",
                })
                revision = row.version + 1
                self._set_locked_game_state(row, after, revision, row.ply_count)
                session.add(GameTerminalEventModel(
                    game_id=game_id,
                    client_request_id=request.client_request_id,
                    revision=revision, event_type="RESIGN", actor=loser,
                    winner=winner,
                    state_before=before.model_dump(mode="json"),
                    state_after=after.model_dump(mode="json"),
                    created_at=utc_now(),
                ))
                session.flush()
                return GameOperationResponse(
                    version=revision, ply_count=row.ply_count, state=after)
        except IntegrityError as exc:
            raise self._operation_conflict() from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    def close(self) -> None:
        self.engine.dispose()

    async def create_remote_room(self, state: GameState, token_hash: str, code: str,
                                 device_id: str, public: bool,
                                 expires_at, user_id: str | None = None) -> StoredRemoteRoom:
        return await asyncio.to_thread(self._create_remote_room, state, token_hash, code,
                                       device_id, public, expires_at, user_id)

    def _create_remote_room(self, state, token_hash, code, device_id, public, expires_at, user_id=None):
        try:
            with self.sessions.begin() as session:
                self._require_active_owner(session, user_id)
                return RemoteRepository(session).create(state, token_hash, code,
                                                        device_id, public, expires_at, user_id)
        except IntegrityError as exc:
            raise ApiError("REMOTE_CODE_CONFLICT", "Invite code already exists") from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def join_remote_room(self, code: str, token_hash: str,
                               device_id: str, now, user_id: str | None = None) -> StoredRemoteRoom:
        return await asyncio.to_thread(self._join_remote_room, code, token_hash, device_id, now, user_id)

    def _join_remote_room(self, code, token_hash, device_id, now, user_id=None):
        try:
            with self.sessions.begin() as session:
                self._require_active_owner(session, user_id)
                return RemoteRepository(session).join(code, token_hash, device_id, now, user_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def match_remote_room(self, state: GameState, token_hash: str, code: str,
                                device_id: str, expires_at, now, user_id: str | None = None) -> StoredRemoteRoom:
        return await asyncio.to_thread(self._match_remote_room, state, token_hash, code,
                                       device_id, expires_at, now, user_id)

    def _match_remote_room(self, state, token_hash, code, device_id, expires_at, now, user_id=None):
        try:
            # Serialize the empty-queue case across server processes: row locks alone
            # cannot prevent two first-time callers from creating separate rooms.
            with self.engine.connect() as connection:
                acquired = connection.scalar(text("SELECT GET_LOCK('wuma_remote_match', 10)"))
                connection.commit()
                if acquired != 1:
                    raise ApiError("DATABASE_UNAVAILABLE", "Matchmaking is busy")
                try:
                    with connection.begin():
                        with self.sessions(bind=connection) as session:
                            self._require_active_owner(session, user_id)
                            room = RemoteRepository(session).match(
                                state, token_hash, code, device_id, expires_at, now, user_id)
                            session.commit()
                            return room
                finally:
                    connection.execute(text("SELECT RELEASE_LOCK('wuma_remote_match')"))
                    connection.commit()
        except IntegrityError as exc:
            raise ApiError("REMOTE_CODE_CONFLICT", "Invite code already exists") from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def recover_remote_room(self, game_id: str, user_id: str, new_token_hash: str,
                                  claim_token_hash: str | None = None) -> StoredRemoteRoom:
        return await asyncio.to_thread(self._recover_remote_room, game_id, user_id,
                                       new_token_hash, claim_token_hash)

    def _recover_remote_room(self, game_id, user_id, new_token_hash, claim_token_hash=None):
        try:
            with self.sessions.begin() as session:
                self._require_active_owner(session, user_id)
                return RemoteRepository(session).recover(game_id, user_id, new_token_hash, claim_token_hash)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_remote_room(self, game_id: str) -> StoredRemoteRoom:
        return await asyncio.to_thread(self._get_remote_room, game_id)

    def _get_remote_room(self, game_id):
        try:
            with self.sessions() as session:
                return RemoteRepository.stored(RemoteRepository(session).get(game_id))
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    def _require_remote_account(self, session, game_id, token_hash, user_id):
        self._require_active_owner(session, user_id)
        if user_id is None:
            return
        remote = RemoteRepository(session)
        room = remote.get(game_id, lock=True)
        seat = remote.seat(room, token_hash)
        owner = room.host_user_id if seat == "A" else room.guest_user_id
        if owner is not None and owner != user_id:
            raise ApiError("REMOTE_ACCESS_DENIED", "Seat belongs to another account")

    async def cancel_remote_room(self, game_id: str,
                                 token_hash: str, user_id: str | None = None) -> StoredRemoteRoom:
        return await asyncio.to_thread(self._cancel_remote_room, game_id, token_hash, user_id)

    def _cancel_remote_room(self, game_id, token_hash, user_id: str | None = None):
        try:
            with self.sessions.begin() as session:
                self._require_remote_account(session, game_id, token_hash, user_id)
                return RemoteRepository(session).cancel(game_id, token_hash)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_remote_move(self, game_id: str,
                              request_id: str) -> StoredMove | None:
        return await asyncio.to_thread(self._get_remote_move, game_id, request_id)

    def _get_remote_move(self, game_id, request_id):
        try:
            with self.sessions() as session:
                return RemoteRepository(session).get_move(game_id, request_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_remote_turn(self, game_id: str, token_hash: str,
                                 expected_version: int, request_id: str,
                                 turn: TurnResult, user_id: str | None = None) -> StoredMove:
        return await asyncio.to_thread(self._commit_remote_turn, game_id, token_hash,
                                       expected_version, request_id, turn, user_id)

    def _commit_remote_turn(self, game_id, token_hash, expected_version, request_id, turn, user_id: str | None = None):
        try:
            with self.sessions.begin() as session:
                self._require_remote_account(session, game_id, token_hash, user_id)
                return RemoteRepository(session).commit_turn(game_id, token_hash,
                                                              expected_version, request_id, turn)
        except IntegrityError as exc:
            raise self._remote_request_conflict() from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_pending_remote_undo(self,
                                      game_id: str) -> StoredRemoteUndoRequest | None:
        return await asyncio.to_thread(self._get_pending_remote_undo, game_id)

    def _get_pending_remote_undo(self, game_id: str) -> StoredRemoteUndoRequest | None:
        try:
            with self.sessions.begin() as session:
                remote = RemoteRepository(session)
                remote.get(game_id)
                row = remote.get_pending_undo(game_id)
                return None if row is None else remote.stored_undo(row)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def create_remote_undo(self, game_id: str, token_hash: str,
                                 request: RemoteOperationRequest, user_id: str | None = None) -> StoredRemoteUndoRequest:
        return await asyncio.to_thread(
            self._create_remote_undo, game_id, token_hash, request, user_id)

    @staticmethod
    def _remote_operation_use(session, game_id: str,
                              client_request_id: str) -> tuple[str, object] | None:
        move = session.scalar(select(GameMoveModel).where(
            GameMoveModel.game_id == game_id,
            GameMoveModel.client_request_id == client_request_id,
        ))
        if move is not None:
            return "MOVE", move
        created = session.scalar(select(RemoteUndoRequestModel).where(
            RemoteUndoRequestModel.game_id == game_id,
            RemoteUndoRequestModel.create_client_request_id == client_request_id,
        ))
        if created is not None:
            return "CREATE_UNDO", created
        resolved = session.scalar(select(RemoteUndoRequestModel).where(
            RemoteUndoRequestModel.game_id == game_id,
            RemoteUndoRequestModel.resolve_client_request_id == client_request_id,
        ))
        if resolved is not None:
            return "RESOLVE_UNDO", resolved
        terminal = session.scalar(select(GameTerminalEventModel).where(
            GameTerminalEventModel.game_id == game_id,
            GameTerminalEventModel.client_request_id == client_request_id,
        ))
        return None if terminal is None else ("RESIGN", terminal)

    def _create_remote_undo(self, game_id: str, token_hash: str,
                            request: RemoteOperationRequest, user_id: str | None = None) -> StoredRemoteUndoRequest:
        try:
            with self.sessions.begin() as session:
                self._require_remote_account(session, game_id, token_hash, user_id)
                game = GameRepository(session).get_game(game_id, lock=True)
                remote = RemoteRepository(session)
                room = remote.get(game_id, lock=True)
                seat = remote.seat(room, token_hash)
                use = self._remote_operation_use(
                    session, game_id, request.client_request_id)
                if use is not None:
                    kind, row = use
                    if (kind == "CREATE_UNDO"
                            and row.base_revision == request.expected_version
                            and row.requester == seat):
                        return remote.stored_undo(row)
                    raise self._remote_request_conflict()
                if room.status != "PLAYING":
                    raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
                if game.status != "PLAYING":
                    raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
                if game.version != request.expected_version:
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
                if remote.get_pending_undo(game_id) is not None:
                    raise ApiError("REMOTE_UNDO_PENDING", "An undo request is already pending")
                active = MoveRepository(session).active_rows(game_id)
                candidates = [move for move in active if move.player == seat]
                if not candidates:
                    raise ApiError("UNDO_NOT_AVAILABLE", "No move is available to undo")
                anchor = candidates[-1]
                row = RemoteUndoRequestModel(
                    id=uuid4().hex, game_id=game_id,
                    requester=seat, responder="B" if seat == "A" else "A",
                    create_client_request_id=request.client_request_id,
                    resolve_client_request_id=None,
                    resolve_expected_version=None, resolve_action=None,
                    base_revision=game.version, anchor_turn=anchor.turn_number,
                    revert_count=sum(
                        move.turn_number >= anchor.turn_number for move in active),
                    status="PENDING", created_at=utc_now(), resolved_at=None,
                )
                session.add(row)
                session.flush()
                return remote.stored_undo(row)
        except IntegrityError as exc:
            raise self._remote_request_conflict() from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def resolve_remote_undo(self, game_id: str, request_id: str,
                                  token_hash: str, request: RemoteOperationRequest,
                                  action: str, user_id: str | None = None) -> StoredRemoteUndoRequest:
        item, stale = await asyncio.to_thread(
            self._resolve_remote_undo, game_id, request_id,
            token_hash, request, action, user_id)
        if stale:
            raise ApiError("GAME_STATE_CONFLICT", "Undo request is stale")
        return item

    def _resolve_remote_undo(self, game_id: str, request_id: str,
                             token_hash: str, request: RemoteOperationRequest,
                             action: str, user_id: str | None = None) -> tuple[StoredRemoteUndoRequest, bool]:
        if action not in {"ACCEPT", "DECLINE"}:
            raise ValueError(f"Unsupported remote undo action: {action}")
        try:
            with self.sessions.begin() as session:
                self._require_remote_account(session, game_id, token_hash, user_id)
                game = GameRepository(session).get_game(game_id, lock=True)
                remote = RemoteRepository(session)
                room = remote.get(game_id, lock=True)
                seat = remote.seat(room, token_hash)
                target = remote.get_undo(game_id, request_id, lock=True)
                use = self._remote_operation_use(
                    session, game_id, request.client_request_id)
                if use is not None:
                    kind, existing = use
                    if (kind == "RESOLVE_UNDO" and existing.id == request_id
                            and existing.responder == seat
                            and existing.resolve_expected_version == request.expected_version
                            and existing.resolve_action == action):
                        item = remote.stored_undo(existing)
                        return item, existing.status == "STALE"
                    raise self._remote_request_conflict()
                if target is None:
                    raise ApiError("REMOTE_UNDO_NOT_FOUND", "Undo request not found")
                if game.status != "PLAYING":
                    raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
                if seat != target.responder:
                    raise ApiError("REMOTE_ACCESS_DENIED", "Only the opponent can respond")
                if target.status != "PENDING":
                    raise ApiError("REMOTE_UNDO_UNAVAILABLE", "Undo request is no longer pending")
                if request.expected_version != target.base_revision:
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
                active = MoveRepository(session).active_rows(game_id)
                anchor = next((move for move in active
                               if move.turn_number == target.anchor_turn), None)
                active_revert_count = sum(
                    move.turn_number >= target.anchor_turn for move in active)
                stale = (game.version != target.base_revision or anchor is None
                         or anchor.player != target.requester
                         or active_revert_count != target.revert_count)
                target.resolve_client_request_id = request.client_request_id
                target.resolve_expected_version = request.expected_version
                target.resolve_action = action
                target.resolved_at = utc_now()
                if stale:
                    target.status = "STALE"
                elif action == "ACCEPT":
                    revision = game.version + 1
                    MoveRepository(session).revert_from(
                        game_id, target.anchor_turn, revision)
                    restored = GameState.model_validate(anchor.state_before)
                    self._set_locked_game_state(
                        game, restored, revision, target.anchor_turn - 1)
                    target.status = "ACCEPTED"
                else:
                    target.status = "DECLINED"
                session.flush()
                item = StoredRemoteUndoRequest(
                    id=target.id, game_id=target.game_id,
                    requester=target.requester, responder=target.responder,
                    create_client_request_id=target.create_client_request_id,
                    base_revision=target.base_revision,
                    anchor_turn=target.anchor_turn,
                    revert_count=target.revert_count,
                    status=target.status,
                    resolve_client_request_id=target.resolve_client_request_id,
                    resolve_expected_version=target.resolve_expected_version,
                    resolve_action=target.resolve_action,
                )
                return item, stale
        except IntegrityError as exc:
            raise self._remote_request_conflict() from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_remote_resign(self, game_id: str, token_hash: str,
                                   request: RemoteOperationRequest, user_id: str | None = None) -> StoredTerminalEvent:
        return await asyncio.to_thread(
            self._commit_remote_resign, game_id, token_hash, request, user_id)

    def _commit_remote_resign(self, game_id: str, token_hash: str,
                              request: RemoteOperationRequest, user_id: str | None = None) -> StoredTerminalEvent:
        try:
            with self.sessions.begin() as session:
                self._require_remote_account(session, game_id, token_hash, user_id)
                game = GameRepository(session).get_game(game_id, lock=True)
                remote = RemoteRepository(session)
                room = remote.get(game_id, lock=True)
                seat = remote.seat(room, token_hash)
                use = self._remote_operation_use(
                    session, game_id, request.client_request_id)
                if use is not None:
                    kind, existing = use
                    if (kind == "RESIGN" and existing.actor == seat
                            and existing.revision - 1 == request.expected_version):
                        return StoredTerminalEvent(
                            game_id=existing.game_id,
                            client_request_id=existing.client_request_id,
                            revision=existing.revision,
                            event_type=existing.event_type,
                            actor=existing.actor, winner=existing.winner,
                            state_before=GameState.model_validate(existing.state_before),
                            state_after=GameState.model_validate(existing.state_after),
                            terminal_event_id=existing.id,
                        )
                    raise self._remote_request_conflict()
                if room.status != "PLAYING":
                    raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
                if game.status != "PLAYING":
                    raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
                if game.version != request.expected_version:
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
                before = GameState.model_validate(game.current_state)
                winner = "B" if seat == "A" else "A"
                after = before.model_copy(deep=True, update={
                    "game_status": "FINISHED", "winner": winner,
                    "winner_reason": "RESIGN",
                })
                revision = game.version + 1
                self._set_locked_game_state(game, after, revision, game.ply_count)
                pending = remote.get_pending_undo(game_id)
                if pending is not None:
                    pending.status = "STALE"
                    pending.resolved_at = utc_now()
                event = GameTerminalEventModel(
                    game_id=game_id,
                    client_request_id=request.client_request_id,
                    revision=revision, event_type="RESIGN",
                    actor=seat, winner=winner,
                    state_before=before.model_dump(mode="json"),
                    state_after=after.model_dump(mode="json"),
                    created_at=utc_now(),
                )
                session.add(event)
                session.flush()
                return StoredTerminalEvent(
                    game_id=game_id,
                    client_request_id=request.client_request_id,
                    revision=revision, event_type="RESIGN",
                    actor=seat, winner=winner,
                    state_before=before, state_after=after,
                    terminal_event_id=event.id,
                )
        except IntegrityError as exc:
            raise self._remote_request_conflict() from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_analysis(self, game_id: str, expected_version: int,
                              analysis: PositionAnalysis) -> None:
        await asyncio.to_thread(self._commit_analysis, game_id, expected_version, analysis)

    def _commit_analysis(self, game_id: str, expected_version: int,
                         analysis: PositionAnalysis) -> None:
        try:
            with self.sessions.begin() as session:
                row = session.scalar(select(GameModel).where(GameModel.id == game_id).with_for_update())
                if row is None:
                    raise ApiError("GAME_NOT_FOUND", "Game not found")
                if row.version != expected_version or row.status != "PLAYING":
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry analysis")
                session.add(AiAnalysisModel(
                    game_id=game_id, game_version=expected_version,
                    analyzed_player=analysis.analyzedPlayer,
                    best_move=analysis.bestMove.model_dump(by_alias=True) if analysis.bestMove else None,
                    best_score=analysis.bestScore, score_perspective=analysis.scorePerspective,
                    evaluation_before=analysis.evaluationBefore.model_dump(mode="json"),
                    evaluation_breakdown=analysis.evaluationBreakdown.model_dump(mode="json"),
                    candidate_moves=[item.model_dump(mode="json", by_alias=True)
                                     for item in analysis.candidateMoves],
                    threats=[item.model_dump(mode="json", by_alias=True) for item in analysis.threats],
                    search_depth=analysis.searchDepth, nodes_searched=analysis.nodesSearched,
                    thinking_time_ms=analysis.thinkingTimeMs, algorithm=analysis.algorithm,
                    tt_hits=analysis.ttHits, timed_out=analysis.timedOut,
                    terminal=analysis.terminal, winner=analysis.winner,
                    winner_reason=analysis.winnerReason,
                ))
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_review(self, game_id: str, player: str, version: int) -> GameReview | None:
        return await asyncio.to_thread(self._get_review, game_id, player, version)

    @staticmethod
    def _read_review(session, game_id: str, player: str, version: int) -> GameReview | None:
        row = session.scalar(select(GameReviewModel).where(
            GameReviewModel.game_id == game_id,
            GameReviewModel.reviewed_player == player,
            GameReviewModel.review_config_version == version))
        if row is None:
            return None
        moves = session.scalars(select(MoveReviewModel).where(
            MoveReviewModel.game_review_id == row.id).order_by(MoveReviewModel.turn_number)).all()
        return GameReview.model_validate({
            "id": row.id, "gameId": row.game_id, "reviewedPlayer": row.reviewed_player,
            "overallScore": row.overall_score, "goodMoves": row.good_moves,
            "normalMoves": row.normal_moves, "mistakes": row.mistakes,
            "blunders": row.blunders, "bestMoveRate": row.best_move_rate,
            "turningPoints": row.turning_points, "winner": row.winner,
            "winnerReason": row.winner_reason, "reviewConfig": row.review_config,
            "reviewConfigVersion": row.review_config_version,
            "moveReviews": [move.analysis for move in moves],
            "createdAt": row.created_at.replace(tzinfo=timezone.utc),
        })

    def _get_review(self, game_id: str, player: str, version: int) -> GameReview | None:
        try:
            with self.sessions() as session:
                GameRepository(session).get_game(game_id)
                return self._read_review(session, game_id, player, version)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_review(self, review: GameReview, expected_version: int,
                            user_id: str | None = None, remote_token_hash: str | None = None) -> GameReview:
        return await asyncio.to_thread(self._commit_review, review, expected_version, user_id, remote_token_hash)

    def _commit_review(self, review: GameReview, expected_version: int,
                       user_id: str | None = None, remote_token_hash: str | None = None) -> GameReview:
        try:
            with self.sessions.begin() as session:
                if remote_token_hash is not None:
                    self._require_remote_account(session, review.gameId, remote_token_hash, user_id)
                    remote = RemoteRepository(session)
                    if remote.seat(remote.get(review.gameId, lock=True), remote_token_hash) != review.reviewedPlayer:
                        raise ApiError("REMOTE_ACCESS_DENIED", "Review belongs to another seat")
                row = session.scalar(select(GameModel).where(
                    GameModel.id == review.gameId).with_for_update())
                if row is None:
                    raise ApiError("GAME_NOT_FOUND", "Game not found")
                if row.version != expected_version or row.status != "FINISHED":
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed during review")
                existing = self._read_review(session, review.gameId,
                                             review.reviewedPlayer, review.reviewConfigVersion)
                if existing is not None:
                    return existing
                session.add(GameReviewModel(
                    id=review.id, game_id=review.gameId,
                    reviewed_player=review.reviewedPlayer, overall_score=review.overallScore,
                    good_moves=review.goodMoves, normal_moves=review.normalMoves,
                    mistakes=review.mistakes, blunders=review.blunders,
                    best_move_rate=review.bestMoveRate, turning_points=review.turningPoints,
                    winner=review.winner, winner_reason=review.winnerReason,
                    review_config=review.reviewConfig.model_dump(mode="json"),
                    review_config_version=review.reviewConfigVersion,
                    created_at=review.createdAt.replace(tzinfo=None),
                ))
                for move in review.moveReviews:
                    session.add(MoveReviewModel(
                        game_review_id=review.id, game_move_id=move.gameMoveId,
                        turn_number=move.turn, player=move.player,
                        actual_move=move.actualMove.model_dump(mode="json", by_alias=True),
                        best_move=move.bestMove.model_dump(mode="json", by_alias=True),
                        score_before=move.scoreBefore, score_after=move.scoreAfter,
                        best_score=move.bestScore, actual_move_score=move.actualMoveScore,
                        score_loss=move.scoreLoss, category=move.category,
                        evaluation_before=move.evaluationBefore.model_dump(mode="json"),
                        evaluation_after=move.evaluationAfter.model_dump(mode="json"),
                        candidate_moves=[item.model_dump(mode="json", by_alias=True)
                                         for item in move.bestCandidateMoves],
                        threats=[item.model_dump(mode="json", by_alias=True)
                                 for item in move.threatsBefore],
                        engine_explanation=move.engineExplanation,
                        search_depth=move.searchDepth, timed_out=move.timedOut,
                        analysis=move.model_dump(mode="json", by_alias=True),
                        created_at=review.createdAt.replace(tzinfo=None),
                    ))
                session.flush()
                return review
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        return await asyncio.to_thread(self._get_explanation, review_id, prompt_version)

    @staticmethod
    def _read_explanation(session, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        row = session.scalar(select(ReviewExplanationModel).where(
            ReviewExplanationModel.game_review_id == review_id,
            ReviewExplanationModel.prompt_version == prompt_version))
        return ExplanationBundle.model_validate(row.payload) if row is not None else None

    def _get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        try:
            with self.sessions() as session:
                return self._read_explanation(session, review_id, prompt_version)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_explanation(self, bundle: ExplanationBundle) -> ExplanationBundle:
        return await asyncio.to_thread(self._commit_explanation, bundle)

    def _commit_explanation(self, bundle: ExplanationBundle) -> ExplanationBundle:
        try:
            with self.sessions.begin() as session:
                parent = session.scalar(select(GameReviewModel).where(
                    GameReviewModel.id == bundle.gameReviewId).with_for_update())
                if parent is None:
                    raise ApiError("REVIEW_NOT_FOUND", "Review has not been generated")
                existing = self._read_explanation(session, bundle.gameReviewId,
                                                   bundle.promptVersion)
                if existing is not None:
                    return existing
                session.add(ReviewExplanationModel(
                    game_review_id=bundle.gameReviewId,
                    prompt_version=bundle.promptVersion,
                    provider=bundle.gameExplanation.provider,
                    model=bundle.gameExplanation.model,
                    fallback_used=(bundle.gameExplanation.fallbackUsed or
                                   any(item.fallbackUsed for item in bundle.moveExplanations)),
                    payload=bundle.model_dump(mode="json"),
                    created_at=bundle.createdAt.replace(tzinfo=None),
                ))
                session.flush()
                return bundle
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_coach_hint(self, game_id: str, game_version: int, player: str,
                             level: int, prompt_version: str) -> CoachHint | None:
        return await asyncio.to_thread(self._get_coach_hint, game_id, game_version,
                                       player, level, prompt_version)

    @staticmethod
    def _read_coach_hint(session, game_id: str, game_version: int, player: str,
                         level: int, prompt_version: str) -> CoachHint | None:
        row = session.scalar(select(CoachHintModel).where(
            CoachHintModel.game_id == game_id,
            CoachHintModel.game_version == game_version,
            CoachHintModel.analyzed_player == player,
            CoachHintModel.hint_level == level,
            CoachHintModel.prompt_version == prompt_version))
        if row is None:
            return None
        return CoachHint(gameId=row.game_id, gameVersion=row.game_version,
                         analyzedPlayer=row.analyzed_player, level=row.hint_level,
                         hintText=row.hint_text, focusTopics=row.focus_topics,
                         candidateFromNodes=row.candidate_nodes, bestMove=row.best_move,
                         provider=row.provider, model=row.model,
                         promptVersion=row.prompt_version, fallbackUsed=row.fallback_used,
                         generatedAt=row.created_at.replace(tzinfo=timezone.utc))

    def _get_coach_hint(self, game_id: str, game_version: int, player: str,
                        level: int, prompt_version: str) -> CoachHint | None:
        try:
            with self.sessions() as session:
                return self._read_coach_hint(session, game_id, game_version,
                                             player, level, prompt_version)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_coach_hint(self, hint: CoachHint) -> CoachHint:
        return await asyncio.to_thread(self._commit_coach_hint, hint)

    def _commit_coach_hint(self, hint: CoachHint) -> CoachHint:
        try:
            with self.sessions.begin() as session:
                row = session.scalar(select(GameModel).where(
                    GameModel.id == hint.gameId).with_for_update())
                if row is None:
                    raise ApiError("GAME_NOT_FOUND", "Game not found")
                if (row.version != hint.gameVersion or row.status != "PLAYING" or
                    row.current_player != hint.analyzedPlayer):
                    raise ApiError("GAME_STATE_CONFLICT", "Game state changed during coaching")
                existing = self._read_coach_hint(session, hint.gameId, hint.gameVersion,
                                                 hint.analyzedPlayer, hint.level,
                                                 hint.promptVersion)
                if existing is not None:
                    return existing
                session.add(CoachHintModel(
                    game_id=hint.gameId, game_version=hint.gameVersion,
                    analyzed_player=hint.analyzedPlayer, hint_level=hint.level,
                    hint_text=hint.hintText, focus_topics=hint.focusTopics,
                    candidate_nodes=hint.candidateFromNodes,
                    best_move=hint.bestMove.model_dump(by_alias=True) if hint.bestMove else None,
                    provider=hint.provider, model=hint.model,
                    prompt_version=hint.promptVersion, fallback_used=hint.fallbackUsed,
                    created_at=hint.generatedAt.replace(tzinfo=None),
                ))
                session.flush()
                return hint
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def list_training_sources(self, review_id: str) -> list[TrainingSource]:
        return await asyncio.to_thread(self._list_training_sources, review_id)

    def _list_training_sources(self, review_id: str) -> list[TrainingSource]:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).sources(review_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_training_items(self, review_id: str,
                                    items: list[TrainingItemInternal], user_id: str | None = None) -> list[TrainingItemInternal]:
        return await asyncio.to_thread(self._commit_training_items, review_id, items, user_id)

    def _commit_training_items(self, review_id: str,
                               items: list[TrainingItemInternal], user_id: str | None = None) -> list[TrainingItemInternal]:
        try:
            with self.sessions.begin() as session:
                self._require_active_owner(session, user_id)
                return TrainingRepository(session).commit_items(review_id, items, user_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def list_training_items(self, limit: int, offset: int, category: str | None,
                                  training_type: str | None,
                                  user_id: str | None = None, source: str = 'REVIEW',
                                  difficulty: str | None = None, completed: bool | None = None,
                                  source_game_id: str | None = None) -> tuple[list[TrainingItemInternal], int]:
        return await asyncio.to_thread(self._list_training_items, limit, offset,
                                       category, training_type, user_id, source, difficulty, completed, source_game_id)

    def _list_training_items(self, limit: int, offset: int, category: str | None,
                             training_type: str | None,
                             user_id: str | None, source: str = 'REVIEW',
                             difficulty: str | None = None, completed: bool | None = None,
                             source_game_id: str | None = None) -> tuple[list[TrainingItemInternal], int]:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).list_items(limit, offset, category, training_type, user_id, source, difficulty, completed, source_game_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_curated_items(self, items: list[TrainingItemInternal]) -> None:
        return await asyncio.to_thread(self._commit_curated_items, items)

    def _commit_curated_items(self, items):
        try:
            with self.sessions.begin() as session:
                TrainingRepository(session).commit_curated(items)
        except SQLAlchemyError as exc:
            raise ApiError('DATABASE_UNAVAILABLE', 'Database operation failed') from exc

    async def training_progress(self, training_id: str, user_id: str | None):
        return await asyncio.to_thread(self._training_progress, training_id, user_id)

    def _training_progress(self, training_id, user_id):
        try:
            with self.sessions() as session:
                return TrainingRepository(session).progress(training_id, user_id)
        except SQLAlchemyError as exc:
            raise ApiError('DATABASE_UNAVAILABLE', 'Database operation failed') from exc

    async def get_training_item(self, training_id: str) -> TrainingItemInternal:
        return await asyncio.to_thread(self._get_training_item, training_id)

    def _get_training_item(self, training_id: str) -> TrainingItemInternal:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).get_item(training_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def get_training_attempt(self, client_attempt_id: str,
                                   user_id: str | None = None) -> TrainingAnswerResult | None:
        return await asyncio.to_thread(self._get_training_attempt, client_attempt_id, user_id)

    def _get_training_attempt(self, client_attempt_id: str,
                             user_id: str | None) -> TrainingAnswerResult | None:
        try:
            with self.sessions() as session:
                return TrainingRepository(session).get_attempt(client_attempt_id, user_id)
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc

    async def commit_training_record(self, record: TrainingAnswerResult,
                                     user_id: str | None = None) -> TrainingAnswerResult:
        return await asyncio.to_thread(self._commit_training_record, record, user_id)

    def _commit_training_record(self, record: TrainingAnswerResult,
                                user_id: str | None) -> TrainingAnswerResult:
        try:
            with self.sessions.begin() as session:
                self._require_active_owner(session, user_id)
                return TrainingRepository(session).commit_record(record, user_id)
        except IntegrityError as exc:
            raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used") from exc
        except SQLAlchemyError as exc:
            raise ApiError("DATABASE_UNAVAILABLE", "Database operation failed") from exc
