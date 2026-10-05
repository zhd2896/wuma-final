"""Room APIs; seat token is required for every room-specific action."""

from backend.app.api.v1.account import require_account

from fastapi import APIRouter, Header, Query, Request

from backend.app.schemas.game import ApiResponse, GameReview, LegalMovesResponse, NodeId
from backend.app.schemas.remote import (CreateRoomRequest, JoinRoomRequest,
                                         MatchRoomRequest, RemoteMoveRequest,
                                         RemoteMoveResponse, RemoteOperationRequest,
                                         RemoteRoomResponse)


router = APIRouter(prefix="/api/v1/remote", tags=["remote"])


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
