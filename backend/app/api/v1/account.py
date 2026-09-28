"""Persistent anonymous device identity and personal reads."""

import base64
import binascii
import hashlib
import json
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Query, Request
from typing import Literal

from backend.app.core.errors import ApiError
from backend.app.schemas.game import ApiResponse


router = APIRouter(prefix="/api/v1", tags=["account"])
TOKEN_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def _token_hash(token: str) -> str:
    return hashlib.sha256(bytes.fromhex(token)).hexdigest()


async def require_account(request: Request) -> str | None:
    if not request.app.state.require_auth:
        return None
    value = request.headers.get("authorization", "")
    if not value.startswith("Bearer ") or not TOKEN_PATTERN.fullmatch(value[7:]):
        raise ApiError("AUTH_REQUIRED", "Device account is required")
    user_id = await request.app.state.store.resolve_device(_token_hash(value[7:]))
    if user_id is None:
        raise ApiError("AUTH_INVALID", "Device account is unavailable")
    return user_id


async def require_game_owner(request: Request, game_id: str) -> str | None:
    user_id = await require_account(request)
    if user_id is not None:
        snapshot = await request.app.state.store.get_snapshot(game_id)
        if snapshot.user_id != user_id:
            raise ApiError("AUTH_FORBIDDEN", "Game belongs to another account")
    return user_id


async def require_training_owner(request: Request, training_id: str) -> str | None:
    user_id = await require_account(request)
    if user_id is not None:
        item = await request.app.state.store.get_training_item(training_id)
        await require_game_owner(request, item.sourceGameId)
    return user_id


def _encode_cursor(row: dict) -> str:
    value = json.dumps([row["cursorDate"], row["gameId"]], separators=(",", ":"))
    return base64.urlsafe_b64encode(value.encode()).decode().rstrip("=")


def _decode_cursor(value: str | None) -> tuple[datetime, str] | None:
    if value is None:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[1], str):
            raise ValueError
        timestamp = datetime.fromisoformat(payload[0])
        if timestamp.tzinfo is None or not re.fullmatch(r"[0-9a-f]{32}", payload[1]):
            raise ValueError
        return timestamp, payload[1]
    except (ValueError, TypeError, UnicodeError, binascii.Error):
        raise ApiError("INVALID_REQUEST", "Invalid history cursor") from None


@router.post("/auth/device", response_model=ApiResponse[dict])
async def create_device_account(request: Request) -> ApiResponse[dict]:
    token = secrets.token_hex(32)
    user_id = await request.app.state.store.register_device(_token_hash(token))
    return ApiResponse(data={"userId": user_id, "token": token})


@router.get("/me/profile", response_model=ApiResponse[dict])
async def my_profile(request: Request) -> ApiResponse[dict]:
    user_id = await require_account(request)
    if user_id is None:
        raise ApiError("AUTH_REQUIRED", "Device account is required")
    return ApiResponse(data=await request.app.state.store.personal_profile(user_id))


@router.get("/me/games", response_model=ApiResponse[dict])
async def my_games(request: Request, limit: int = Query(20, ge=1, le=100),
                   cursor: str | None = Query(None, max_length=512),
                   status: Literal["PLAYING", "FINISHED"] | None = Query(None)) -> ApiResponse[dict]:
    user_id = await require_account(request)
    if user_id is None:
        raise ApiError("AUTH_REQUIRED", "Device account is required")
    rows, more = await request.app.state.store.personal_games(user_id, limit,
                                                                _decode_cursor(cursor), status)
    next_cursor = _encode_cursor(rows[-1]) if more and rows else None
    return ApiResponse(data={"items": [{key: value for key, value in row.items()
                                        if key != "cursorDate"} for row in rows],
                             "nextCursor": next_cursor})
