"""FastAPI entry point. Chess behavior is delegated to the Node worker."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.api.v1.game import router as game_router
from backend.app.api.v1.remote import router as remote_router
from backend.app.api.v1.analysis import router as analysis_router
from backend.app.core.config import Settings
from backend.app.core.errors import ApiError
from backend.app.engine_adapter.node_worker import NodeEngineAdapter
from backend.app.schemas.game import ApiResponse, HealthResponse
from backend.app.services.game_service import GameService
from backend.app.services.remote_service import RemoteService
from backend.app.services.game_store import GameStore
from backend.app.db.repositories.mysql_store import MySQLGameStore
from backend.app.services.review_explanation.service import ExplanationService
from backend.app.services.review_explanation.provider import ConfiguredLLMProvider, LLMProvider
from backend.app.services.coach.service import CoachService
from backend.app.services.training_service import TrainingService
from backend.app.api.v1.training import router as training_router
from backend.app.api.v1.account import router as account_router


def error_response(error: ApiError) -> JSONResponse:
    return JSONResponse(status_code=error.status_code,
                        content={"code": error.code, "message": error.message, "data": None})


def create_app(settings: Settings | None = None, store: GameStore | None = None,
               llm_provider: LLMProvider | None = None,
               require_auth: bool = True) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        adapter = NodeEngineAdapter(settings)
        active_store = store if store is not None else MySQLGameStore(settings.database_url)
        app.state.adapter = adapter
        app.state.store = active_store
        app.state.require_auth = require_auth
        app.state.service = GameService(adapter, active_store, settings)
        app.state.remote_service = RemoteService(adapter, active_store)
        provider = llm_provider
        if provider is None and settings.llm_api_key and settings.llm_base_url and settings.llm_model:
            provider = ConfiguredLLMProvider(settings)
        app.state.explanation_service = ExplanationService(
            app.state.service, active_store, provider, settings.llm_timeout_seconds,
            settings.llm_total_timeout_seconds)
        app.state.coach_service = CoachService(app.state.service, active_store, provider,
                                               settings.llm_timeout_seconds)
        app.state.training_service = TrainingService(app.state.service, active_store)
        try:
            await adapter.start()
        except ApiError:
            # The service remains available to report ENGINE_UNAVAILABLE uniformly.
            pass
        try:
            yield
        finally:
            await adapter.stop()
            if store is None:
                active_store.close()

    app = FastAPI(title="弈智五马 API", version="0.1.0", lifespan=lifespan)
    app.include_router(game_router)
    app.include_router(remote_router)
    app.include_router(analysis_router)
    app.include_router(training_router)
    app.include_router(account_router)

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        is_node = any(
            error.get("type") == "string_pattern_mismatch" and
            any(part in {"from_node", "to_node"} for part in error.get("loc", ()))
            for error in exc.errors()
        )
        return error_response(ApiError("NODE_NOT_FOUND" if is_node else "INVALID_REQUEST",
                                       "Unknown board node" if is_node else "Invalid request"))

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code,
                            content={"code": "HTTP_ERROR", "message": str(exc.detail), "data": None})

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_request: Request, _exc: Exception) -> JSONResponse:
        return error_response(ApiError("ENGINE_FAILURE", "Unexpected server error"))

    @app.get("/health", response_model=ApiResponse[HealthResponse], tags=["health"])
    async def health(request: Request) -> ApiResponse[HealthResponse]:
        await request.app.state.adapter.ping()
        return ApiResponse(data=HealthResponse(status="ok", engine="ok"))

    @app.get("/ready", response_model=ApiResponse[HealthResponse], tags=["health"])
    async def ready(request: Request) -> ApiResponse[HealthResponse]:
        await request.app.state.adapter.ping()
        await request.app.state.store.ping()
        return ApiResponse(data=HealthResponse(status="ok", engine="ok"))

    return app


app = create_app()
