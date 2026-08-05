from pydantic import BaseModel, Field


class ModalWorkerConfig(BaseModel):
    modal_token_id: str | None = Field(default=None, description="Modal token ID (not configured in SUN-0001)")
    modal_token_secret: str | None = Field(default=None, description="Modal token secret (not configured in SUN-0001)")
    app_name: str = "siteborne-utility-worker"
    timeout_seconds: int = 300
    max_concurrent_jobs: int = 3

    class Config:
        extra = "forbid"


def load_config() -> ModalWorkerConfig:
    """Load configuration from environment.

    In SUN-0001, Modal deployment is not configured.
    This function returns a default config with modal_configured=False.
    """
    import os
    return ModalWorkerConfig(
        modal_token_id=os.getenv("MODAL_TOKEN_ID"),
        modal_token_secret=os.getenv("MODAL_TOKEN_SECRET")
    )


def validate_config(config: ModalWorkerConfig) -> tuple[bool, list[str]]:
    """Validate configuration for production readiness.

    Returns (is_valid, errors).
    """
    errors = []
    if not config.modal_token_id:
        errors.append("MODAL_TOKEN_ID not set")
    if not config.modal_token_secret:
        errors.append("MODAL_TOKEN_SECRET not set")
    return len(errors) == 0, errors
