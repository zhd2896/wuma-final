"""Participant identity rules shared by transactional and in-memory stores."""
import hmac
from backend.app.core.errors import ApiError


def recovery_seat(room, user_id: str, claim_token_hash: str | None) -> str:
    if claim_token_hash is not None:
        if hmac.compare_digest(room.host_token_hash, claim_token_hash):
            seat, owner, other = 'A', room.host_user_id, room.guest_user_id
        elif room.guest_token_hash and hmac.compare_digest(room.guest_token_hash, claim_token_hash):
            seat, owner, other = 'B', room.guest_user_id, room.host_user_id
        else:
            raise ApiError('REMOTE_ACCESS_DENIED', 'Original seat token is required')
        if owner not in (None, user_id):
            raise ApiError('REMOTE_ACCESS_DENIED', 'Seat belongs to another account')
        if other == user_id:
            raise ApiError('REMOTE_SELF_JOIN', 'An account cannot occupy both seats')
        return seat
    if room.host_user_id == user_id:
        return 'A'
    if room.guest_user_id == user_id:
        return 'B'
    raise ApiError('REMOTE_ACCESS_DENIED', 'Account is not a room participant')
