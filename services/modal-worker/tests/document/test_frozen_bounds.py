"""Cross-checks the worker's hardcoded bounds against the actual frozen
schema files, so a future schema change is caught here rather than silently
diverging from the worker's own limits."""

from __future__ import annotations

import json
from pathlib import Path

from modal_worker.document.models import ALLOWED_MEDIA_TYPES, MAX_DOCUMENT_BYTES, MAX_PAGES

REPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
ARTIFACT_SCHEMA = REPO_ROOT / "schemas" / "common" / "authorized-artifact-reference.schema.json"
INPUT_SCHEMA = REPO_ROOT / "schemas" / "services" / "document-evidence-input.schema.json"


def test_frozen_artifact_schema_exists() -> None:
    assert ARTIFACT_SCHEMA.exists(), f"expected frozen schema at {ARTIFACT_SCHEMA}"


def test_max_bytes_matches_frozen_schema() -> None:
    schema = json.loads(ARTIFACT_SCHEMA.read_text())
    assert schema["properties"]["size_bytes"]["maximum"] == MAX_DOCUMENT_BYTES


def test_max_pages_matches_frozen_schema() -> None:
    schema = json.loads(ARTIFACT_SCHEMA.read_text())
    assert schema["properties"]["page_count"]["maximum"] == MAX_PAGES


def test_allowed_media_types_match_frozen_schema() -> None:
    schema = json.loads(ARTIFACT_SCHEMA.read_text())
    assert set(schema["properties"]["media_type"]["enum"]) == set(ALLOWED_MEDIA_TYPES)


def test_input_schema_declared_page_count_bound_matches() -> None:
    schema = json.loads(INPUT_SCHEMA.read_text())
    assert schema["properties"]["declared_page_count"]["maximum"] == MAX_PAGES
