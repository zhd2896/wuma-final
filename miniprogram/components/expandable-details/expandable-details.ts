Component({
  properties: { title: { type: String, value: '技术详情' }, resetKey: { type: String, value: '' } },
  data: { expanded: false, resetScope: '' },
  observers: { resetKey(value: string) {
    if (value !== this.data.resetScope) this.setData({ expanded: false, resetScope: value });
  } },
  methods: { toggle() { this.setData({ expanded: !this.data.expanded }); } },
});
