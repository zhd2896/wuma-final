/** Diagnostic only: categorize existing TT probes by requested search depth. */
import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && context.parentURL &&
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    throw error;
  }
} });

const { buildPositionSuite } = await import('./positions.mts');
const { AlphaBetaAI } = await import('../../miniprogram/ai/alpha-beta.ts');
const { TranspositionTable } = await import('../../miniprogram/ai/transposition-table.ts');
type TTEntry = import('../../miniprogram/ai/transposition-table.ts').TTEntry;
type ZobristKey = import('../../miniprogram/ai/zobrist.ts').ZobristKey;

type Bucket = { probes: number; hits: number; exact: number; bound: number;
  cutoffs: number; depthMismatch: number; sameDepthMiss: number; moveHints: number };
const totals = new Map<number, Bucket>();
function bucket(depth: number): Bucket {
  let result = totals.get(depth);
  if (!result) {
    result = { probes: 0, hits: 0, exact: 0, bound: 0, cutoffs: 0,
      depthMismatch: 0, sameDepthMiss: 0, moveHints: 0 };
    totals.set(depth, result);
  }
  return result;
}

class DiagnosticTable extends TranspositionTable {
  private readonly depths = new Map<string, { depth: number; bestMove: TTEntry['bestMove'] }>();
  override store(entry: TTEntry): boolean {
    const stored = super.store(entry);
    if (stored) this.depths.set(`${entry.hash}:${entry.stateSignature}`,
      { depth: entry.depth, bestMove: entry.bestMove });
    return stored;
  }
  override probe(hash: ZobristKey, signature: string, depth: number,
                 alpha: number, beta: number, ply: number) {
    const entry = this.depths.get(`${hash}:${signature}`);
    const result = super.probe(hash, signature, depth, alpha, beta, ply);
    const stats = bucket(depth);
    stats.probes++;
    if (entry?.bestMove) stats.moveHints++;
    if (entry && entry.depth !== depth) stats.depthMismatch++;
    else if (entry && !result.hit) stats.sameDepthMiss++;
    if (result.hit) {
      stats.hits++;
      if (result.exact) stats.exact++;
      else stats.bound++;
    }
    if (result.cutoff) stats.cutoffs++;
    return result;
  }
}

const positions = buildPositionSuite();
const scores = positions.map(position => {
  const table = new DiagnosticTable();
  const result = new AlphaBetaAI({ depth: 3, useMoveOrdering: true,
    useTranspositionTable: true }).search(position.state, position.currentPlayer, { table });
  return { positionId: position.id, score: result.evaluationScore,
    nodes: result.nodesSearched, ttHits: result.ttHits, ttCutoffs: result.ttCutoffs };
});
const output = { diagnostic: 'TT probe depth classification; not a timed benchmark',
  positionSuiteVersion: 'phase25_v1', depth: 3, positions: positions.length,
  byRequestedDepth: Object.fromEntries([...totals].sort(([a], [b]) => a - b)), scores };
const path = resolve(process.argv[2] ?? 'results/phase26_profile/tt-depth-diagnostic.json');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ path, byRequestedDepth: output.byRequestedDepth }));
