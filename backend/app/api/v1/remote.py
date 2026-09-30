"""Room APIs; seat token is required for every room-specific action."""

from fastapi import APIRouter, Header, Query, Request

from backend.app.schemas.game import ApiResponse, LegalMovesResponse, NodeId
from backend.app.schemas.remote import (CreateRoomRequest, JoinRoomRequest,
                                         MatchRoomRequest, RemoteMoveRequest,
                                         RemoteMoveResponse, RemoteOperationRequest,
                                         RemoteRoomResponse)


router = APIRouter(prefix="/api/v1/remote", tags=["remote"])


@router.post("/rooms", response_model=ApiResponse[RemoteRoomResponse])
async def create_room(request: Request, body: CreateRoomRequest) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.create(body))


@router.post("/join", response_model=ApiResponse[RemoteRoomResponse])
async def join_room(request: Request, body: JoinRoomRequest) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.join(body))


@router.post("/match", response_model=ApiResponse[RemoteRoomResponse])
async def match_room(request: Request, body: MatchRoomRequest) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.match(body))


@router.get("/rooms/{game_id}", response_model=ApiResponse[RemoteRoomResponse])
async def get_room(request: Request, game_id: str,
                   token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.get(game_id, token))


@router.post("/rooms/{game_id}/cancel", response_model=ApiResponse[RemoteRoomResponse])
async def cancel_room(request: Request, game_id: str,
                      token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.cancel(game_id, token))


@router.get("/rooms/{game_id}/legal-moves", response_model=ApiResponse[LegalMovesResponse])
async def legal_moves(request: Request, game_id: str,
                      from_node: NodeId | None = Query(default=None),
                      token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[LegalMovesResponse]:
    return ApiResponse(data=await request.app.state.remote_service.legal_moves(game_id,
                                                                               token, from_node))


@router.post("/rooms/{game_id}/move", response_model=ApiResponse[RemoteMoveResponse])
async def move(request: Request, game_id: str, body: RemoteMoveRequest,
               token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteMoveResponse]:
    return ApiResponse(data=await request.app.state.remote_service.move(game_id, token, body))


@router.post("/rooms/{game_id}/undo-requests",
             response_model=ApiResponse[RemoteRoomResponse])
async def request_undo(request: Request, game_id: str, body: RemoteOperationRequest,
                       token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.request_undo(
        game_id, token, body))


@router.post("/rooms/{game_id}/undo-requests/{request_id}/accept",
             response_model=ApiResponse[RemoteRoomResponse])
async def accept_undo(request: Request, game_id: str, request_id: str,
                      body: RemoteOperationRequest,
                      token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.resolve_undo(
        game_id, request_id, token, body, "ACCEPT"))


@router.post("/rooms/{game_id}/undo-requests/{request_id}/decline",
             response_model=ApiResponse[RemoteRoomResponse])
async def decline_undo(request: Request, game_id: str, request_id: str,
                       body: RemoteOperationRequest,
                       token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.resolve_undo(
        game_id, request_id, token, body, "DECLINE"))


@router.post("/rooms/{game_id}/resign",
             response_model=ApiResponse[RemoteRoomResponse])
async def resign(request: Request, game_id: str, body: RemoteOperationRequest,
                 token: str | None = Header(default=None, alias="X-Room-Token")) -> ApiResponse[RemoteRoomResponse]:
    return ApiResponse(data=await request.app.state.remote_service.resign(
        game_id, token, body))
