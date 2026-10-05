"""Local WeChat configuration with explicit environment precedence."""
import pytest
from backend.app.core import config


def test_local_wechat_settings_load_without_exporting_environment(tmp_path, monkeypatch):
    path = tmp_path / "wechat.local.toml"
    path.write_text('WECHAT_APP_ID = "wx-local"\nWECHAT_APP_SECRET = "local-secret"\nAUTH_SESSION_DAYS = 3\n')
    monkeypatch.setattr(config, "WECHAT_CONFIG_PATH", path, raising=False)
    for key in ("WECHAT_APP_ID", "WECHAT_APP_SECRET", "AUTH_SESSION_DAYS"):
        monkeypatch.delenv(key, raising=False)
    settings = config.Settings()
    assert settings.wechat_app_id == "wx-local"
    assert settings.wechat_app_secret == "local-secret"
    assert settings.auth_session_days == 3
    assert "local-secret" not in repr(settings)
    monkeypatch.setenv("WECHAT_APP_SECRET", "environment-secret")
    assert config.Settings().wechat_app_secret == "environment-secret"


def test_missing_and_invalid_local_wechat_settings(tmp_path, monkeypatch):
    path = tmp_path / "missing.toml"
    monkeypatch.setattr(config, "WECHAT_CONFIG_PATH", path, raising=False)
    monkeypatch.delenv("WECHAT_APP_ID", raising=False)
    assert config.Settings().wechat_app_id == ""
    path.write_text('WECHAT_APP_SECRET = "unterminated-sensitive-value')
    with pytest.raises(ValueError) as exc:
        config.Settings()
    assert "unterminated-sensitive-value" not in str(exc.value)
