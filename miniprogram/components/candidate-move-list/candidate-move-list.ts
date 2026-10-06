Component({
  properties: { moves: { type: Array, value: [] } },
  methods: {
    selectMove(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('select', { id: event.currentTarget.dataset.id as string });
    },
  },
});
