import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createInterface } from 'node:readline';

// Node 24 strips TypeScript types. This hook resolves the extensionless imports
// already used by the tested WeChat engine; it does not transform engine logic.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && context.parentURL && error.code === 'ERR_MODULE_NOT_FOUND') {
        const tsUrl = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
      }
      throw error;
    }
  },
});

const { NODE_IDS, RuleEngine } = await import('../miniprogram/domain/index.ts');
const { IterativeDeepeningAI } = await import('../miniprogram/ai/iterative-deepening.ts');
const { analyzePosition } = await import('../miniprogram/ai/position-analysis.ts');
const { analyzeReviewMove } = await import('../miniprogram/ai/review-analysis.ts');

class EngineCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function moveError(state, move) {
  if (state.game_status === 'FINISHED') {
    return new EngineCommandError('GAME_ALREADY_FINISHED', 'Game already finished');
  }
  if (!NODE_IDS.includes(move.from) || !NODE_IDS.includes(move.to)) {
    return new EngineCommandError('NODE_NOT_FOUND', 'Unknown board node');
  }
  const owner = state.board.occupancy[move.from];
  if (owner !== state.current_player) {
    return new EngineCommandError(owner === null ? 'INVALID_MOVE' : 'NOT_PLAYER_TURN',
      owner === null ? 'No piece at source' : 'Source piece belongs to another player');
  }
  if (state.board.occupancy[move.to] !== null) {
    return new EngineCommandError('TARGET_OCCUPIED', 'Target is occupied');
  }
  // Error classification delegates line and obstruction checks to RuleEngine.
  if (RuleEngine.findCommonLine(move.from, move.to) &&
      !RuleEngine.isPathClear(state.board, move.from, move.to)) {
    return new EngineCommandError('PATH_BLOCKED', 'Path is blocked');
  }
  return new EngineCommandError('INVALID_MOVE', 'Illegal move');
}

function execute(state, move) {
  if (!RuleEngine.validateMove(state, move)) throw moveError(state, move);
  return RuleEngine.executeTurn(state, move);
}

function dispatch(command, payload) {
  switch (command) {
    case 'ping':
      return { status: 'ok' };
    case 'initialize':
      return RuleEngine.initializeGame({ firstPlayer: payload.first_player });
    case 'legal_moves':
      return RuleEngine.getAllLegalMoves(payload.state);
    case 'execute_turn':
      return execute(payload.state, payload.move);
    case 'ai_move': {
      if (payload.state.game_status === 'FINISHED') {
        throw new EngineCommandError('GAME_ALREADY_FINISHED', 'Game already finished');
      }
      const search = new IterativeDeepeningAI({
        maxDepth: payload.max_depth,
        timeLimitMs: payload.time_limit_ms,
      }).search(payload.state);
      if (!search.bestMove) {
        throw new EngineCommandError('RULE_AMBIGUITY', 'No legal move in a playing position');
      }
      const turn = execute(payload.state, search.bestMove);
      return { search, turn };
    }
    case 'analyze_position':
      return analyzePosition(payload.state, {
        maxDepth: payload.max_depth,
        timeLimitMs: payload.time_limit_ms,
        candidateLimit: payload.candidate_limit,
      });
    case 'review_move':
      return analyzeReviewMove(payload.state_before, payload.state_after, payload.actual_move, {
        maxDepth: payload.config.max_depth,
        timeLimitMs: payload.config.time_limit_ms_per_move,
        candidateLimit: payload.config.candidate_limit,
        goodMaxLoss: payload.config.good_max_loss,
        normalMaxLoss: payload.config.normal_max_loss,
        mistakeMaxLoss: payload.config.mistake_max_loss,
      });
    default:
      throw new EngineCommandError('INVALID_REQUEST', 'Unknown engine command');
  }
}

for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let id = null;
  try {
    const request = JSON.parse(line);
    id = request.id;
    const data = dispatch(request.command, request.payload ?? {});
    process.stdout.write(`${JSON.stringify({ id, ok: true, data })}\n`);
  } catch (error) {
    const code = error?.code ?? 'ENGINE_FAILURE';
    process.stdout.write(`${JSON.stringify({ id, ok: false, error: {
      code, message: error?.message ?? 'Engine failure',
    } })}\n`);
  }
}
