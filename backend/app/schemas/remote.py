"""Transport contracts for device-token remote rooms."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from backend.app.schemas.game import (
    ClientRequestId, GameState, NodeId, Player, StrictModel, TurnResult,
)


DeviceId = Annotated[str, StringConstraints(min_length=8, max_length=64,
                                            pattern=r"^[A-Za-z0-9_-]+$")]
InviteCode = Annotated[str, StringConstraints(min_length=8, max_length=8,
                                              pattern=r"^[A-Z0-9]+$")]
RoomStatus = Literal["WAITING", "PLAYING", "FINISHED", "CANCELLED", "EXPIRED"]


class CreateRoomRequest(StrictModel):
    device_id: DeviceId
    public: bool = False


class JoinRoomRequest(StrictModel):
    invite_code: InviteCode
    device_id: DeviceId


class MatchRoomRequest(StrictModel):
    device_id: DeviceId


class RemoteMoveRequest(StrictModel):
    from_node: NodeId
    to_node: NodeId
    expected_version: int = Field(ge=0)
    client_request_id: ClientRequestId


class RemoteRoomResponse(StrictModel):
    game_id: str
    seat: Player
    room_status: RoomStatus
    invite_code: str
    public: bool
    expires_at: datetime
    version: int
    ply_count: int
    state: GameState
    token: str | None = None


class RemoteMoveResponse(StrictModel):
    version: int
    ply_count: int
    turn: TurnResult
