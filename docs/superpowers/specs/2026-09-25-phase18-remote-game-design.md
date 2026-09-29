# PHASE 18 Remote Game Design

The existing `chess-board` component and local two-player `RuleEngine` flow remain in place. A new `remote` entry opens the existing game page. Its board is a projection of the last successful FastAPI `GameState`, never a locally executed turn.

`api-client.ts` owns `wx.request`, base URL, envelope parsing and public error codes. `game-api.ts` exposes typed create/get/legal/move methods matching `backend/app/schemas/game.py`; AI move is transport-only for this phase. A remote controller owns the saved game ID, restore/create flow, selection, loading flags, stale-response rejection and move submission. The page only renders controller snapshots and displays messages. One mapper converts both local and remote canonical `GameState` to the existing board view.

Remote entry reads only `activeRemoteGameId` from storage, fetches the authoritative state, and clears an ID that returns `GAME_NOT_FOUND`. It creates a game when no ID exists. Clicking a current-player piece fetches legal moves; clicking a highlighted target posts `from_node/to_node`. The board updates only from the returned `TurnResult.state`. Move conflicts fetch fresh state and clear selection. Other failures leave the board unchanged. A request generation counter prevents updates after page unload. Restart creates a new database game and replaces the stored ID.

Tests cover network parsing, DTO mapping, remote controller behavior, unchanged local play, backend contracts and a real FastAPI/MySQL/Node link. If the installed WeChat developer tool cannot automate UI interaction, report that limitation explicitly rather than claiming a full developer-tool end-to-end pass.
