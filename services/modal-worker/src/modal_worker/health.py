from datetime import datetime

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(default="ok")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: str = "0.1.0"
    modal_configured: bool = False
    note: str = "Modal deployment not configured in SUN-0001"


def get_health() -> HealthResponse:
    return HealthResponse()
