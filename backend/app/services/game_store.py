"""Persistence contract and an explicit in-memory implementation for isolated API tests."""

import asyncio
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Protocol
from uuid import uuid4

from backend.app.core.errors import ApiError
from backend.app.schemas.game import (
    GameOperationRequest, GameOperationResponse, GameReview, GameState, PositionAnalysis,
    SearchResult, TurnResult, ReviewConfig,
)
from backend.app.schemas.remote import RemoteOperationRequest
from backend.app.services.remote_accounts import recovery_seat
from backend.app.services.player_skill import SkillEvidence, calculate_skill_profile
from backend.app.schemas.explanation import ExplanationBundle
from backend.app.schemas.coach import CoachHint
from backend.app.schemas.training import (TrainingAnswerResult, TrainingItemInternal,
                                          TrainingSource, TrainingProgress)


@dataclass(frozen=True)
class StoredGame:
    game_id: str
    initial_state: GameState
    state: GameState
    version: int
    ply_count: int = 0
    mode: str = "LOCAL"
    ai_player: str | None = None
    ai_level: str | None = None
    user_id: str | None = None


@dataclass(frozen=True)
class StoredMove:
    turn_number: int
    actor_type: str
    turn: TurnResult
    search: SearchResult | None
    game_move_id: int = 0
    created_revision: int = 0
    reverted_revision: int | None = None
    client_request_id: str | None = None


@dataclass(frozen=True)
class StoredUndoEvent:
    game_id: str
    client_request_id: str
    requester: str
    before_revision: int
    after_revision: int
    anchor_turn: int
    reverted_count: int
    state_after: GameState
    undo_event_id: int = 0


@dataclass(frozen=True)
class StoredTerminalEvent:
    game_id: str
    client_request_id: str
    revision: int
    event_type: str
    actor: str
    winner: str
    state_before: GameState
    state_after: GameState
    terminal_event_id: int = 0


@dataclass(frozen=True)
class StoredRemoteRoom:
    game_id: str
    invite_code: str
    host_token_hash: str
    guest_token_hash: str | None
    host_device_id: str
    guest_device_id: str | None
    public: bool
    status: str
    expires_at: datetime
    host_user_id: str | None = None
    guest_user_id: str | None = None


@dataclass(frozen=True)
class StoredRemoteUndoRequest:
    id: str
    game_id: str
    requester: str
    responder: str
    create_client_request_id: str
    base_revision: int
    anchor_turn: int
    revert_count: int
    status: str = "PENDING"
    resolve_client_request_id: str | None = None
    resolve_expected_version: int | None = None
    resolve_action: str | None = None


class GameStore(Protocol):
    async def ping(self) -> None: ...
    async def register_device(self, token_hash: str) -> str: ...
    async def login_wechat(self, identity: str, token_hash: str, expires_at: datetime,
                           device_hash: str | None = None) -> str: ...
    async def resolve_device(self, token_hash: str) -> str | None: ...
    async def personal_games(self, user_id: str, limit: int,
                             cursor: tuple[datetime, str] | None,
                             status: str | None = None) -> tuple[list[dict], bool]: ...
    async def personal_profile(self, user_id: str) -> dict: ...
    async def update_profile(self, user_id: str, nickname: str, avatar: str) -> None: ...
    async def validate_ordinary_actor(self, game_id: str, user_id: str | None) -> None: ...

    async def create(self, state: GameState, mode: str = "LOCAL",
                     ai_player: str | None = None, ai_level: str | None = None,
                     user_id: str | None = None) -> str: ...
    async def lookup_local_import(self, user_id: str, client_id: str, digest: str) -> str | None: ...
    async def commit_local_import(self, user_id: str, client_id: str, digest: str,
                                  initial: GameState, turns: list[TurnResult],
                                  resigning_player: str | None) -> str: ...
    async def get_snapshot(self, game_id: str) -> StoredGame: ...
    async def commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                          actor_type: str, search: SearchResult | None = None, user_id: str | None = None) -> None: ...
    async def list_moves(self, game_id: str) -> list[StoredMove]: ...
    async def read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]: ...
    async def get_terminal_event(self, game_id: str) -> StoredTerminalEvent | None: ...
    async def commit_undo(self, game_id: str,
                          request: GameOperationRequest, user_id: str | None = None) -> GameOperationResponse: ...
    async def commit_resign(self, game_id: str,
                            request: GameOperationRequest, user_id: str | None = None) -> GameOperationResponse: ...
    async def lock_for(self, game_id: str) -> asyncio.Lock: ...
    async def commit_analysis(self, game_id: str, expected_version: int,
                              analysis: PositionAnalysis, *, remote_token_hash: str | None = None,
                              user_id: str | None = None) -> None: ...
    async def validate_remote_learning(self, game_id: str, digest: str, user_id: str | None,
                                       expected_version: int, seat: str | None = None) -> None: ...
    async def authorize_training(self, training_id: str, user_id: str | None) -> None: ...
    async def validate_active_user(self, user_id: str | None) -> None: ...
    async def get_review(self, game_id: str, player: str, version: int) -> GameReview | None: ...
    async def commit_review(self, review: GameReview, expected_version: int,
                            user_id: str | None = None, remote_token_hash: str | None = None) -> GameReview: ...
    async def get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None: ...
    async def commit_explanation(self, bundle: ExplanationBundle, *, remote_token_hash: str | None = None,
                                  user_id: str | None = None, expected_version: int | None = None) -> ExplanationBundle: ...
    async def get_coach_hint(self, game_id: str, game_version: int, player: str,
                             level: int, prompt_version: str) -> CoachHint | None: ...
    async def commit_coach_hint(self, hint: CoachHint, user_id: str | None = None) -> CoachHint: ...
    async def list_training_sources(self, review_id: str) -> list[TrainingSource]: ...
    async def commit_training_items(self, review_id: str,
                                    items: list[TrainingItemInternal], user_id: str | None = None, *,
                                    remote_token_hash: str | None = None,
                                    expected_version: int | None = None) -> list[TrainingItemInternal]: ...
    async def list_training_items(self, limit: int, offset: int, category: str | None,
                                  training_type: str | None,
                                  user_id: str | None = None, source: str = 'REVIEW',
                                  difficulty: str | None = None, completed: bool | None = None,
                                  source_game_id: str | None = None, player: str | None = None) -> tuple[list[TrainingItemInternal], int]: ...
    async def get_training_item(self, training_id: str) -> TrainingItemInternal: ...
    async def commit_curated_items(self, items: list[TrainingItemInternal]) -> None: ...
    async def training_progress(self, training_id: str, user_id: str | None) -> TrainingProgress: ...
    async def get_training_attempt(self, client_attempt_id: str,
                                   user_id: str | None = None) -> TrainingAnswerResult | None: ...
    async def commit_training_record(self, record: TrainingAnswerResult,
                                     user_id: str | None = None) -> TrainingAnswerResult: ...
    async def create_remote_room(self, state: GameState, token_hash: str, code: str,
                                 device_id: str, public: bool,
                                 expires_at: datetime, user_id: str | None = None) -> StoredRemoteRoom: ...
    async def join_remote_room(self, code: str, token_hash: str,
                               device_id: str, now: datetime, user_id: str | None = None) -> StoredRemoteRoom: ...
    async def match_remote_room(self, state: GameState, token_hash: str, code: str,
                                device_id: str, expires_at: datetime,
                                now: datetime, user_id: str | None = None) -> StoredRemoteRoom: ...
    async def recover_remote_room(self, game_id: str, user_id: str, new_token_hash: str,
                                  claim_token_hash: str | None = None) -> StoredRemoteRoom: ...
    async def get_remote_room(self, game_id: str) -> StoredRemoteRoom: ...
    async def cancel_remote_room(self, game_id: str,
                                 token_hash: str, user_id: str | None = None) -> StoredRemoteRoom: ...
    async def get_remote_move(self, game_id: str,
                              request_id: str) -> StoredMove | None: ...
    async def commit_remote_turn(self, game_id: str, token_hash: str,
                                 expected_version: int, request_id: str,
                                 turn: TurnResult, user_id: str | None = None) -> StoredMove: ...
    async def get_pending_remote_undo(self, game_id: str) -> StoredRemoteUndoRequest | None: ...
    async def create_remote_undo(self, game_id: str, token_hash: str,
                                 request: RemoteOperationRequest, user_id: str | None = None) -> StoredRemoteUndoRequest: ...
    async def resolve_remote_undo(self, game_id: str, request_id: str,
                                  token_hash: str, request: RemoteOperationRequest,
                                  action: str, user_id: str | None = None) -> StoredRemoteUndoRequest: ...
    async def commit_remote_resign(self, game_id: str, token_hash: str,
                                   request: RemoteOperationRequest, user_id: str | None = None) -> StoredTerminalEvent: ...


class InMemoryGameStore:
    """Test-only store; production creates MySQLGameStore by default."""

    def __init__(self):
        self._games: dict[str, StoredGame] = {}
        self._moves: dict[str, list[StoredMove]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._analyses: dict[str, list[tuple[int, PositionAnalysis]]] = {}
        self._reviews: dict[tuple[str, str, int], GameReview] = {}
        self._explanations: dict[tuple[str, str], ExplanationBundle] = {}
        self._coach_hints: dict[tuple[str, int, str, int, str], CoachHint] = {}
        self._training_items: dict[str, TrainingItemInternal] = {}
        self._training_item_owners: dict[str, str | None] = {}
        self._training_keys: dict[tuple[str, int, str, int], str] = {}
        self._training_records: dict[str, TrainingAnswerResult] = {}
        self._catalog_lock = asyncio.Lock()
        self._remote_rooms: dict[str, StoredRemoteRoom] = {}
        self._remote_requests: dict[tuple[str, str], StoredMove] = {}
        self._remote_undo_requests: dict[str, StoredRemoteUndoRequest] = {}
        self._remote_operation_requests: dict[tuple[str, str], tuple] = {}
        self._terminal_events: dict[str, StoredTerminalEvent] = {}
        self._undo_events: dict[tuple[str, str], StoredUndoEvent] = {}
        self._device_users: dict[str, str] = {}
        self._wechat_users: dict[str, str] = {}
        self._retired_users: set[str] = set()
        self._profiles: dict[str, tuple[str, str]] = {}
        self._local_imports: dict[tuple[str, str], tuple[str, str]] = {}
        self._auth_sessions: dict[str, tuple[str, datetime]] = {}
        self._game_created: dict[str, datetime] = {}
        self._training_owners: dict[str, str | None] = {}

    def _require_ordinary_owner(self, game_id: str, user_id: str | None) -> None:
        if user_id is None:
            return  # explicit unauthenticated engine/test use
        if user_id in self._retired_users or user_id not in self._profiles:
            raise ApiError('AUTH_INVALID', 'Account was migrated; login again')
        game = self._games.get(game_id)
        if game is None:
            raise ApiError('GAME_NOT_FOUND', 'Game not found')
        if game.mode == 'REMOTE':
            raise ApiError('REMOTE_ACTION_REQUIRED', 'Use the remote room endpoint')
        if game.user_id != user_id:
            raise ApiError('AUTH_FORBIDDEN', 'Game belongs to another account')

    async def validate_ordinary_actor(self, game_id: str, user_id: str | None) -> None:
        self._require_ordinary_owner(game_id, user_id)

    async def ping(self) -> None:
        return None

    async def register_device(self, token_hash: str) -> str:
        async with self._catalog_lock:
            user_id = uuid4().hex
            self._device_users[token_hash] = user_id
            self._profiles[user_id] = ('本机棋手', 'piece_v1_shi')
            return user_id

    async def login_wechat(self, identity: str, token_hash: str, expires_at: datetime,
                           device_hash: str | None = None) -> str:
        async with self._catalog_lock:
            source = self._device_users.get(device_hash) if device_hash else None
            user_id = self._wechat_users.get(identity) or source or uuid4().hex
            if user_id not in self._profiles:
                self._profiles[user_id] = ('微信棋手', 'piece_v1_shi')
            if source and source != user_id:
                if any({room.host_user_id, room.guest_user_id} == {source, user_id}
                       for room in self._remote_rooms.values()):
                    raise ApiError("REMOTE_ACCOUNT_CONFLICT", "Accounts occupy opposite seats; keep the original account")
                for (owner, client_id), (game_id, digest) in self._local_imports.items():
                    other = self._local_imports.get((user_id, client_id))
                    if owner == source and other is not None and other[0] != game_id:
                        raise ApiError("LOCAL_IMPORT_ACCOUNT_CONFLICT", "Accounts imported the same client ID into different games")
                for game_id, room in tuple(self._remote_rooms.items()):
                    self._remote_rooms[game_id] = replace(room,
                        host_user_id=user_id if room.host_user_id == source else room.host_user_id,
                        guest_user_id=user_id if room.guest_user_id == source else room.guest_user_id)
            self._wechat_users[identity] = user_id
            if source:
                for game_id, game in self._games.items():
                    if game.user_id == source:
                        self._games[game_id] = replace(game, user_id=user_id)
                for key, owner in self._training_owners.items():
                    if owner == source:
                        self._training_owners[key] = user_id
                for key, owner in self._training_item_owners.items():
                    if owner == source:
                        self._training_item_owners[key] = user_id
                if source != user_id:
                    for key, imported in tuple(self._local_imports.items()):
                        if key[0] == source:
                            self._local_imports[(user_id, key[1])] = imported
                            del self._local_imports[key]
                    self._retired_users.add(source)
                del self._device_users[device_hash]
            self._auth_sessions[token_hash] = (user_id, expires_at)
            return user_id

    async def resolve_device(self, token_hash: str) -> str | None:
        session = self._auth_sessions.get(token_hash)
        if session:
            return session[0] if session[1] > datetime.now(timezone.utc) else None
        return self._device_users.get(token_hash)

    async def personal_games(self, user_id: str, limit: int,
                             cursor: tuple[datetime, str] | None,
                             status: str | None = None) -> tuple[list[dict], bool]:
        rows = [(self._game_created[id], game) for id, game in self._games.items()
                if self._owns_personal(game, user_id) and
                (status is None or game.state.game_status == status)]
        rows.sort(key=lambda row: (row[0], row[1].game_id), reverse=True)
        if cursor:
            rows = [row for row in rows if (row[0], row[1].game_id) < cursor]
        selected = rows[:limit + 1]
        return [self._personal_row(date, game, user_id) for date, game in selected[:limit]], len(selected) > limit

    def _personal_seat(self, game_id: str, user_id: str) -> str | None:
        room = self._remote_rooms.get(game_id)
        if room is None:
            return None
        return "A" if room.host_user_id == user_id else "B" if room.guest_user_id == user_id else None

    def _owns_personal(self, game: StoredGame, user_id: str) -> bool:
        if game.mode != "REMOTE":
            return game.user_id == user_id
        room = self._remote_rooms.get(game.game_id)
        return room is not None and self._personal_seat(game.game_id, user_id) is not None and (
            room.status in ("PLAYING", "FINISHED") or
            (room.status == "WAITING" and room.expires_at > datetime.now(timezone.utc).replace(tzinfo=None)))

    def _personal_row(self, date: datetime, game: StoredGame, user_id: str) -> dict:
        return {"gameId": game.game_id, "mode": game.mode, "aiLevel": game.ai_level, "seat": self._personal_seat(game.game_id, user_id), "status": game.state.game_status,
                "winner": game.state.winner, "winnerReason": game.state.winner_reason,
                "startedAt": date.isoformat(),
                "finishedAt": None, "turns": game.ply_count,
                "reviewAvailable": any(key[0] == game.game_id and (game.mode != "REMOTE" or key[1] == self._personal_seat(game.game_id, user_id)) for key in self._reviews),
                "cursorDate": date.isoformat()}

    async def update_profile(self, user_id: str, nickname: str, avatar: str) -> None:
        async with self._catalog_lock:
            if user_id in self._retired_users or user_id not in self._profiles:
                raise ApiError('AUTH_INVALID', 'Account is unavailable')
            self._profiles[user_id] = (nickname, avatar)

    async def personal_profile(self, user_id: str) -> dict:
        if user_id in self._retired_users or user_id not in self._profiles:
            raise ApiError('AUTH_INVALID', 'Account is unavailable')
        games = [game for game in self._games.values()
                 if self._owns_personal(game, user_id)]
        records = [record for key, record in self._training_records.items()
                   if self._training_owners.get(key) == user_id]
        ai_finished = [game for game in games if game.mode == "AI" and
                       game.state.game_status == "FINISHED"]
        wins = sum(game.state.winner == ("B" if game.ai_player == "A" else "A")
                   for game in ai_finished)
        losses = sum(game.state.winner == game.ai_player for game in ai_finished)
        human_reviews = []
        for game in ai_finished:
            human = 'B' if game.ai_player == 'A' else 'A'
            review = self._reviews.get((game.game_id, human, ReviewConfig().version))
            moves = [move for move in review.moveReviews if move.player == human] if review else []
            if moves:
                human_reviews.append(moves)
        reviewed_moves = [move for moves in human_reviews for move in moves]
        skill = calculate_skill_profile(SkillEvidence(
            wins=wins, losses=losses, training_attempts=len(records),
            training_correct=sum(record.result == 'CORRECT' for record in records),
            reviewed_games=len(human_reviews), reviewed_moves=len(reviewed_moves),
            good_moves=sum(move.category == 'GOOD' for move in reviewed_moves),
            normal_moves=sum(move.category == 'NORMAL' for move in reviewed_moves),
            mistakes=sum(move.category == 'MISTAKE' for move in reviewed_moves),
            blunders=sum(move.category == 'BLUNDER' for move in reviewed_moves),
            best_equivalent_moves=sum(move.bestMoveEquivalent for move in reviewed_moves),
            score_loss_sum=sum(move.scoreLoss for move in reviewed_moves)))
        remote = [game for game in games if game.mode == "REMOTE"]
        remote_finished = [game for game in remote if game.state.game_status == "FINISHED"]
        return {"remoteGames": len(remote),
                "remoteWins": sum(game.state.winner == self._personal_seat(game.game_id, user_id) for game in remote_finished),
                "remoteLosses": sum(game.state.winner in ("A", "B") and game.state.winner != self._personal_seat(game.game_id, user_id) for game in remote_finished),
                "id": user_id, "nickname": self._profiles[user_id][0], "avatar": self._profiles[user_id][1], "games": len(games),
                "finishedGames": sum(game.state.game_status == "FINISHED" for game in games),
                "wins": wins, "losses": losses,
                "reviewedGames": len({key[0] for key in self._reviews
                                      if self._owns_personal(self._games[key[0]], user_id) and (self._games[key[0]].mode != "REMOTE" or key[1] == self._personal_seat(key[0], user_id))}),
                "training": len({record.trainingId for record in records if record.result == "CORRECT"}),
                "trainingAttempts": len(records),
                "correct": sum(record.result == "CORRECT" for record in records),
                "skillProfile": skill}

    async def create(self, state: GameState, mode: str = "LOCAL",
                     ai_player: str | None = None, ai_level: str | None = None,
                     user_id: str | None = None) -> str:
        async with self._catalog_lock:
            if user_id in self._retired_users:
                raise ApiError("AUTH_INVALID", "Account was migrated; login again")
            game_id = uuid4().hex
            self._games[game_id] = StoredGame(
                game_id=game_id, initial_state=state, state=state, version=0, ply_count=0,
                mode=mode, ai_player=ai_player, ai_level=ai_level, user_id=user_id)
            self._game_created[game_id] = datetime.now(timezone.utc)
            self._moves[game_id] = []
            self._locks[game_id] = asyncio.Lock()
            self._analyses[game_id] = []
            return game_id

    async def lookup_local_import(self, user_id: str, client_id: str, digest: str) -> str | None:
        async with self._catalog_lock:
            if user_id in self._retired_users:
                raise ApiError("AUTH_INVALID", "Account is no longer active")
            existing = self._local_imports.get((user_id, client_id))
            if existing and existing[1] != digest:
                raise ApiError("LOCAL_IMPORT_CONFLICT", "Client game ID already imported with another score")
            return existing[0] if existing else None

    async def commit_local_import(self, user_id: str, client_id: str, digest: str,
                                  initial: GameState, turns: list[TurnResult],
                                  resigning_player: str | None) -> str:
        async with self._catalog_lock:
            if user_id in self._retired_users or user_id not in (
                    set(self._device_users.values()) | set(self._wechat_users.values())):
                raise ApiError("AUTH_INVALID", "Account is no longer active")
            existing = self._local_imports.get((user_id, client_id))
            if existing:
                if existing[1] != digest:
                    raise ApiError("LOCAL_IMPORT_CONFLICT", "Client game ID already imported with another score")
                return existing[0]
            game_id = uuid4().hex
            copied_initial = initial.model_copy(deep=True)
            copied_turns = [turn.model_copy(deep=True) for turn in turns]
            before = (copied_turns[-1].state if copied_turns else copied_initial).model_copy(deep=True)
            state = before.model_copy(deep=True)
            event = None
            if resigning_player is not None:
                state = before.model_copy(deep=True, update={"game_status": "FINISHED",
                    "winner": "B" if resigning_player == "A" else "A", "winner_reason": "RESIGN"})
                event = StoredTerminalEvent(game_id, "local-import-resign", len(turns) + 1,
                    "RESIGN", resigning_player, state.winner, before, state)
            moves = [StoredMove(i, "HUMAN", turn, None, i, i)
                     for i, turn in enumerate(copied_turns, 1)]
            game = StoredGame(game_id, copied_initial, state, len(turns) + (event is not None),
                len(turns), user_id=user_id)
            # Construct everything before publishing, with no await or separate commits.
            self._games[game_id] = game
            self._moves[game_id] = moves
            self._locks[game_id] = asyncio.Lock()
            self._analyses[game_id] = []
            self._game_created[game_id] = datetime.now(timezone.utc)
            if event is not None:
                self._terminal_events[game_id] = event
            self._local_imports[(user_id, client_id)] = (game_id, digest)
            return game_id

    async def lock_for(self, game_id: str) -> asyncio.Lock:
        async with self._catalog_lock:
            lock = self._locks.get(game_id)
        if lock is None:
            raise ApiError("GAME_NOT_FOUND", "Game not found")
        return lock

    async def get_snapshot(self, game_id: str) -> StoredGame:
        game = self._games.get(game_id)
        if game is None:
            raise ApiError("GAME_NOT_FOUND", "Game not found")
        return replace(
            game, initial_state=game.initial_state.model_copy(deep=True),
            state=game.state.model_copy(deep=True))

    @staticmethod
    def _copy_move(move: StoredMove) -> StoredMove:
        return replace(
            move, turn=move.turn.model_copy(deep=True),
            search=move.search.model_copy(deep=True) if move.search is not None else None)

    @staticmethod
    def _copy_terminal_event(event: StoredTerminalEvent) -> StoredTerminalEvent:
        return replace(
            event, state_before=event.state_before.model_copy(deep=True),
            state_after=event.state_after.model_copy(deep=True))

    async def commit_turn(self, game_id: str, expected_version: int, turn: TurnResult,
                          actor_type: str, search: SearchResult | None = None, user_id: str | None = None) -> None:
        game = await self.get_snapshot(game_id)
        self._require_ordinary_owner(game_id, user_id)
        if game.version != expected_version or game.state != turn.before_state:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the move")
        self._moves[game_id].append(StoredMove(
            turn_number=game.ply_count + 1, actor_type=actor_type, turn=turn, search=search,
            game_move_id=game.version + 1, created_revision=game.version + 1))
        self._games[game_id] = StoredGame(
            game_id=game_id, initial_state=game.initial_state, state=turn.state,
            version=game.version + 1, ply_count=game.ply_count + 1, mode=game.mode,
            ai_player=game.ai_player, ai_level=game.ai_level, user_id=game.user_id)

    async def list_moves(self, game_id: str) -> list[StoredMove]:
        await self.get_snapshot(game_id)
        return sorted(
            (self._copy_move(move) for move in self._moves[game_id]
             if move.reverted_revision is None),
            key=lambda move: move.turn_number,
        )

    async def read_replay(self, game_id: str) -> tuple[StoredGame, list[StoredMove]]:
        lock = await self.lock_for(game_id)
        async with lock:
            return await self.get_snapshot(game_id), await self.list_moves(game_id)

    async def get_terminal_event(self, game_id: str) -> StoredTerminalEvent | None:
        await self.get_snapshot(game_id)
        event = self._terminal_events.get(game_id)
        return self._copy_terminal_event(event) if event is not None else None

    @staticmethod
    def _request_conflict() -> ApiError:
        return ApiError("OPERATION_REQUEST_CONFLICT", "Request ID already used")

    def _existing_operation(self, game: StoredGame, request: GameOperationRequest,
                            operation: str) -> GameOperationResponse | None:
        undo = self._undo_events.get((game.game_id, request.client_request_id))
        terminal = self._terminal_events.get(game.game_id)
        if undo is not None:
            if operation != "UNDO" or undo.before_revision != request.expected_version:
                raise self._request_conflict()
            return GameOperationResponse(
                version=undo.after_revision, ply_count=undo.anchor_turn - 1,
                state=undo.state_after.model_copy(deep=True),
                reverted_turns=undo.reverted_count)
        if terminal is not None and terminal.client_request_id == request.client_request_id:
            if operation != "RESIGN" or terminal.revision - 1 != request.expected_version:
                raise self._request_conflict()
            return GameOperationResponse(
                version=terminal.revision, ply_count=game.ply_count,
                state=terminal.state_after.model_copy(deep=True))
        return None

    @staticmethod
    def _validate_operation(game: StoredGame, request: GameOperationRequest) -> None:
        if game.state.game_status != "PLAYING":
            raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
        if game.version != request.expected_version:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry the operation")

    async def commit_undo(self, game_id: str,
                          request: GameOperationRequest, user_id: str | None = None) -> GameOperationResponse:
        lock = await self.lock_for(game_id)
        async with lock:
            game = await self.get_snapshot(game_id)
            self._require_ordinary_owner(game_id, user_id)
            if game.mode == "REMOTE":
                raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
            existing = self._existing_operation(game, request, "UNDO")
            if existing is not None:
                return existing
            self._validate_operation(game, request)
            active = sorted(
                (item for item in self._moves[game_id] if item.reverted_revision is None),
                key=lambda item: item.turn_number,
            )
            candidates = active if game.mode == "LOCAL" else [
                item for item in active if item.actor_type == "HUMAN"]
            if not candidates:
                raise ApiError("UNDO_NOT_AVAILABLE", "No move is available to undo")
            anchor = candidates[-1]
            reverted = [item for item in active if item.turn_number >= anchor.turn_number]
            revision = game.version + 1
            reverted_ids = {id(item) for item in reverted}
            self._moves[game_id] = [
                replace(item, reverted_revision=revision) if id(item) in reverted_ids else item
                for item in self._moves[game_id]
            ]
            state = anchor.turn.before_state.model_copy(deep=True)
            self._games[game_id] = replace(
                game, state=state.model_copy(deep=True), version=revision,
                ply_count=anchor.turn_number - 1)
            event = StoredUndoEvent(
                game_id=game_id, client_request_id=request.client_request_id,
                requester=(("B" if game.ai_player == "A" else "A")
                           if game.mode == "AI" else game.state.current_player),
                before_revision=game.version,
                after_revision=revision, anchor_turn=anchor.turn_number,
                reverted_count=len(reverted), state_after=state.model_copy(deep=True),
                undo_event_id=len(self._undo_events) + 1,
            )
            self._undo_events[(game_id, request.client_request_id)] = event
            return GameOperationResponse(
                version=revision, ply_count=anchor.turn_number - 1, state=state,
                reverted_turns=len(reverted))

    async def commit_resign(self, game_id: str,
                            request: GameOperationRequest, user_id: str | None = None) -> GameOperationResponse:
        lock = await self.lock_for(game_id)
        async with lock:
            game = await self.get_snapshot(game_id)
            self._require_ordinary_owner(game_id, user_id)
            if game.mode == "REMOTE":
                raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
            existing = self._existing_operation(game, request, "RESIGN")
            if existing is not None:
                return existing
            self._validate_operation(game, request)
            loser = (("B" if game.ai_player == "A" else "A")
                     if game.mode == "AI" else game.state.current_player)
            winner = "B" if loser == "A" else "A"
            finished = game.state.model_copy(deep=True, update={
                "game_status": "FINISHED", "winner": winner, "winner_reason": "RESIGN",
            })
            revision = game.version + 1
            self._games[game_id] = replace(
                game, state=finished.model_copy(deep=True), version=revision)
            self._terminal_events[game_id] = StoredTerminalEvent(
                game_id=game_id, client_request_id=request.client_request_id,
                revision=revision, event_type="RESIGN", actor=loser, winner=winner,
                state_before=game.state.model_copy(deep=True),
                state_after=finished.model_copy(deep=True),
                terminal_event_id=len(self._terminal_events) + 1,
            )
            return GameOperationResponse(
                version=revision, ply_count=game.ply_count,
                state=finished.model_copy(deep=True))

    async def update(self, game_id: str, state: GameState) -> None:
        """Fixture setup for legacy API tests; never used by production."""
        lock = await self.lock_for(game_id)
        async with lock:
            game = await self.get_snapshot(game_id)
            self._games[game_id] = StoredGame(
                game_id=game_id, initial_state=state, state=state, version=game.version,
                ply_count=game.ply_count, mode=game.mode, ai_player=game.ai_player,
                ai_level=game.ai_level, user_id=game.user_id)

    def _create_remote_unlocked(self, state: GameState, token_hash: str, code: str,
                                device_id: str, public: bool,
                                expires_at: datetime, user_id: str | None = None) -> StoredRemoteRoom:
        if user_id in self._retired_users:
            raise ApiError("AUTH_INVALID", "Account was migrated; login again")
        if any(room.invite_code == code for room in self._remote_rooms.values()):
            raise ApiError("REMOTE_CODE_CONFLICT", "Invite code already exists")
        game_id = uuid4().hex
        self._games[game_id] = StoredGame(
            game_id=game_id, initial_state=state, state=state, version=0,
            ply_count=0, mode="REMOTE")
        self._game_created[game_id] = datetime.now(timezone.utc)
        self._moves[game_id] = []
        self._locks[game_id] = asyncio.Lock()
        room = StoredRemoteRoom(game_id, code, token_hash, None, device_id,
                                None, public, "WAITING", expires_at, user_id)
        self._remote_rooms[game_id] = room
        return room

    async def create_remote_room(self, state: GameState, token_hash: str, code: str,
                                 device_id: str, public: bool,
                                 expires_at: datetime, user_id: str | None = None) -> StoredRemoteRoom:
        async with self._catalog_lock:
            return self._create_remote_unlocked(state, token_hash, code, device_id,
                                                public, expires_at, user_id)

    async def join_remote_room(self, code: str, token_hash: str,
                               device_id: str, now: datetime, user_id: str | None = None) -> StoredRemoteRoom:
        async with self._catalog_lock:
            if user_id in self._retired_users:
                raise ApiError("AUTH_INVALID", "Account was migrated; login again")
            room = next((item for item in self._remote_rooms.values()
                         if item.invite_code == code), None)
            if room is None:
                raise ApiError("REMOTE_ROOM_NOT_FOUND", "Room not found")
            if room.status != "WAITING" or room.expires_at <= now:
                raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Room is no longer available")
            if room.host_device_id == device_id or (user_id is not None and room.host_user_id == user_id):
                raise ApiError("REMOTE_SELF_JOIN", "Use another device to join")
            joined = StoredRemoteRoom(room.game_id, room.invite_code,
                                      room.host_token_hash, token_hash,
                                      room.host_device_id, device_id, room.public,
                                      "PLAYING", room.expires_at, room.host_user_id, user_id)
            self._remote_rooms[room.game_id] = joined
            return joined

    async def match_remote_room(self, state: GameState, token_hash: str, code: str,
                                device_id: str, expires_at: datetime,
                                now: datetime, user_id: str | None = None) -> StoredRemoteRoom:
        async with self._catalog_lock:
            if user_id in self._retired_users:
                raise ApiError("AUTH_INVALID", "Account was migrated; login again")
            candidate = next((item for item in self._remote_rooms.values()
                              if item.public and item.status == "WAITING"
                              and item.expires_at > now
                              and item.host_device_id != device_id
                              and (user_id is None or item.host_user_id != user_id)), None)
            if candidate is None:
                return self._create_remote_unlocked(state, token_hash, code,
                                                    device_id, True, expires_at, user_id)
            joined = StoredRemoteRoom(candidate.game_id, candidate.invite_code,
                                      candidate.host_token_hash, token_hash,
                                      candidate.host_device_id, device_id, True,
                                      "PLAYING", candidate.expires_at, candidate.host_user_id, user_id)
            self._remote_rooms[candidate.game_id] = joined
            return joined

    def _require_remote_account(self, room: StoredRemoteRoom, token_hash: str, user_id: str | None) -> None:
        if user_id is None:
            return
        if user_id in self._retired_users:
            raise ApiError("AUTH_INVALID", "Account was migrated; login again")
        seat = self._remote_seat(room, token_hash)
        owner = room.host_user_id if seat == "A" else room.guest_user_id
        if owner is not None and owner != user_id:
            raise ApiError("REMOTE_ACCESS_DENIED", "Seat belongs to another account")

    async def recover_remote_room(self, game_id: str, user_id: str, new_token_hash: str,
                                  claim_token_hash: str | None = None) -> StoredRemoteRoom:
        async with self._catalog_lock:
            if user_id in self._retired_users:
                raise ApiError("AUTH_INVALID", "Account was migrated; login again")
            room = await self.get_remote_room(game_id)
            seat = recovery_seat(room, user_id, claim_token_hash)
            patch = {"host_user_id": user_id, "host_token_hash": new_token_hash} if seat == "A" else {
                "guest_user_id": user_id, "guest_token_hash": new_token_hash}
            recovered = replace(room, **patch)
            self._remote_rooms[game_id] = recovered
            return recovered

    async def get_remote_room(self, game_id: str) -> StoredRemoteRoom:
        room = self._remote_rooms.get(game_id)
        if room is None:
            raise ApiError("REMOTE_ROOM_NOT_FOUND", "Room not found")
        return room

    async def cancel_remote_room(self, game_id: str,
                                 token_hash: str, user_id: str | None = None) -> StoredRemoteRoom:
        async with self._catalog_lock:
            room = await self.get_remote_room(game_id)
            self._require_remote_account(room, token_hash, user_id)
            if room.host_token_hash != token_hash:
                raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")
            if room.status != "WAITING":
                raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Room is no longer waiting")
            cancelled = StoredRemoteRoom(room.game_id, room.invite_code,
                                         room.host_token_hash, room.guest_token_hash,
                                         room.host_device_id, room.guest_device_id,
                                         room.public, "CANCELLED", room.expires_at,
                                         room.host_user_id, room.guest_user_id)
            self._remote_rooms[game_id] = cancelled
            return cancelled

    async def get_remote_move(self, game_id: str,
                              request_id: str) -> StoredMove | None:
        move = self._remote_requests.get((game_id, request_id))
        return self._copy_move(move) if move is not None else None

    @staticmethod
    def _remote_seat(room: StoredRemoteRoom, token_hash: str) -> str:
        if room.host_token_hash == token_hash:
            return "A"
        if room.guest_token_hash == token_hash:
            return "B"
        raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")

    @staticmethod
    def _copy_remote_undo(item: StoredRemoteUndoRequest) -> StoredRemoteUndoRequest:
        return replace(item)

    @staticmethod
    def _remote_request_conflict() -> ApiError:
        return ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")

    @staticmethod
    def _validate_remote_game(game: StoredGame,
                              request: RemoteOperationRequest) -> None:
        if game.state.game_status != "PLAYING":
            raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
        if game.version != request.expected_version:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed")

    async def get_pending_remote_undo(self,
                                      game_id: str) -> StoredRemoteUndoRequest | None:
        await self.get_remote_room(game_id)
        pending = next((item for item in self._remote_undo_requests.values()
                        if item.game_id == game_id and item.status == "PENDING"), None)
        return self._copy_remote_undo(pending) if pending is not None else None

    async def create_remote_undo(self, game_id: str, token_hash: str,
                                 request: RemoteOperationRequest, user_id: str | None = None) -> StoredRemoteUndoRequest:
        room = await self.get_remote_room(game_id)
        self._require_remote_account(room, token_hash, user_id)
        seat = self._remote_seat(room, token_hash)
        signature = ("CREATE_UNDO", request.expected_version, seat)
        key = (game_id, request.client_request_id)
        existing_signature = self._remote_operation_requests.get(key)
        if existing_signature is not None:
            if existing_signature != signature:
                raise self._remote_request_conflict()
            existing = next(
                (item for item in self._remote_undo_requests.values()
                 if item.game_id == game_id
                 and item.create_client_request_id == request.client_request_id), None)
            if existing is None:
                raise self._remote_request_conflict()
            return self._copy_remote_undo(existing)
        if key in self._remote_requests:
            raise self._remote_request_conflict()

        game = await self.get_snapshot(game_id)
        if room.status != "PLAYING":
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
        self._validate_remote_game(game, request)
        if await self.get_pending_remote_undo(game_id) is not None:
            raise ApiError("REMOTE_UNDO_PENDING", "An undo request is already pending")
        active = sorted(
            (item for item in self._moves[game_id] if item.reverted_revision is None),
            key=lambda item: item.turn_number,
        )
        candidates = [item for item in active
                      if item.turn.before_state.current_player == seat]
        if not candidates:
            raise ApiError("UNDO_NOT_AVAILABLE", "No move is available to undo")
        anchor = candidates[-1]
        item = StoredRemoteUndoRequest(
            id=uuid4().hex, game_id=game_id, requester=seat,
            responder="B" if seat == "A" else "A",
            create_client_request_id=request.client_request_id,
            base_revision=game.version, anchor_turn=anchor.turn_number,
            revert_count=sum(move.turn_number >= anchor.turn_number for move in active),
        )
        self._remote_undo_requests[item.id] = item
        self._remote_operation_requests[key] = signature
        return self._copy_remote_undo(item)

    async def resolve_remote_undo(self, game_id: str, request_id: str,
                                  token_hash: str, request: RemoteOperationRequest,
                                  action: str, user_id: str | None = None) -> StoredRemoteUndoRequest:
        room = await self.get_remote_room(game_id)
        self._require_remote_account(room, token_hash, user_id)
        seat = self._remote_seat(room, token_hash)
        signature = (f"RESOLVE_UNDO_{action}", request.expected_version,
                     request_id, seat)
        key = (game_id, request.client_request_id)
        existing_signature = self._remote_operation_requests.get(key)
        target = self._remote_undo_requests.get(request_id)
        if existing_signature is not None:
            if existing_signature != signature or target is None:
                raise self._remote_request_conflict()
            if target.status == "STALE":
                raise ApiError("GAME_STATE_CONFLICT", "Undo request is stale")
            return self._copy_remote_undo(target)
        if key in self._remote_requests:
            raise self._remote_request_conflict()
        if target is None or target.game_id != game_id:
            raise ApiError("REMOTE_UNDO_NOT_FOUND", "Undo request not found")

        game = await self.get_snapshot(game_id)
        if game.state.game_status != "PLAYING":
            raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
        if seat != target.responder:
            raise ApiError("REMOTE_ACCESS_DENIED", "Only the opponent can respond")
        if target.status != "PENDING":
            raise ApiError("REMOTE_UNDO_UNAVAILABLE", "Undo request is no longer pending")
        if request.expected_version != target.base_revision:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed")

        active = sorted(
            (item for item in self._moves[game_id] if item.reverted_revision is None),
            key=lambda item: item.turn_number,
        )
        anchor = next((item for item in active
                       if item.turn_number == target.anchor_turn), None)
        if (game.version != target.base_revision or anchor is None
                or anchor.turn.before_state.current_player != target.requester):
            stale = replace(target, status="STALE",
                            resolve_client_request_id=request.client_request_id,
                            resolve_expected_version=request.expected_version,
                            resolve_action=action)
            self._remote_undo_requests[target.id] = stale
            self._remote_operation_requests[key] = signature
            raise ApiError("GAME_STATE_CONFLICT", "Undo request is stale")

        if action == "ACCEPT":
            reverted = [item for item in active
                        if item.turn_number >= target.anchor_turn]
            revision = game.version + 1
            reverted_ids = {id(item) for item in reverted}
            self._moves[game_id] = [
                replace(item, reverted_revision=revision)
                if id(item) in reverted_ids else item
                for item in self._moves[game_id]
            ]
            for move_key, item in tuple(self._remote_requests.items()):
                if move_key[0] == game_id and id(item) in reverted_ids:
                    self._remote_requests[move_key] = replace(
                        item, reverted_revision=revision)
            state = anchor.turn.before_state.model_copy(deep=True)
            self._games[game_id] = replace(
                game, state=state.model_copy(deep=True), version=revision,
                ply_count=target.anchor_turn - 1)
            status = "ACCEPTED"
        elif action == "DECLINE":
            status = "DECLINED"
        else:
            raise ValueError(f"Unsupported remote undo action: {action}")
        resolved = replace(
            target, status=status,
            resolve_client_request_id=request.client_request_id,
            resolve_expected_version=request.expected_version,
            resolve_action=action,
        )
        self._remote_undo_requests[target.id] = resolved
        self._remote_operation_requests[key] = signature
        return self._copy_remote_undo(resolved)

    async def commit_remote_resign(self, game_id: str, token_hash: str,
                                   request: RemoteOperationRequest, user_id: str | None = None) -> StoredTerminalEvent:
        room = await self.get_remote_room(game_id)
        self._require_remote_account(room, token_hash, user_id)
        seat = self._remote_seat(room, token_hash)
        signature = ("RESIGN", request.expected_version, seat)
        key = (game_id, request.client_request_id)
        existing_signature = self._remote_operation_requests.get(key)
        if existing_signature is not None:
            if existing_signature != signature:
                raise self._remote_request_conflict()
            event = self._terminal_events.get(game_id)
            if event is None or event.client_request_id != request.client_request_id:
                raise self._remote_request_conflict()
            return self._copy_terminal_event(event)
        if key in self._remote_requests:
            raise self._remote_request_conflict()

        game = await self.get_snapshot(game_id)
        if room.status != "PLAYING":
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
        self._validate_remote_game(game, request)
        winner = "B" if seat == "A" else "A"
        finished = game.state.model_copy(deep=True, update={
            "game_status": "FINISHED", "winner": winner,
            "winner_reason": "RESIGN",
        })
        revision = game.version + 1
        self._games[game_id] = replace(
            game, state=finished.model_copy(deep=True), version=revision)
        event = StoredTerminalEvent(
            game_id=game_id, client_request_id=request.client_request_id,
            revision=revision, event_type="RESIGN", actor=seat, winner=winner,
            state_before=game.state.model_copy(deep=True),
            state_after=finished.model_copy(deep=True),
            terminal_event_id=len(self._terminal_events) + 1,
        )
        self._terminal_events[game_id] = event
        pending = await self.get_pending_remote_undo(game_id)
        if pending is not None:
            self._remote_undo_requests[pending.id] = replace(pending, status="STALE")
        self._remote_operation_requests[key] = signature
        return self._copy_terminal_event(event)

    async def commit_remote_turn(self, game_id: str, token_hash: str,
                                 expected_version: int, request_id: str,
                                 turn: TurnResult, user_id: str | None = None) -> StoredMove:
        room = await self.get_remote_room(game_id)
        self._require_remote_account(room, token_hash, user_id)
        seat = "A" if room.host_token_hash == token_hash else (
            "B" if room.guest_token_hash == token_hash else None)
        if seat is None:
            raise ApiError("REMOTE_ACCESS_DENIED", "This seat is unavailable")
        existing = await self.get_remote_move(game_id, request_id)
        if existing is not None:
            if (existing.reverted_revision is not None or
                existing.turn.before_state.current_player != seat or
                existing.turn.move != turn.move or
                existing.created_revision - 1 != expected_version):
                raise ApiError("REMOTE_REQUEST_CONFLICT", "Request ID already used")
            return existing
        if (game_id, request_id) in self._remote_operation_requests:
            raise self._remote_request_conflict()
        game = await self.get_snapshot(game_id)
        if room.status != "PLAYING":
            raise ApiError("REMOTE_ROOM_UNAVAILABLE", "Opponent has not joined")
        if game.state.current_player != seat:
            raise ApiError("NOT_YOUR_TURN", "Wait for your turn")
        if game.version != expected_version or game.state != turn.before_state:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed")
        move = StoredMove(
            turn_number=game.ply_count + 1, actor_type="HUMAN", turn=turn, search=None,
            game_move_id=expected_version + 1, created_revision=expected_version + 1,
            client_request_id=request_id)
        self._moves[game_id].append(move)
        self._remote_requests[(game_id, request_id)] = move
        self._games[game_id] = StoredGame(
            game_id=game_id, initial_state=game.initial_state, state=turn.state,
            version=expected_version + 1, ply_count=game.ply_count + 1, mode="REMOTE")
        return move

    async def commit_analysis(self, game_id: str, expected_version: int,
                              analysis: PositionAnalysis, *, remote_token_hash: str | None = None,
                              user_id: str | None = None) -> None:
        lock = await self.lock_for(game_id)
        async with lock:
            game = await self.get_snapshot(game_id)
            if remote_token_hash is not None:
                await self.validate_remote_learning(game_id, remote_token_hash, user_id, expected_version)
            else:
                self._require_ordinary_owner(game_id, user_id)
            if game.version != expected_version or (game.state.game_status != "PLAYING" and remote_token_hash is None):
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry analysis")
            self._analyses.setdefault(game_id, []).append((expected_version, analysis))

    async def get_review(self, game_id: str, player: str, version: int) -> GameReview | None:
        await self.get_snapshot(game_id)
        return self._reviews.get((game_id, player, version))

    async def commit_review(self, review: GameReview, expected_version: int,
                            user_id: str | None = None, remote_token_hash: str | None = None) -> GameReview:
        lock = await self.lock_for(review.gameId)
        async with lock:
            if remote_token_hash is not None:
                room = await self.get_remote_room(review.gameId)
                self._require_remote_account(room, remote_token_hash, user_id)
                if self._remote_seat(room, remote_token_hash) != review.reviewedPlayer:
                    raise ApiError("REMOTE_ACCESS_DENIED", "Review belongs to another seat")
            game = await self.get_snapshot(review.gameId)
            if remote_token_hash is None:
                self._require_ordinary_owner(review.gameId, user_id)
            if game.version != expected_version or game.state.game_status != "FINISHED":
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed during review")
            key = (review.gameId, review.reviewedPlayer, review.reviewConfigVersion)
            if key not in self._reviews:
                self._reviews[key] = review
            return self._reviews[key]

    async def get_explanation(self, review_id: str, prompt_version: str) -> ExplanationBundle | None:
        return self._explanations.get((review_id, prompt_version))

    async def validate_remote_learning(self, game_id: str, digest: str, user_id: str | None,
                                       expected_version: int, seat: str | None = None) -> None:
        room = await self.get_remote_room(game_id)
        self._require_remote_account(room, digest, user_id)
        actual = self._remote_seat(room, digest)
        owner = room.host_user_id if actual == 'A' else room.guest_user_id
        if (user_id is not None and owner != user_id) or (seat is not None and actual != seat):
            raise ApiError('REMOTE_ACCESS_DENIED', 'Learning requires your bound seat')
        if room.status not in ('PLAYING', 'FINISHED'):
            raise ApiError('REMOTE_ROOM_UNAVAILABLE', 'Room is unavailable for learning')
        if self._games[game_id].version != expected_version:
            raise ApiError('GAME_STATE_CONFLICT', 'Game changed during learning')

    async def commit_explanation(self, bundle: ExplanationBundle, *, remote_token_hash: str | None = None,
                                  user_id: str | None = None, expected_version: int | None = None) -> ExplanationBundle:
        async with self._catalog_lock:
            if remote_token_hash is not None:
                review = next(item for item in self._reviews.values() if item.id == bundle.gameReviewId)
                await self.validate_remote_learning(review.gameId, remote_token_hash, user_id,
                    expected_version, review.reviewedPlayer)
            elif user_id is not None:
                review = next((item for item in self._reviews.values() if item.id == bundle.gameReviewId), None)
                if review is None:
                    raise ApiError('REVIEW_NOT_FOUND', 'Review has not been generated')
                self._require_ordinary_owner(review.gameId, user_id)
            key = (bundle.gameReviewId, bundle.promptVersion)
            if key not in self._explanations:
                self._explanations[key] = bundle
            return self._explanations[key]

    async def get_coach_hint(self, game_id: str, game_version: int, player: str,
                             level: int, prompt_version: str) -> CoachHint | None:
        return self._coach_hints.get((game_id, game_version, player, level, prompt_version))

    async def commit_coach_hint(self, hint: CoachHint, user_id: str | None = None) -> CoachHint:
        lock = await self.lock_for(hint.gameId)
        async with lock:
            game = await self.get_snapshot(hint.gameId)
            self._require_ordinary_owner(hint.gameId, user_id)
            if (game.version != hint.gameVersion or game.state.game_status != "PLAYING" or
                game.state.current_player != hint.analyzedPlayer):
                raise ApiError("GAME_STATE_CONFLICT", "Game state changed during coaching")
            key = (hint.gameId, hint.gameVersion, hint.analyzedPlayer,
                   hint.level, hint.promptVersion)
            if key not in self._coach_hints:
                self._coach_hints[key] = hint
            return self._coach_hints[key]

    async def list_training_sources(self, review_id: str) -> list[TrainingSource]:
        review = next((item for item in self._reviews.values() if item.id == review_id), None)
        if review is None:
            raise ApiError("REVIEW_REQUIRED", "Generate a game review first")
        moves = {move.game_move_id: move for move in self._moves[review.gameId]}
        return [TrainingSource(sourceMoveId=review_move.gameMoveId,
                               sourceMoveReviewId=review_move.gameMoveId,
                               stateSnapshot=moves[review_move.gameMoveId].turn.before_state,
                               stateSchemaVersion=1,
                               originalMove=moves[review_move.gameMoveId].turn.move)
                for review_move in review.moveReviews]

    async def commit_training_items(self, review_id: str,
                                    items: list[TrainingItemInternal], user_id: str | None = None, *,
                                    remote_token_hash: str | None = None,
                                    expected_version: int | None = None) -> list[TrainingItemInternal]:
        async with self._catalog_lock:
            review = next((item for item in self._reviews.values() if item.id == review_id), None)
            if review is None or self._games[review.gameId].state.game_status != "FINISHED":
                raise ApiError("REVIEW_REQUIRED", "Generate a finished game review first")
            if user_id in self._retired_users:
                raise ApiError('AUTH_INVALID', 'Account was migrated; login again')
            game = self._games[review.gameId]
            if remote_token_hash is not None:
                await self.validate_remote_learning(review.gameId, remote_token_hash, user_id,
                    expected_version, review.reviewedPlayer)
            elif user_id is not None:
                if game.mode == 'REMOTE':
                    raise ApiError('REMOTE_ACTION_REQUIRED', 'Use the remote room endpoint')
                if game.user_id != user_id:
                    raise ApiError('AUTH_FORBIDDEN', 'Game belongs to another account')
            saved = []
            for item in items:
                key = (review_id, item.sourceMoveReviewId,
                       item.trainingType, item.generationVersion)
                if key not in self._training_keys:
                    self._training_keys[key] = item.id
                    self._training_items[item.id] = item
                    self._training_item_owners[item.id] = user_id
                saved.append(self._training_items[self._training_keys[key]])
            return saved

    async def list_training_items(self, limit: int, offset: int, category: str | None,
                                  training_type: str | None,
                                  user_id: str | None = None, source: str = 'REVIEW',
                                  difficulty: str | None = None, completed: bool | None = None,
                                  source_game_id: str | None = None, player: str | None = None) -> tuple[list[TrainingItemInternal], int]:
        items = [item for item in self._training_items.values()
                 if item.sourceKind == source and
                 (difficulty is None or item.difficultyTag == difficulty) and
                 (source_game_id is None or item.sourceGameId == source_game_id) and
                 (player is None or item.player == player) and
                 (completed is None or (await self.training_progress(item.id, user_id)).completed == completed) and
                 (category is None or item.sourceCategory == category) and
                 (training_type is None or item.trainingType == training_type) and
                 (item.sourceKind == 'CURATED' or user_id is None or
                  (self._training_item_owners.get(item.id) == user_id if self._games[item.sourceGameId].mode == 'REMOTE'
                   else self._games[item.sourceGameId].user_id == user_id))]
        items.sort(key=lambda item: (item.sourceCategory == "BLUNDER", item.createdAt, item.id),
                   reverse=True)
        return items[offset:offset + limit], len(items)

    async def commit_curated_items(self, items: list[TrainingItemInternal]) -> None:
        async with self._catalog_lock:
            for item in items:
                existing = self._training_items.get(item.id)
                if existing is not None and existing != item:
                    raise ApiError('REPLAY_INTEGRITY_ERROR', 'Catalog ID/version contents differ')
            for item in items:
                self._training_items.setdefault(item.id, item)

    async def training_progress(self, training_id: str, user_id: str | None) -> TrainingProgress:
        records = [record for key, record in self._training_records.items()
                   if record.trainingId == training_id and self._training_owners.get(key) == user_id]
        records.sort(key=lambda record: (record.answeredAt, record.id), reverse=True)
        return TrainingProgress(attemptCount=len(records),
            latestResult=records[0].result if records else None,
            completed=any(record.result == 'CORRECT' for record in records))

    async def get_training_item(self, training_id: str) -> TrainingItemInternal:
        item = self._training_items.get(training_id)
        if item is None:
            raise ApiError("TRAINING_NOT_FOUND", "Training question not found")
        return item

    async def authorize_training(self, training_id: str, user_id: str | None) -> None:
        item = await self.get_training_item(training_id)
        await self.validate_active_user(user_id)
        if user_id is not None and item.sourceKind == 'REVIEW':
            game = self._games[item.sourceGameId]
            owner = self._training_item_owners.get(item.id) if game.mode == 'REMOTE' else game.user_id
            if owner != user_id:
                raise ApiError('AUTH_FORBIDDEN', 'Training belongs to another account')

    async def validate_active_user(self, user_id: str | None) -> None:
        if user_id in self._retired_users:
            raise ApiError('AUTH_INVALID', 'Account was migrated; login again')

    async def get_training_attempt(self, client_attempt_id: str,
                                   user_id: str | None = None) -> TrainingAnswerResult | None:
        if client_attempt_id in self._training_records and self._training_owners.get(client_attempt_id) != user_id:
            raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used")
        return self._training_records.get(client_attempt_id)

    async def commit_training_record(self, record: TrainingAnswerResult,
                                     user_id: str | None = None) -> TrainingAnswerResult:
        async with self._catalog_lock:
            if user_id in self._retired_users:
                raise ApiError("AUTH_INVALID", "Account was migrated; login again")
            if record.trainingId not in self._training_items:
                raise ApiError("TRAINING_NOT_FOUND", "Training question not found")
            item = self._training_items[record.trainingId]
            await self.authorize_training(record.trainingId, user_id)
            existing = await self.get_training_attempt(record.clientAttemptId, user_id)
            if existing is not None:
                if existing.trainingId != record.trainingId or existing.submittedMove != record.submittedMove:
                    raise ApiError("TRAINING_ATTEMPT_CONFLICT", "Attempt ID already used")
                return existing
            self._training_records[record.clientAttemptId] = record
            self._training_owners[record.clientAttemptId] = user_id
            return record
