from datetime import datetime

import pytest

from modal_worker.config import ModalWorkerConfig, validate_config
from modal_worker.health import HealthResponse, get_health


class TestHealthResponse:
    def test_default_health(self) -> None:
        health = get_health()
        assert isinstance(health, HealthResponse)
        assert health.status == "ok"
        assert isinstance(health.timestamp, datetime)
        assert health.version == "0.1.0"
        assert health.modal_configured is False
        assert "not configured" in health.note

    def test_health_serialization(self) -> None:
        health = get_health()
        data = health.model_dump()
        assert data["status"] == "ok"
        assert "timestamp" in data
        assert data["modal_configured"] is False


class TestModalWorkerConfig:
    def test_default_config(self) -> None:
        config = ModalWorkerConfig()
        assert config.app_name == "siteborne-utility-worker"
        assert config.timeout_seconds == 300
        assert config.max_concurrent_jobs == 3
        assert config.modal_token_id is None
        assert config.modal_token_secret is None

    def test_config_with_values(self) -> None:
        config = ModalWorkerConfig(
            modal_token_id="test-id",
            modal_token_secret="test-secret"
        )
        assert config.modal_token_id == "test-id"
        assert config.modal_token_secret == "test-secret"

    def test_validate_config_missing_credentials(self) -> None:
        config = ModalWorkerConfig()
        is_valid, errors = validate_config(config)
        assert is_valid is False
        assert "MODAL_TOKEN_ID not set" in errors
        assert "MODAL_TOKEN_SECRET not set" in errors

    def test_validate_config_with_credentials(self) -> None:
        config = ModalWorkerConfig(
            modal_token_id="test-id",
            modal_token_secret="test-secret"
        )
        is_valid, errors = validate_config(config)
        assert is_valid is True
        assert errors == []

    def test_extra_fields_forbidden(self) -> None:
        with pytest.raises(Exception):
            ModalWorkerConfig.model_validate({"extra_field": "not allowed"})
