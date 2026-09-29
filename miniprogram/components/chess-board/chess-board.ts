import { BoardState } from '../../types/domain';
Component({
  properties: { board: { type: Object, value: { nodes: [], lines: [], pieces: [] } as BoardState }, compact: { type: Boolean, value: false } },
  methods: {
    onNode(event: WechatMiniprogram.TouchEvent) { this.triggerEvent('node', { id: event.currentTarget.dataset.id as string }); }
  }
});
