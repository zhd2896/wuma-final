"""Game use cases; the TypeScript worker remains the only rule authority."""

import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from backend.app.core.config import Settings
from backend.app.core.errors import ApiError
from backend.app.engine_adapter.node_worker import NodeEngineAdapter
from backend.app.schemas.game import (
    AiMoveRequest, AiMoveResponse, AnalyzeResponse, CreateGameRequest, GameOperationRequest,
    GameOperationResponse, GameResponse, LegalMovesResponse, Move, MoveRequest, MoveResponse,
    GameState, GameReview, MoveReview, ReviewConfig, LocalImportRequest,
)
from backend.app.services.game_store import GameStore, StoredGame, StoredMove


class GameService:
    def __init__(self, adapter: NodeEngineAdapter, store: GameStore, settings: Settings):
        self.adapter = adapter
        self.store = store
        self.settings = settings

    async def create(self, request: CreateGameRequest, user_id: str | None = None) -> GameResponse:
        if request.mode == "LOCAL" and (request.ai_player is not None or request.ai_level is not None):
            raise ApiError("INVALID_REQUEST", "AI options require AI mode")
        ai_player = (request.ai_player or "B") if request.mode == "AI" else None
        ai_level = "STANDARD" if request.mode == "AI" else None
        state = await self.adapter.initialize(request.first_player)
        game_id = await self.store.create(state, request.mode, ai_player, ai_level, user_id)
        return GameResponse(game_id=game_id, version=0, ply_count=0,
                            state=state, mode=request.mode,
                            human_player=self._human(ai_player), ai_player=ai_player,
                            ai_level=ai_level)

    async def import_local(self, request: LocalImportRequest, user_id: str) -> GameResponse:
        digest = hashlib.sha256(json.dumps(request.model_dump(mode="json", by_alias=True),
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        existing = await self.store.lookup_local_import(user_id, request.clientGameId, digest)
        if existing is not None:
            return await self.get(existing)
        initial = await self.adapter.initialize(request.firstPlayer)
        state = initial
        turns = []
        for move in request.moves:
            if state.game_status == "FINISHED":
                raise ApiError("GAME_ALREADY_FINISHED", "Score contains a move after game end")
            turn = await self.adapter.execute_turn(state, Move(from_node=move.from_node, to_node=move.to_node))
            turns.append(turn)
            state = turn.state
        if request.resigningPlayer is not None:
            if state.game_status == "FINISHED":
                raise ApiError("GAME_ALREADY_FINISHED", "Natural terminal games cannot resign")
            if request.resigningPlayer != state.current_player:
                raise ApiError("NOT_PLAYER_TURN", "Only the current actor can resign")
        game_id = await self.store.commit_local_import(user_id, request.clientGameId, digest,
            initial, turns, request.resigningPlayer)
        return await self.get(game_id)

    @staticmethod
    def _human(ai_player: str | None) -> str | None:
        return None if ai_player is None else ("B" if ai_player == "A" else "A")

    async def get(self, game_id: str) -> GameResponse:
        snapshot = await self.store.get_snapshot(game_id)
        if snapshot.mode == "REMOTE":
            raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
        return GameResponse(game_id=game_id, version=snapshot.version,
                            ply_count=snapshot.ply_count,
                            state=snapshot.state, mode=snapshot.mode,
                            human_player=self._human(snapshot.ai_player),
                            ai_player=snapshot.ai_player, ai_level=snapshot.ai_level)

    async def legal_moves(self, game_id: str, from_node: str | None) -> LegalMovesResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            snapshot = await self.store.get_snapshot(game_id)
            if snapshot.mode == "REMOTE":
                raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
            state = snapshot.state
            moves = await self.adapter.legal_moves(state)
            if from_node is not None:
                moves = [move for move in moves if move.from_node == from_node]
            return LegalMovesResponse(moves=moves)

    async def move(self, game_id: str, request: MoveRequest) -> MoveResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            snapshot = await self.store.get_snapshot(game_id)
            if snapshot.mode == "REMOTE":
                raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room move endpoint")
            if snapshot.state.game_status == "FINISHED":
                raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
            if snapshot.mode == "AI" and snapshot.state.current_player != self._human(snapshot.ai_player):
                raise ApiError("NOT_HUMAN_TURN", "It is the AI turn")
            turn = await self.adapter.execute_turn(snapshot.state, Move(from_node=request.from_node,
                                                                         to_node=request.to_node))
            await self.store.commit_turn(game_id, snapshot.version, turn, "HUMAN")
            return MoveResponse(turn=turn)

    async def ai_move(self, game_id: str, request: AiMoveRequest) -> AiMoveResponse:
        lock = await self.store.lock_for(game_id)
        async with lock:
            snapshot = await self.store.get_snapshot(game_id)
            if snapshot.state.game_status == "FINISHED":
                raise ApiError("GAME_ALREADY_FINISHED", "Game already finished")
            if snapshot.mode != "AI" or snapshot.ai_player is None:
                raise ApiError("AI_MODE_REQUIRED", "This game has no AI player")
            if snapshot.state.current_player != snapshot.ai_player:
                raise ApiError("NOT_AI_TURN", "It is the human turn")
            depth = self.settings.ai_default_max_depth
            budget = self.settings.ai_default_time_limit_ms
            search, turn = await self.adapter.ai_move(snapshot.state, depth, budget)
            await self.store.commit_turn(game_id, snapshot.version, turn, "AI", search)
            return AiMoveResponse(search=search, turn=turn)

    async def undo(self, game_id: str,
                   request: GameOperationRequest) -> GameOperationResponse:
        snapshot = await self.store.get_snapshot(game_id)
        if snapshot.mode == "REMOTE":
            raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
        return await self.store.commit_undo(game_id, request)

    async def resign(self, game_id: str,
                     request: GameOperationRequest) -> GameOperationResponse:
        snapshot = await self.store.get_snapshot(game_id)
        if snapshot.mode == "REMOTE":
            raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
        return await self.store.commit_resign(game_id, request)

    async def replay_game(self, game_id: str) -> list[GameState]:
        """Read historical snapshots without reinterpreting moves under future rules."""
        snapshot, moves = await self.store.read_replay(game_id)
        return await self._validated_replay(snapshot, moves)

    async def _validated_replay(self, snapshot: StoredGame,
                                moves: list[StoredMove]) -> list[GameState]:
        if len(moves) != snapshot.ply_count:
            raise ApiError("REPLAY_INTEGRITY_ERROR", "Active move count does not match game")
        frames = [snapshot.initial_state]
        for number, item in enumerate(moves, 1):
            if item.turn_number != number or item.turn.before_state != frames[-1]:
                raise ApiError("REPLAY_INTEGRITY_ERROR", "Move history is not contiguous")
            frames.append(item.turn.state)
        if frames[-1] == snapshot.state:
            return frames
        event = await self.store.get_terminal_event(snapshot.game_id)
        resigned_state = None
        if event is not None:
            resigned_state = event.state_before.model_copy(update={
                "game_status": "FINISHED",
                "winner": event.winner,
                "winner_reason": "RESIGN",
            })
        if not (
            snapshot.state.game_status == "FINISHED"
            and snapshot.state.winner is not None
            and snapshot.state.winner_reason == "RESIGN"
            and event is not None
            and event.event_type == "RESIGN"
            and event.revision == snapshot.version
            and event.winner == snapshot.state.winner
            and event.actor == ("B" if snapshot.state.winner == "A" else "A")
            and event.state_before.game_status == "PLAYING"
            and event.state_before.winner is None
            and event.state_before.winner_reason is None
            and event.state_before == frames[-1]
            and event.state_after == resigned_state
            and snapshot.state == resigned_state
        ):
            raise ApiError("REPLAY_INTEGRITY_ERROR", "Final state differs from move history")
        frames.append(snapshot.state)
        return frames

    async def analyze(self, game_id: str, expected_version: int | None = None) -> AnalyzeResponse:
        # Reading and saving are short independent transactions; the worker runs between them.
        snapshot = await self.store.get_snapshot(game_id)
        if snapshot.mode == "REMOTE":
            raise ApiError("REMOTE_ACTION_REQUIRED", "Use the remote room endpoint")
        if expected_version is not None and snapshot.version != expected_version:
            raise ApiError("GAME_STATE_CONFLICT", "Game state changed; retry analysis")
        analysis = await self.adapter.analyze_position(
            snapshot.state, self.settings.analysis_max_depth,
            self.settings.analysis_time_limit_ms, self.settings.analysis_candidate_limit,
        )
        if snapshot.state.game_status == "PLAYING":
            await self.store.commit_analysis(game_id, snapshot.version, analysis)
        return AnalyzeResponse(game_id=game_id, game_version=snapshot.version,
                               **analysis.model_dump())

    @staticmethod
    def _reviewed_player(snapshot, requested: str | None, *, remote: bool = False) -> str:
        if snapshot.mode == "REMOTE":
            if not remote or requested not in ("A", "B"):
                raise ApiError("REMOTE_ACTION_REQUIRED", "Remote room review requires a seat token")
            return requested
        human = GameService._human(snapshot.ai_player)
        if snapshot.mode == "AI":
            if requested is not None and requested != human:
                raise ApiError("INVALID_REQUEST", "Only the human player can be reviewed")
            return human
        return requested or "A"

    async def get_review(self, game_id: str, reviewed_player: str | None = None) -> GameReview:
        return await self._get_review(game_id, reviewed_player)

    async def _get_review(self, game_id: str, reviewed_player: str | None, *,
                          remote: bool = False) -> GameReview:
        snapshot = await self.store.get_snapshot(game_id)
        player = self._reviewed_player(snapshot, reviewed_player, remote=remote)
        review = await self.store.get_review(game_id, player, ReviewConfig().version)
        if review is None:
            raise ApiError("REVIEW_NOT_FOUND", "Review has not been generated")
        replay_snapshot, moves = await self.store.read_replay(game_id)
        await self._validated_replay(replay_snapshot, moves)
        return self._review_with_snapshots(review, moves)

    @staticmethod
    def _review_with_snapshots(review: GameReview, moves: list[StoredMove]) -> GameReview:
        by_id = {item.game_move_id: item for item in moves}
        rows = []
        for row in review.moveReviews:
            item = by_id.get(row.gameMoveId)
            if (item is None or item.turn_number != row.turn
                    or item.turn.move != row.actualMove
                    or item.turn.before_state.current_player != row.player):
                raise ApiError("REPLAY_INTEGRITY_ERROR", "Review and active move snapshots disagree")
            rows.append(row.model_copy(update={"stateBefore": item.turn.before_state}))
        return review.model_copy(update={"moveReviews": rows})

    async def create_review(self, game_id: str,
                            reviewed_player: str | None = None) -> GameReview:
        return await self._create_review(game_id, reviewed_player)

    async def _create_review(self, game_id: str, reviewed_player: str | None, *,
                             remote: bool = False, remote_user_id: str | None = None,
                             remote_token_hash: str | None = None) -> GameReview:
        config = ReviewConfig()
        snapshot, moves = await self.store.read_replay(game_id)
        player = self._reviewed_player(snapshot, reviewed_player, remote=remote)
        if snapshot.state.game_status != "FINISHED":
            raise ApiError("GAME_NOT_FINISHED", "Game has not finished")
        await self._validated_replay(snapshot, moves)
        existing = await self.store.get_review(game_id, player, config.version)
        if existing is not None:
            return self._review_with_snapshots(existing, moves)
        reviewed = []
        for item in moves:
            if item.actor_type != "HUMAN" or item.turn.before_state.current_player != player:
                continue
            analysis = await self.adapter.review_move(
                item.turn.before_state, item.turn.state, item.turn.move, config)
            if analysis.scorePerspective != player or analysis.scoreLoss < 0:
                raise ApiError("REVIEW_INCOMPLETE", "Review score perspective is inconsistent")
            reviewed.append(MoveReview(gameMoveId=item.game_move_id, turn=item.turn_number,
                                       player=player, **analysis.model_dump()))
        counts = {category: sum(move.category == category for move in reviewed)
                  for category in ("GOOD", "NORMAL", "MISTAKE", "BLUNDER")}
        turning = sorted((move for move in reviewed if move.category in ("MISTAKE", "BLUNDER")),
                         key=lambda move: (-move.scoreLoss, move.turn))[:config.turning_point_limit]
        best_count = sum(move.bestMoveEquivalent for move in reviewed)
        review = GameReview(
            id=uuid4().hex, gameId=game_id, reviewedPlayer=player, overallScore=None,
            goodMoves=counts["GOOD"], normalMoves=counts["NORMAL"],
            mistakes=counts["MISTAKE"], blunders=counts["BLUNDER"],
            bestMoveRate=best_count / len(reviewed) if reviewed else 0,
            turningPoints=[move.turn for move in turning],
            winner=snapshot.state.winner, winnerReason=snapshot.state.winner_reason,
            reviewConfig=config, reviewConfigVersion=config.version,
            moveReviews=reviewed, createdAt=datetime.now(timezone.utc),
        )
        if remote:
            saved = await self.store.commit_review(review, snapshot.version,
                user_id=remote_user_id, remote_token_hash=remote_token_hash)
        else:
            saved = await self.store.commit_review(review, snapshot.version)
        return self._review_with_snapshots(saved, moves)
