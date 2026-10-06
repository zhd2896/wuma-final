"""Public answer-free training questions and canonical Engine grading."""

from typing import Literal

from fastapi import APIRouter, Query, Request

from backend.app.schemas.game import ApiResponse, NodeId, Player
from backend.app.schemas.training import (TrainingAnswerRequest, TrainingAnswerResult,
                                          TrainingLegalMoves, TrainingList, TrainingQuestion)
from backend.app.api.v1.account import require_account, require_training_owner

router = APIRouter(prefix="/api/v1/training", tags=["training"])


@router.get("", response_model=ApiResponse[TrainingList])
async def list_training(request: Request, limit: int = Query(20, ge=1, le=100),
                        offset: int = Query(0, ge=0),
                        category: Literal["MISTAKE", "BLUNDER"] | None = Query(None),
                        training_type: Literal["BEST_MOVE"] | None = Query(None),
                        source: Literal['REVIEW', 'CURATED'] = Query('REVIEW'),
                        difficulty: Literal['EASY', 'NORMAL', 'COMPLEX', 'UNCALIBRATED'] | None = Query(None),
                        completed: bool | None = Query(None),
                        source_game_id: str | None = Query(None),
                        player: Player | None = Query(None)) -> ApiResponse[TrainingList]:
    user_id = await require_account(request)
    return ApiResponse(data=await request.app.state.training_service.list(
        limit, offset, category, training_type, user_id, source, difficulty, completed, source_game_id, player))


@router.get("/{training_id}", response_model=ApiResponse[TrainingQuestion])
async def get_training(request: Request, training_id: str) -> ApiResponse[TrainingQuestion]:
    user_id = await require_training_owner(request, training_id)
    return ApiResponse(data=await request.app.state.training_service.get(training_id, user_id))


@router.get("/{training_id}/legal-moves", response_model=ApiResponse[TrainingLegalMoves])
async def training_legal_moves(request: Request, training_id: str,
                               from_node: NodeId | None = Query(None)) -> ApiResponse[TrainingLegalMoves]:
    user_id = await require_training_owner(request, training_id)
    return ApiResponse(data=await request.app.state.training_service.legal_moves(
        training_id, from_node, user_id))


@router.post("/{training_id}/answer", response_model=ApiResponse[TrainingAnswerResult])
async def answer_training(request: Request, training_id: str,
                          body: TrainingAnswerRequest) -> ApiResponse[TrainingAnswerResult]:
    user_id = await require_training_owner(request, training_id)
    return ApiResponse(data=await request.app.state.training_service.answer(training_id, body, user_id))
