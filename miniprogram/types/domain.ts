export type PieceSide = 'red' | 'black';
export type PieceVisualState = 'normal' | 'selected' | 'legalTarget' | 'lastMove' | 'recommended' | 'captured';
export interface BoardNode { id: string; x: number; y: number; temple?: boolean; visualOnly?: boolean; legalTarget?: boolean; captured?: boolean; replacement?: boolean }
export interface BoardLine { id: string; x: number; y: number; width: number; angle: number }
export interface BoardPiece { id: string; nodeId: string; x: number; y: number; side: PieceSide; state?: PieceVisualState }
export interface BoardState { nodes: BoardNode[]; lines: BoardLine[]; pieces: BoardPiece[]; selectedId?: string; recommendedFrom?: string; recommendedTo?: string; recommendLine?: BoardLine }
export interface Feature { id: string; title: string; subtitle: string; icon: string; theme: string; route: string }
export interface CandidateMove { id: string; notation: string; assessment: string; detail: string }
export interface AnalysisData { score: string; advantage: string; trend: string; recommendation: CandidateMove; candidates: CandidateMove[]; threats: string[]; keyPieces: string[] }
export interface ReviewMoment { turn: number; notation: string; label: string; tone: string; score: string; detail: string }
export interface ReviewData { title: string; result: string; turns: number; summary: string; moments: ReviewMoment[]; curve: number[] }
export interface TrainingLevel { id: string; title: string; subtitle: string; difficulty: number; category: string; completed: boolean }
/** Legacy demo shape; production history uses DeviceHistoryEntry instead. */
export interface HistoryRecord { id: string; date: string; opponent: string; mode: string; result: string; turns: number; reviewed: boolean }
export interface CoachMessage { level: number; title: string; body: string }
