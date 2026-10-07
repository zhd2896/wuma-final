import { NODE_IDS } from '../../domain/index';
import type { CaptureResult, GameState, Move, NodeId, Player } from '../../domain/index';
import { describeNode } from '../../utils/board-guidance';
import { boardLines, boardNodes } from '../../mock/game';
import type { BoardPiece, BoardState as BoardView } from '../../types/domain';

export interface BoardInteraction {
  readonly selectedNode: NodeId | null;
  readonly legalTargets: readonly NodeId[];
  readonly lastMove: Move | null;
  readonly lastCapture?: CaptureResult | null;
  readonly showLegalTargets?: boolean;
}

export interface GameViewModel {
  readonly playerNames: Readonly<Record<Player, string>>;
  readonly turnTitle: string;
  readonly guidanceText: string;
  readonly captureText: string;
  readonly board: BoardView;
  readonly currentPlayer: Player;
  readonly reserve: Readonly<Record<Player, number>>;
  readonly gameOver: boolean;
  readonly winner: Player | null;
  readonly winnerMessage: string;
}

const reasonMessages: Readonly<Record<NonNullable<GameState['winner_reason']>, string>> = {
  CAPTURE_ALL: '棋子已全部被吃',
  TEMPLE_TRAP: '孤棋被困于庙宇',
  LONE_PIECE_IMMOBILIZED: '孤棋无路可走',
  RESIGN: '认输',
};

export function mapGameStateToView(
  state: GameState,
  interaction: BoardInteraction = { selectedNode: null, legalTargets: [], lastMove: null },
  viewer?: Player | null,
): GameViewModel {
  const playerNames = viewer ? { A: viewer === 'A' ? '你' : '对手', B: viewer === 'B' ? '你' : '对手' } : { A: '黑方', B: '红方' };
  const gameOver = state.game_status === 'FINISHED';
  const currentName = playerNames[state.current_player];
  const turnTitle = gameOver ? state.winner ? `${playerNames[state.winner]}获胜` : '对局结束'
    : currentName === '你' ? '你的回合' : `${currentName}回合`;
  const selectedLocation = interaction.selectedNode ? describeNode(interaction.selectedNode).replace(/^P\d+（|）$/g, '') : '';
  const guidanceText = gameOver ? '对局已结束，可查看棋局记录'
    : viewer && viewer !== state.current_player ? '等待对手落子，你暂时不能移动棋子'
    : interaction.selectedNode ? interaction.showLegalTargets === false ? '可走标记已关闭，可在设置中开启；仍可按规则选点落子' : interaction.legalTargets.length
      ? `已选${selectedLocation}的棋子 · ${interaction.legalTargets.length} 个可走位置，点击绿色标记落子`
      : '这枚棋子没有显示可走位置，请换一枚棋子；若关闭了可走提示，可在设置中开启'
    : `先点选${currentName === '你' ? '自己的' : currentName + '的'}棋子，再选择可走位置`;
  const capture = interaction.lastCapture;
  const actor = interaction.lastMove ? state.board.occupancy[interaction.lastMove.to] : null;
  const capturedSide = actor ? `${playerNames[actor === 'A' ? 'B' : 'A']}的` : '';
  const replacementSide = actor ? `${playerNames[actor]}的` : '';
  const captureTypes = [...new Set(capture?.patterns.map(pattern => pattern.capture_type === 'CLAMP' ? '夹吃' : '挑吃') ?? [])].join('、');
  const captureText = capture?.was_applied
    ? `${actor ? playerNames[actor] : '本步'}${captureTypes ? '完成' + captureTypes + '，' : ''}吃掉${capturedSide} ${capture.captured_nodes.length} 枚棋子${capture.replacement_nodes.length ? `，换入${replacementSide} ${capture.replacement_nodes.length} 枚备用棋` : ''}（备用棋消耗 ${capture.reserve_used} 枚）`
    : capture?.failure_reason === 'INSUFFICIENT_RESERVE' ? '备用棋不足，本次吃子未生效' : '';
  const loser = state.winner ? state.winner === 'A' ? 'B' : 'A' : null;
  const losingSide = loser ? playerNames[loser] + (viewer ? '的' : '') : '';
  const targets = new Set(interaction.showLegalTargets === false ? [] : interaction.legalTargets);
  const captured = new Set(interaction.lastCapture?.was_applied ? interaction.lastCapture.captured_nodes : []);
  const replacement = new Set(interaction.lastCapture?.was_applied ? interaction.lastCapture.replacement_nodes : []);
  const nodes = boardNodes.map(node => ({ ...node, legalTarget: targets.has(node.id as NodeId),
    captured: captured.has(node.id as NodeId), replacement: replacement.has(node.id as NodeId) }));
  const coordinates = new Map(boardNodes.map(node => [node.id, node]));
  const pieces: BoardPiece[] = [];
  for (const nodeId of NODE_IDS) {
    const player = state.board.occupancy[nodeId];
    if (player === null) continue;
    const point = coordinates.get(nodeId)!;
    pieces.push({
      id: `${player}-${nodeId}`, nodeId, x: point.x, y: point.y,
      side: player === 'A' ? 'black' : 'red',
      state: interaction.lastMove?.to === nodeId ? 'lastMove' : 'normal',
    });
  }
  return {
    playerNames, turnTitle, guidanceText, captureText,
    board: { nodes, lines: boardLines, pieces,
      ...(interaction.lastMove ? { recommendedFrom: interaction.lastMove.from,
        recommendedTo: interaction.lastMove.to } : {}),
      ...(interaction.selectedNode ? { selectedId: interaction.selectedNode } : {}) },
    currentPlayer: state.current_player,
    reserve: { A: state.players.A.reserve_count, B: state.players.B.reserve_count },
    gameOver: state.game_status === 'FINISHED',
    winner: state.winner,
    winnerMessage: state.winner_reason === 'RESIGN' && state.winner
      ? viewer ? (viewer === state.winner ? '对方已认输' : '你已认输')
        : `${playerNames[state.winner === 'A' ? 'B' : 'A']}认输`
      : state.winner_reason ? losingSide + reasonMessages[state.winner_reason] : '',
  };
}
