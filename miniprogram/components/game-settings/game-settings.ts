import { DEFAULT_GAME_SETTINGS, type GameSettings } from '../../services/game-settings';

Component({
  data: { aiLevelLabels: ['入门', '标准', '进阶'] },
  properties: {
    settings: { type: Object, value: { ...DEFAULT_GAME_SETTINGS } },
    showAiFirstPlayer: { type: Boolean, value: true },
  },
  methods: {
    onHighContrastChange(event: WechatMiniprogram.SwitchChange) {
      this.emitChange({ highContrastBoard: event.detail.value });
    },
    onLargeTextChange(event: WechatMiniprogram.SwitchChange) {
      this.emitChange({ largeBoardText: event.detail.value });
    },
    emitChange(patch: Partial<GameSettings>) {
      const settings = this.properties.settings as GameSettings;
      this.triggerEvent('change', { ...settings, ...patch });
    },
    onLegalTargetsChange(event: WechatMiniprogram.SwitchChange) {
      this.emitChange({ showLegalTargets: event.detail.value });
    },
    onNodeLabelsChange(event: WechatMiniprogram.SwitchChange) {
      this.emitChange({ showNodeLabels: event.detail.value });
    },
    onCaptureNoticeChange(event: WechatMiniprogram.SwitchChange) {
      this.emitChange({ showCaptureNotice: event.detail.value });
    },
    onVibrationChange(event: WechatMiniprogram.SwitchChange) {
      this.emitChange({ vibrateOnAction: event.detail.value });
    },
    onAiLevelChange(event: { detail: { value: unknown } }) {
      const raw = event.detail.value;
      if ((typeof raw !== 'string' && typeof raw !== 'number') || !/^[012]$/.test(String(raw))) return;
      const level = (['BEGINNER', 'STANDARD', 'ADVANCED'] as const)[Number(raw)];
      this.emitChange({ defaultAiLevel: level });
    },
    onAiFirstPlayerChange(event: WechatMiniprogram.RadioGroupChange) {
      this.emitChange({ aiFirstPlayer: event.detail.value === 'B' ? 'B' : 'A' });
    },
  },
});
