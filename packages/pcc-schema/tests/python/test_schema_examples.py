"""
Fixture validation for the 17 SUN-0101 canonical schemas (9 common + 8 service
input/output). Every schema's bundled `examples` must validate against itself
(with full cross-schema $ref resolution via $id), and a handful of
deliberately-broken mutations must be rejected — proving the validator has
teeth, not just that the happy path was hand-picked to pass.
"""

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, RefResolver

ROOT = Path(__file__).resolve().parents[4]
SCHEMAS_DIR = ROOT / "schemas"


def load_json(path: Path):
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def schema_store():
    store = {}
    for f in SCHEMAS_DIR.rglob("*.schema.json"):
        d = load_json(f)
        if "$id" in d:
            store[d["$id"]] = d
    return store


CANONICAL_SCHEMA_FILES = sorted(
    p for p in (SCHEMAS_DIR / "common").glob("*.schema.json")
) + sorted(p for p in (SCHEMAS_DIR / "services").glob("*.schema.json"))


def test_exactly_17_canonical_schemas():
    common = list((SCHEMAS_DIR / "common").glob("*.schema.json"))
    services = list((SCHEMAS_DIR / "services").glob("*.schema.json"))
    assert len(common) == 9, f"expected 9 common schemas, found {len(common)}"
    assert len(services) == 8, f"expected 8 service schemas, found {len(services)}"
    assert len(common) + len(services) == 17


@pytest.mark.parametrize("schema_path", CANONICAL_SCHEMA_FILES, ids=lambda p: p.name)
def test_schema_has_examples(schema_path):
    d = load_json(schema_path)
    assert d.get("examples"), f"{schema_path.name} has no examples"


@pytest.mark.parametrize("schema_path", CANONICAL_SCHEMA_FILES, ids=lambda p: p.name)
def test_schema_examples_validate(schema_path, schema_store):
    d = load_json(schema_path)
    resolver = RefResolver.from_schema(d, store=schema_store)
    validator = Draft202012Validator(d, resolver=resolver)
    for i, example in enumerate(d.get("examples", [])):
        errors = list(validator.iter_errors(example))
        assert errors == [], (
            f"{schema_path.name} example[{i}] failed validation:\n"
            + "\n".join(f"  - {e.message} @ {list(e.path)}" for e in errors)
        )


# --- Negative fixtures: prove the validator actually rejects bad data -----

MONEY_SCHEMA = SCHEMAS_DIR / "common" / "money.schema.json"
REQUEST_ENVELOPE_SCHEMA = SCHEMAS_DIR / "common" / "request-envelope.schema.json"
COMPANY_EVIDENCE_OUTPUT_SCHEMA = SCHEMAS_DIR / "services" / "company-evidence-output.schema.json"


def test_money_rejects_scientific_notation(schema_store):
    d = load_json(MONEY_SCHEMA)
    resolver = RefResolver.from_schema(d, store=schema_store)
    validator = Draft202012Validator(d, resolver=resolver)
    bad = copy.deepcopy(d["examples"][0])
    bad["amount"] = "3.9e-2"
    assert list(validator.iter_errors(bad)) != []


def test_request_envelope_rejects_bad_service_id(schema_store):
    d = load_json(REQUEST_ENVELOPE_SCHEMA)
    resolver = RefResolver.from_schema(d, store=schema_store)
    validator = Draft202012Validator(d, resolver=resolver)
    bad = copy.deepcopy(d["examples"][0])
    bad["service_id"] = "not_a_real_service.v1"
    assert list(validator.iter_errors(bad)) != []


def test_request_envelope_rejects_missing_request_id(schema_store):
    d = load_json(REQUEST_ENVELOPE_SCHEMA)
    resolver = RefResolver.from_schema(d, store=schema_store)
    validator = Draft202012Validator(d, resolver=resolver)
    bad = copy.deepcopy(d["examples"][0])
    del bad["request_id"]
    assert list(validator.iter_errors(bad)) != []


def test_company_evidence_output_rejects_wrong_service_id(schema_store):
    d = load_json(COMPANY_EVIDENCE_OUTPUT_SCHEMA)
    resolver = RefResolver.from_schema(d, store=schema_store)
    validator = Draft202012Validator(d, resolver=resolver)
    bad = copy.deepcopy(d["examples"][0])
    bad["contract"]["service_id"] = "web_context_verified.v1"
    assert list(validator.iter_errors(bad)) != []
