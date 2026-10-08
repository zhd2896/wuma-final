"""Async JSON-line bridge to one long-running canonical Node Engine worker."""

import asyncio
import json

from pydantic import ValidationError

from backend.app.core.config import REPO_ROOT, Settings
from backend.app.core.errors import ApiError
from backend.app.schemas.game import (GameState, Move, PositionAnalysis, ReviewConfig,
                                      ReviewMoveAnalysis, SearchResult, TurnResult)


class NodeEngineAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._next_id = 0
        self._stderr_task: asyncio.Task | None = None
        self.last_stderr = ""

    async def start(self) -> None:
        await self.ping()

    async def _spawn_locked(self) -> None:
        try:
            self.process = await asyncio.create_subprocess_exec(
                *self.settings.engine_command,
                cwd=str(REPO_ROOT),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self._stderr_task = asyncio.create_task(self._drain_stderr())
        except OSError as exc:
            raise ApiError("ENGINE_UNAVAILABLE", f"Canonical Engine unavailable: {exc}") from exc

    async def _drain_stderr(self) -> None:
        if not self.process or not self.process.stderr:
            return
        while line := await self.process.stderr.readline():
            self.last_stderr = line.decode("utf-8", errors="replace").strip()

    async def _discard_locked(self) -> None:
        process = self.process
        self.process = None
        if process and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        if process:
            try:
                await asyncio.wait_for(process.wait(), timeout=2)
            except asyncio.TimeoutError:
                pass
        if self._stderr_task:
            self._stderr_task.cancel()
            try:
                await self._stderr_task
            except asyncio.CancelledError:
                pass
            self._stderr_task = None

    async def stop(self) -> None:
        async with self._lock:
            await self._discard_locked()

    async def request(self, command: str, payload: dict | None = None) -> object:
        async with self._lock:
            process = self.process
            if not process or process.returncode is not None:
                await self._discard_locked()
                await self._spawn_locked()
                process = self.process
            if not process or not process.stdin or not process.stdout:
                raise ApiError("ENGINE_UNAVAILABLE", "Canonical Engine worker could not start")
            self._next_id += 1
            request_id = self._next_id
            message = json.dumps({"id": request_id, "command": command,
                                  "payload": payload or {}}, separators=(",", ":")) + "\n"
            timeout = max(self.settings.engine_request_timeout_s,
                          ((payload or {}).get("time_limit_ms", 0) / 1000) + 10)
            try:
                process.stdin.write(message.encode("utf-8"))
                await process.stdin.drain()
                line = await asyncio.wait_for(process.stdout.readline(), timeout=timeout)
                if not line:
                    raise ApiError("ENGINE_UNAVAILABLE", "Canonical Engine worker closed its output")
                response = json.loads(line)
                if response.get("id") != request_id:
                    raise ApiError("ENGINE_UNAVAILABLE", "Canonical Engine response ID mismatch")
            except asyncio.CancelledError:
                # Discard the process: its late reply must never reach the next call.
                await self._discard_locked()
                raise
            except ApiError:
                await self._discard_locked()
                raise
            except (OSError, BrokenPipeError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
                await self._discard_locked()
                raise ApiError("ENGINE_UNAVAILABLE", f"Canonical Engine transport failed: {exc}") from exc
            if not response.get("ok"):
                error = response.get("error") or {}
                raise ApiError(error.get("code", "ENGINE_FAILURE"),
                               error.get("message", "Canonical Engine failed"))
            return response.get("data")

    @staticmethod
    def _parse(model, data):
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            raise ApiError("ENGINE_FAILURE", f"Canonical Engine returned invalid data: {exc}") from exc

    async def ping(self) -> None:
        await self.request("ping")

    async def initialize(self, first_player: str) -> GameState:
        return self._parse(GameState, await self.request("initialize", {"first_player": first_player}))

    async def legal_moves(self, state: GameState) -> list[Move]:
        data = await self.request("legal_moves", {"state": state.model_dump(by_alias=True)})
        return [self._parse(Move, move) for move in data]

    async def execute_turn(self, state: GameState, move: Move) -> TurnResult:
        data = await self.request("execute_turn", {
            "state": state.model_dump(by_alias=True), "move": move.model_dump(by_alias=True),
        })
        return self._parse(TurnResult, data)

    async def ai_move(self, state: GameState, max_depth: int,
                      time_limit_ms: int) -> tuple[SearchResult, TurnResult]:
        data = await self.request("ai_move", {
            "state": state.model_dump(by_alias=True),
            "max_depth": max_depth, "time_limit_ms": time_limit_ms,
        })
        return self._parse(SearchResult, data["search"]), self._parse(TurnResult, data["turn"])

    async def analyze_position(self, state: GameState, max_depth: int,
                               time_limit_ms: int, candidate_limit: int,
                               scoring_config_version: int = 2) -> PositionAnalysis:
        data = await self.request("analyze_position", {
            "state": state.model_dump(by_alias=True), "max_depth": max_depth,
            "time_limit_ms": time_limit_ms, "candidate_limit": candidate_limit,
            "scoring_config_version": scoring_config_version,
        })
        return self._parse(PositionAnalysis, data)

    async def review_move(self, state_before: GameState, state_after: GameState,
                          actual_move: Move, config: ReviewConfig) -> ReviewMoveAnalysis:
        data = await self.request("review_move", {
            "state_before": state_before.model_dump(mode="json"),
            "state_after": state_after.model_dump(mode="json"),
            "actual_move": actual_move.model_dump(mode="json", by_alias=True),
            "config": config.model_dump(mode="json"),
            "time_limit_ms": config.time_limit_ms_per_move,
        })
        return self._parse(ReviewMoveAnalysis, data)
