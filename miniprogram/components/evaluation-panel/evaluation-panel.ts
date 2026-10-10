Component({
  properties: {
    analysis: { type: Object },
    resetKey: { type: String, value: '' },
  },
  methods: {
    selectMove(event: WechatMiniprogram.TouchEvent) {
      this.triggerEvent('select', { id: event.currentTarget.dataset.id as string });
    },
  },
});
