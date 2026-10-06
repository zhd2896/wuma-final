import { isAiLevel } from './api-contract';
/** Validate saved transport snapshots without executing current game rules. */
import { NODE_IDS } from '../domain/index';
import type { GameState, CaptureResult, Player } from '../domain/index';
import type { GameDto, GameReplayDto } from './api-contract';
import { ApiError } from './api-client';
const player = (v: unknown): v is Player => v === 'A' || v === 'B';
const integer = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const node = (v: unknown) => NODE_IDS.includes(v as typeof NODE_IDS[number]);
function invalid(): never { throw new ApiError('INVALID_GAME_RESPONSE', 502); }
export function validSavedState(s: GameState): boolean {
  return !!s && !!s.board?.occupancy && !!s.players?.A && !!s.players?.B &&
    NODE_IDS.every(id => s.board.occupancy[id] === null || player(s.board.occupancy[id])) &&
    integer(s.players.A.reserve_count) && integer(s.players.B.reserve_count) &&
    player(s.first_player) && player(s.current_player) &&
    (s.game_status === 'PLAYING' ? s.winner === null && s.winner_reason === null :
      s.game_status === 'FINISHED' && player(s.winner) &&
      ['CAPTURE_ALL', 'TEMPLE_TRAP', 'LONE_PIECE_IMMOBILIZED', 'RESIGN'].includes(s.winner_reason ?? ''));
}
function validCapture(c: CaptureResult): boolean {
  return !!c && Array.isArray(c.patterns) && c.patterns.every(p => !!p &&
    ['CLAMP','CARRY'].includes(p.capture_type) && typeof p.line_id === 'string' &&
    Array.isArray(p.segment_nodes) && p.segment_nodes.length === 3 && p.segment_nodes.every(node) &&
    Array.isArray(p.attacker_nodes) && p.attacker_nodes.every(node) &&
    Array.isArray(p.captured_nodes) && p.captured_nodes.every(node) && typeof p.created_by_move === 'boolean') &&
    Array.isArray(c.captured_nodes) && c.captured_nodes.every(node) &&
    Array.isArray(c.replacement_nodes) && c.replacement_nodes.every(node) &&
    integer(c.required_reserve) && integer(c.reserve_used) && typeof c.was_applied === 'boolean' &&
    ['NONE','INSUFFICIENT_RESERVE','TWO_PIECES_CANNOT_CARRY','LAST_PIECE_CANNOT_CLAMP',
      'NOT_NEW_PATTERN','LINE_HAS_EXTRA_PIECES'].includes(c.failure_reason);
}
export function requireReviewContext(g: GameDto, id: string): GameDto {
  if (!g || g.game_id !== id || !integer(g.version) || !integer(g.ply_count) || !validSavedState(g.state)) invalid();
  if (g.mode === 'LOCAL') {
    if (g.ai_player !== null || g.human_player !== null || g.ai_level !== null) invalid();
  } else if (g.mode === 'AI') {
    if (!player(g.ai_player) || g.human_player !== (g.ai_player === 'A' ? 'B' : 'A') || !isAiLevel(g.ai_level)) invalid();
  } else invalid();
  return g;
}
export function requireReplay(r: GameReplayDto, id: string): GameReplayDto {
  if (!r || r.game_id !== id || !integer(r.version) || !integer(r.ply_count) ||
      !validSavedState(r.initial_state) || !Array.isArray(r.steps)) invalid();
  let ply = 0, version = 0, state = r.initial_state;
  const ids = new Set<number>();
  for (const [index, step] of r.steps.entries()) {
    if (!step || !integer(step.version) || step.version <= version || step.version > r.version ||
        !integer(step.ply) || !player(step.player) || !validSavedState(step.state) || state.game_status !== 'PLAYING') invalid();
    if (step.kind === 'MOVE') {
      if (step.ply !== ++ply || !integer(step.game_move_id) || step.game_move_id < 1 || ids.has(step.game_move_id) ||
          step.player !== state.current_player || !step.move || !node(step.move.from) || !node(step.move.to) ||
          !validCapture(step.capture)) invalid();
      ids.add(step.game_move_id);
    } else if (step.kind === 'RESIGN') {
      if (step.ply !== ply || index !== r.steps.length - 1 || step.game_move_id !== null || step.move !== null ||
          step.capture !== null || step.state.winner_reason !== 'RESIGN' || step.state.winner === step.player ||
          step.version !== r.version || JSON.stringify({...step.state,game_status:'PLAYING',winner:null,winner_reason:null}) !== JSON.stringify(state)) invalid();
    } else invalid();
    state = step.state; version = step.version;
  }
  // Undo advances the authoritative header without creating an effective move.
  if (ply !== r.ply_count || (state.game_status === 'FINISHED' && r.steps.length && version !== r.version)) invalid();
  return r;
}
