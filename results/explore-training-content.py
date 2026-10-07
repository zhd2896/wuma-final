"""Read-only exploratory engine playthrough; not human playtest evidence."""
import asyncio
import json
from backend.app.core.config import Settings
from backend.app.engine_adapter.node_worker import NodeEngineAdapter

CANDIDATES = [
 ('clamp', {'P11':'A','P08':'A','P12':'B','P05':'B','P20':'B','P25':'B'}, 'A'),
 ('carry', {'P08':'A','P21':'A','P12':'B','P14':'B','P05':'B','P25':'B'}, 'A'),
 ('clamp-edge', {'P01':'A','P09':'A','P02':'B','P21':'B','P25':'B'}, 'A'),
 ('carry-edge', {'P08':'A','P25':'A','P02':'B','P04':'B','P21':'B'}, 'A'),
 ('defense-top', {'P01':'B','P02':'A','P04':'B','P25':'A','P29':'B'}, 'A'),
 ('defense-left', {'P01':'B','P06':'A','P16':'B','P25':'A','P29':'B'}, 'A'),
 ('defense-clamp', {'P11':'B','P08':'B','P12':'A','P25':'A','P01':'B'}, 'A'),
 ('defense-carry', {'P12':'A','P14':'A','P25':'A','P08':'B','P21':'B','P01':'B'}, 'A'),
 ('lone-temple', {'P29':'A','P26':'B','P03':'B'}, 'A'),
 ('lone-wing', {'P28':'A','P29':'B','P03':'B'}, 'A'),
 ('lone-approach', {'P03':'A','P21':'B','P24':'B','P25':'B'}, 'A'),
 ('lone-center', {'P13':'A','P01':'B','P05':'B','P21':'B','P25':'B'}, 'A'),
]

async def main():
 adapter = NodeEngineAdapter(Settings())
 try:
  for key, pieces, player in CANDIDATES:
   state = await adapter.initialize(player)
   state.board.occupancy = {n:pieces.get(n) for n in state.board.occupancy}
   legal = await adapter.legal_moves(state)
   analysis = await adapter.analyze_position(state,2,10000,len(legal))
   turn = await adapter.execute_turn(state,analysis.bestMove)
   opposing = await adapter.legal_moves(turn.state) if not turn.game_over else []
   captures = [len((await adapter.execute_turn(turn.state,move)).capture.captured_nodes) for move in opposing]
   opposite = state.model_copy(deep=True, update={'current_player':'B' if player=='A' else 'A'})
   prior_moves = await adapter.legal_moves(opposite)
   prior_captures = [len((await adapter.execute_turn(opposite, move)).capture.captured_nodes) for move in prior_moves]
   print(json.dumps(dict(key=key, legal=len(legal),best=analysis.bestMove.model_dump(by_alias=True),
    score=analysis.bestScore, minScore=min(c.score for c in analysis.candidateMoves),
    bestCount=sum(c.score==analysis.bestScore for c in analysis.candidateMoves),
    captured=turn.capture.captured_nodes,opponentMaxCapture=max(captures,default=0),priorMaxCapture=max(prior_captures,default=0),
    nextMoves=len(opposing), timedOut=analysis.timedOut),ensure_ascii=False),flush=True)
 finally:
  await adapter.stop()

if __name__=='__main__': asyncio.run(main())
