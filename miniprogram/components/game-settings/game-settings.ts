import { DEFAULT_GAME_SETTINGS, type GameSettings } from '../../services/game-settings';

Component({
  properties: {
    settings: { type: Object, value: { ...DEFAULT_GAME_SETTINGS } },
    showAiFirstPlayer: { type: Boolean, value: true },
  },
  methods: {
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
    onAiFirstPlayerChange(event: WechatMiniprogram.RadioGroupChange) {
      this.emitChange({ aiFirstPlayer: event.detail.value === 'B' ? 'B' : 'A' });
    },
  },
});
