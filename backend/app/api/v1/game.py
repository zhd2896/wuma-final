"""Thin HTTP routing over GameService."""

from fastapi import APIRouter, Query, Request

from backend.app.schemas.game import (
    AiMoveRequest, AiMoveResponse, ApiResponse, CreateGameRequest, GameOperationRequest,
    GameOperationResponse, GameResponse, GameReview, LegalMovesResponse, MoveRequest,
    MoveResponse, NodeId, Player, ReviewRequest, LocalImportRequest, GameReplay,
)
from backend.app.schemas.explanation import ExplainedReview
from backend.app.schemas.coach import CoachHint, CoachHintRequest
from backend.app.schemas.training import TrainingList
from backend.app.api.v1.account import require_account, require_game_owner


router = APIRouter(prefix="/api/v1/game", tags=["game"])


@router.get("/{game_id}/replay", response_model=ApiResponse[GameReplay])
async def get_replay(request: Request, game_id: str) -> ApiResponse[GameReplay]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.get_replay(game_id))


@router.post("/{game_id}/training", response_model=ApiResponse[TrainingList])
async def generate_training(request: Request, game_id: str,
                            body: ReviewRequest = ReviewRequest()) -> ApiResponse[TrainingList]:
    user_id = await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.training_service.generate(
        game_id, body.reviewed_player, user_id))


@router.post("/{game_id}/coach/hint", response_model=ApiResponse[CoachHint])
async def coach_hint(request: Request, game_id: str,
                     body: CoachHintRequest) -> ApiResponse[CoachHint]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.coach_service.hint(
        game_id, body.level, body.expected_version))


@router.post("", response_model=ApiResponse[GameResponse])
async def create_game(request: Request, body: CreateGameRequest) -> ApiResponse[GameResponse]:
    user_id = await require_account(request)
    return ApiResponse(data=await request.app.state.service.create(body, user_id))


@router.post("/import-local", response_model=ApiResponse[GameResponse])
async def import_local(request: Request, body: LocalImportRequest) -> ApiResponse[GameResponse]:
    user_id = await require_account(request)
    if user_id is None:
        from backend.app.core.errors import ApiError
        raise ApiError("AUTH_REQUIRED", "Local score import requires an account")
    return ApiResponse(data=await request.app.state.service.import_local(body, user_id))


@router.get("/{game_id}", response_model=ApiResponse[GameResponse])
async def get_game(request: Request, game_id: str) -> ApiResponse[GameResponse]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.get(game_id))


@router.get("/{game_id}/legal-moves", response_model=ApiResponse[LegalMovesResponse])
async def legal_moves(request: Request, game_id: str,
                      from_node: NodeId | None = Query(default=None)) -> ApiResponse[LegalMovesResponse]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.legal_moves(game_id, from_node))


@router.post("/{game_id}/move", response_model=ApiResponse[MoveResponse])
async def move(request: Request, game_id: str, body: MoveRequest) -> ApiResponse[MoveResponse]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.move(game_id, body))


@router.post("/{game_id}/ai-move", response_model=ApiResponse[AiMoveResponse])
async def ai_move(request: Request, game_id: str, body: AiMoveRequest) -> ApiResponse[AiMoveResponse]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.ai_move(game_id, body))


@router.post("/{game_id}/undo", response_model=ApiResponse[GameOperationResponse])
async def undo(request: Request, game_id: str,
               body: GameOperationRequest) -> ApiResponse[GameOperationResponse]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.undo(game_id, body))


@router.post("/{game_id}/resign", response_model=ApiResponse[GameOperationResponse])
async def resign(request: Request, game_id: str,
                 body: GameOperationRequest) -> ApiResponse[GameOperationResponse]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.resign(game_id, body))


@router.post("/{game_id}/review", response_model=ApiResponse[GameReview])
async def create_review(request: Request, game_id: str,
                        body: ReviewRequest = ReviewRequest()) -> ApiResponse[GameReview]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.create_review(
        game_id, body.reviewed_player))


@router.get("/{game_id}/review", response_model=ApiResponse[GameReview])
async def get_review(request: Request, game_id: str,
                     reviewed_player: Player | None = Query(default=None)) -> ApiResponse[GameReview]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.service.get_review(game_id, reviewed_player))


@router.post("/{game_id}/review/explain", response_model=ApiResponse[ExplainedReview])
async def explain_review(request: Request, game_id: str,
                         body: ReviewRequest = ReviewRequest()) -> ApiResponse[ExplainedReview]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.explanation_service.explain(
        game_id, body.reviewed_player))


@router.get("/{game_id}/review/explain", response_model=ApiResponse[ExplainedReview])
async def get_review_explanation(request: Request, game_id: str,
                                 reviewed_player: Player | None = Query(default=None)) -> ApiResponse[ExplainedReview]:
    await require_game_owner(request, game_id)
    return ApiResponse(data=await request.app.state.explanation_service.get(game_id, reviewed_player))
