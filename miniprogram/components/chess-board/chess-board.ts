import type { BoardState } from '../../types/domain';
import { boardHitGeometry } from '../../utils/board-hit-geometry';
import type { BoardHitNode } from '../../utils/board-hit-geometry';
import { NODE_IDS } from '../../domain/index';
import type { NodeId } from '../../domain/index';
import { describeNode } from '../../utils/board-guidance';
import { createWxGameSettingsStore } from '../../services/game-settings';

Component({
  data: { hitNodes: [] as (BoardHitNode & { ariaLabel: string })[], storedHighContrast: false, storedLargeText: false },
  properties: {
    board: { type: Object, value: { nodes: [], lines: [], pieces: [] } as BoardState },
    compact: { type: Boolean, value: false },
    showGuidance: { type: Boolean, value: false },
    showNodeLabels: { type: Boolean, value: false },
    highContrast: { type: Boolean, value: false },
    largeText: { type: Boolean, value: false },
  },
  observers: {
    board(board: BoardState) { this.renderBoard(board); },
    'highContrast, largeText'() { this.readDisplaySettings(); },
  },
  lifetimes: {
    attached() { this.readDisplaySettings(); this.renderBoard(this.properties.board as BoardState); },
  },
  pageLifetimes: { show() { this.readDisplaySettings(); } },
  methods: {
    readDisplaySettings() {
      try {
        const settings = createWxGameSettingsStore().read();
        this.setData({ storedHighContrast: settings.highContrastBoard, storedLargeText: settings.largeBoardText });
      } catch { /* Display settings never prevent the board from rendering. */ }
    },
    renderBoard(board: BoardState) {
      const hitNodes = boardHitGeometry(board?.nodes ?? []).map(node => {
        const piece = board.pieces.find(item => item.nodeId === node.id);
        const description = NODE_IDS.includes(node.id as NodeId) ? describeNode(node.id as NodeId) : node.id;
        const ariaLabel = [description, piece ? piece.side === 'black' ? '黑方棋子' : '红方棋子' : '空位',
          node.legalTarget ? '可走' : '', board.selectedId === node.id ? '已选中' : '',
          board.recommendedFrom === node.id ? '路线起点' : '', board.recommendedTo === node.id ? '路线终点' : '',
          node.captured ? '吃子位置' : '', node.replacement ? '备用棋换入' : ''].filter(Boolean).join('，');
        return { ...node, ariaLabel };
      });
      this.setData({ hitNodes });
    },
    onNode(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string;
      const board = this.properties.board as BoardState;
      if (NODE_IDS.includes(id as NodeId) && board.nodes.some(node => node.id === id && !node.visualOnly))
        this.triggerEvent('node', { id });
    },
  }
});
