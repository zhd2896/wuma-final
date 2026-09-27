"""Read-only position analysis over the authoritative game snapshot."""

from fastapi import APIRouter, Request

from backend.app.schemas.game import AnalyzeRequest, AnalyzeResponse, ApiResponse


router = APIRouter(prefix="/api/v1/ai", tags=["analysis"])


@router.post("/analyze", response_model=ApiResponse[AnalyzeResponse])
async def analyze(request: Request, body: AnalyzeRequest) -> ApiResponse[AnalyzeResponse]:
    return ApiResponse(data=await request.app.state.service.analyze(body.game_id,
                                                                     body.expected_version))
