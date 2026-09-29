import asyncio

from backend.app.core.config import Settings
from backend.app.engine_adapter.node_worker import NodeEngineAdapter


def test_cancelled_call_cannot_desynchronize_next_response(tmp_path):
    worker = tmp_path / "slow_worker.mjs"
    worker.write_text("""
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  setTimeout(() => process.stdout.write(JSON.stringify({
    id: request.id, ok: true, data: { status: 'ok' },
  }) + '\\n'), 100);
}
""", encoding="utf-8")

    async def scenario():
        adapter = NodeEngineAdapter(Settings(engine_command=("node", str(worker)),
                                             engine_request_timeout_s=2))
        try:
            await adapter.start()
            pending = asyncio.create_task(adapter.request("ping"))
            await asyncio.sleep(0.02)
            pending.cancel()
            try:
                await pending
                assert False, "the request should have been cancelled"
            except asyncio.CancelledError:
                pass
            await adapter.ping()
        finally:
            await adapter.stop()

    asyncio.run(scenario())
