"""Room APIs; seat token is required for every room-specific action."""

from backend.app.api.v1.account import require_account

from fastapi import APIRouter, Header, Query, Request

from backend.app.schemas.game import ApiResponse, GameReview, GameReplay, LegalMovesResponse, NodeId
from backend.app.schemas.game import AnalyzeResponse
from backend.app.schemas.remote import RemoteAnalyzeRequest
from backend.app.schemas.explanation import ExplainedReview
from backend.app.schemas.training import TrainingList
from backend.app.services.remote_service import token_hash
from backend.app.schemas.remote import (CreateRoomRequest, JoinRoomRequest,
                                         MatchRoomRequest, RemoteMoveRequest,
                                         RemoteMoveResponse, RemoteOperationRequest,
                                         RemoteRoomResponse)


router = APIRouter(prefix="/api/v1/remote", tags=["remote"])


@router.post('/rooms/{game_id}/analyze', response_model=ApiResponse[AnalyzeResponse])
async def analyze_room(request: Request, game_id: str, body: RemoteAnalyzeRequest,
                       token: str | None = Header(default=None, alias='X-Room-Token')):
    user_id = await require_account(request)
    return ApiResponse(data=await request.app.state.remote_service.analyze(
        game_id, token, body.expected_version, user_id))


@router.get('/rooms/{game_id}/review/explanation', response_model=ApiResponse[ExplainedReview])
async def get_explanation(request: Request, game_id: str,
                          token: str | None = Header(default=None, alias='X-Room-Token')):
    user_id = await require_account(request)
    remote = request.app.state.remote_service
    seat, version = await remote.learning_context(game_id, token, user_id)
    review = await request.app.state.service._get_review(game_id, seat, remote=True)
    result = await request.app.state.explanation_service._get_saved(review)
    await request.app.state.store.validate_remote_learning(game_id, token_hash(token or ''), user_id, version, seat)
    return ApiResponse(data=result)


@router.post('/rooms/{game_id}/review/explain', response_model=ApiResponse[ExplainedReview])
async def explain_review(request: Request, game_id: str,
                         token: str | None = Header(default=None, alias='X-Room-Token')):
    user_id = await require_account(request)
    remote = request.app.state.remote_service
    seat, version = await remote.learning_context(game_id, token, user_id)
    review = await request.app.state.service._get_review(game_id, seat, remote=True)
    result = await request.app.state.explanation_service._explain_saved(review,
        remote_token_hash=token_hash(token or ''), user_id=user_id, expected_version=version)
    await request.app.state.store.validate_remote_learning(game_id, token_hash(token or ''), user_id, version, seat)
    return ApiResponse(data=result)


@router.post('/rooms/{game_id}/training', response_model=ApiResponse[TrainingList])
async def generate_training(request: Request, game_id: str,
                            token: str | None = Header(default=None, alias='X-Room-Token')):
    user_id = await require_account(request)
    seat, version = await request.app.state.remote_service.learning_context(game_id, token, user_id)
    result = await request.app.state.training_service.generate(game_id, seat, user_id,
        remote_token_hash=token_hash(token or ''), expected_version=version)
    await request.app.state.store.validate_remote_learning(game_id, token_hash(token or ''), user_id, version, seat)
    return ApiResponse(data=result)


@router.get("/rooms/{game_id}/replay", response_model=ApiResponse[GameReplay])
async def get_replay(request: Request, game_id: str,
                     token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[GameReplay]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.get_replay(game_id, token, user_id))


@router.post("/rooms", response_model=ApiResponse[RemoteRoomResponse])
async def create_room(request: Request, body: CreateRoomRequest) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.create(body, await require_account(request)))


@router.post("/join", response_model=ApiResponse[RemoteRoomResponse])
async def join_room(request: Request, body: JoinRoomRequest) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.join(body, await require_account(request)))


@router.post("/match", response_model=ApiResponse[RemoteRoomResponse])
async def match_room(request: Request, body: MatchRoomRequest) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.match(body, await require_account(request)))


@router.get("/rooms/{game_id}", response_model=ApiResponse[RemoteRoomResponse])
async def get_room(request: Request, game_id: str,
                   token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.get(game_id, token, user_id))


@router.post("/rooms/{game_id}/cancel", response_model=ApiResponse[RemoteRoomResponse])
async def cancel_room(request: Request, game_id: str,
                      token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.cancel(game_id, token, user_id))


@router.get("/rooms/{game_id}/legal-moves", response_model=ApiResponse[LegalMovesResponse])
async def legal_moves(request: Request, game_id: str,
                      from_node: NodeId | None = Query(default=None),
                      token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[LegalMovesResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.legal_moves(game_id,
                                                                               token, from_node, user_id))


@router.post("/rooms/{game_id}/move", response_model=ApiResponse[RemoteMoveResponse])
async def move(request: Request, game_id: str, body: RemoteMoveRequest,
               token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteMoveResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.move(game_id, token, body, user_id))


@router.post("/rooms/{game_id}/undo-requests",
             response_model=ApiResponse[RemoteRoomResponse])
async def request_undo(request: Request, game_id: str, body: RemoteOperationRequest,
                       token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.request_undo(
        game_id, token, body, user_id))


@router.post("/rooms/{game_id}/undo-requests/{request_id}/accept",
             response_model=ApiResponse[RemoteRoomResponse])
async def accept_undo(request: Request, game_id: str, request_id: str,
                      body: RemoteOperationRequest,
                      token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.resolve_undo(
        game_id, request_id, token, body, "ACCEPT", user_id))


@router.post("/rooms/{game_id}/undo-requests/{request_id}/decline",
             response_model=ApiResponse[RemoteRoomResponse])
async def decline_undo(request: Request, game_id: str, request_id: str,
                       body: RemoteOperationRequest,
                       token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.resolve_undo(
        game_id, request_id, token, body, "DECLINE", user_id))


@router.post("/rooms/{game_id}/resign",
             response_model=ApiResponse[RemoteRoomResponse])
async def resign(request: Request, game_id: str, body: RemoteOperationRequest,
                 token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.resign(
        game_id, token, body, user_id))


@router.get("/rooms/{game_id}/review", response_model=ApiResponse[GameReview])
async def get_review(request: Request, game_id: str,
                     token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[GameReview]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.get_review(game_id, token, user_id))


@router.post("/rooms/{game_id}/review", response_model=ApiResponse[GameReview])
async def create_review(request: Request, game_id: str,
                        token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[GameReview]:
    user_id = await require_account(request)
    await request.app.state.remote_service.authorize(game_id, token, user_id)
    return ApiResponse(data=await request.app.state.remote_service.create_review(game_id, token, user_id))

@router.post("/rooms/{game_id}/recover", response_model=ApiResponse[RemoteRoomResponse])
async def recover_room(request: Request, game_id: str) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.recover(
        game_id, await require_account(request)))


@router.post("/rooms/{game_id}/claim", response_model=ApiResponse[RemoteRoomResponse])
async def claim_room(request: Request, game_id: str,
                     token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.recover(
        game_id, await require_account(request), token, claim=True))
