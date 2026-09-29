Component({
  properties: {
    level: { type: Number, value: 1 },
    title: { type: String, value: '' },
    body: { type: String, value: '' },
    detail: { type: String, value: '' },
    expanded: { type: Boolean, value: false },
    locked: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },
  methods: {
    open() {
      if (this.data.locked || this.data.loading) return;
      this.triggerEvent('select', { level: this.data.level });
    },
  },
});
