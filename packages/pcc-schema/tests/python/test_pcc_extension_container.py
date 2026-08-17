"""
Test matrix for the PCC 1.0.1 extension_container patch (SUN-0100 correction).

PCC 1.0.0's extension_container set additionalProperties:false with no
properties/patternProperties, which unconditionally rejected every extension
key regardless of what a service-specific schema's allOf branch declared —
independently confirmed here (Python `jsonschema`) and in TypeScript
(pcc-extension-container.test.ts, using the package's own hand-rolled
validateSchema). 1.0.1 adds patternProperties mapping the same reverse-domain
pattern to a new bounded extension_value definition.

This file also covers the four service output schemas end-to-end: each must
now accept a document carrying its own required extension, reject one missing
it, and reject substituting another service's extension for the required one.
"""

import copy
import json
import hashlib
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, Draft7Validator, RefResolver

ROOT = Path(__file__).resolve().parents[4]
SCHEMAS_DIR = ROOT / "schemas"
PCC_SCHEMA_PATH = SCHEMAS_DIR / "proof-carrying-context.schema.json"


def load_json(path: Path):
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def pcc_schema():
    return load_json(PCC_SCHEMA_PATH)


@pytest.fixture(scope="module")
def schema_store():
    store = {}
    for f in SCHEMAS_DIR.rglob("*.schema.json"):
        d = load_json(f)
        if "$id" in d:
            store[d["$id"]] = d
    return store


def valid_document(overrides=None):
    now = "2026-08-05T10:00:00Z"
    doc = {
        "pcc_version": "1.0.0",
        "job_id": "job_aaaaaaaaaaaaaaaaaaaaaaaa",
        "contract": {
            "service_id": "company_evidence_graph.v1",
            "service_version": "v1",
            "input_hash": "sha256:" + "a" * 64,
            "input_schema_hash": "sha256:" + "b" * 64,
            "output_schema_hash": "sha256:" + "c" * 64,
            "quote_id": "qte_aaaaaaaaaaaaaaaaaaaaaaaa",
            "mode": "paid",
            "currency": "USD",
            "minimum_quality": 0.8,
            "freshness_seconds": 3600,
            "issued_at": now,
            "expires_at": "2026-08-06T10:00:00Z",
            "idempotency_key": "idk_aaaaaaaaaaaaaaaaaaaaaaaa",
        },
        "subject": {
            "type": "organization",
            "canonical_name": "Acme Example Corp",
            "identifiers": {"domain": "acme.example"},
        },
        "claims": [],
        "evidence": [],
        "completeness": {
            "requested_fields": 5,
            "populated_fields": 4,
            "supported_fields": 4,
            "score": 0.8,
            "missing_fields": ["ceo_name"],
            "unsupported_fields": [],
            "stale_fields": [],
            "vector": [
                {"dimension": "general", "requested": 5, "populated": 4, "supported": 4, "score": 0.8}
            ],
        },
        "provenance": {
            "routes": [{"type": "direct", "provider": "web", "version": "1.0.0"}],
            "providers": [{"name": "web", "version": "1.0.0", "capabilities": ["fetch"]}],
            "tools": {"curl": "8.0.0"},
            "models": [],
            "software_versions": {"pcc": "1.0.0"},
            "policy_versions": {"verification": "1.0.0"},
            "transformations": [],
            "cache_provenance": {"enabled": False, "hit": False},
            "execution_environment": {"runtime": "node", "version": "22.0.0", "platform": "linux"},
            "verification_routes": [],
        },
        "verification": {
            "schema_valid": True,
            "material_claims_supported": True,
            "evidence_accessibility": 1.0,
            "freshness": 1.0,
            "completeness": 0.8,
            "cross_source_agreement": 1.0,
            "provenance_valid": True,
            "prompt_injection_result": {"checked": True, "result": "clean"},
            "deterministic_failures": [],
            "verifier_versions": {"pcc": "1.0.0"},
            "policy": "pol_aaaaaaaaaaaaaaaaaaaaaaaa",
            "decision": "pass",
            "score": 0.9,
            "failed_requirements": [],
        },
        "receipt": {
            "output_hash": "sha256:" + "e" * 64,
            "canonicalization_algorithm": "RFC8785-JCS",
            "policy_hash": "sha256:" + "f" * 64,
            "schema_hash": "sha256:" + "0" * 64,
            "signature_algorithm": "Ed25519",
            "signing_key_id": "kid_aaaaaaaaaaaaaaaaaaaaaaaa",
            "signature": "A" * 86,
            "signed_at": now,
        },
    }
    if overrides:
        doc.update(overrides)
    return doc


SITEBORNE_SERVICE_NAMESPACES = [
    "net.siteborne.company-evidence.v1",
    "net.siteborne.web-context.v1",
    "net.siteborne.document-evidence.v1",
    "net.siteborne.agent-verification.v1",
]


# --- extension_container structural matrix (isolated definition) ----------


def _extension_container_validator(pcc_schema):
    resolver = RefResolver.from_schema(pcc_schema)
    return Draft7Validator(pcc_schema["definitions"]["extension_container"], resolver=resolver)


def test_empty_extensions_object_passes(pcc_schema):
    v = _extension_container_validator(pcc_schema)
    assert list(v.iter_errors({})) == []


def test_valid_qualified_extension_key_passes(pcc_schema):
    v = _extension_container_validator(pcc_schema)
    errs = list(v.iter_errors({"net.siteborne.verification.v1": {"checked": True}}))
    assert errs == []


@pytest.mark.parametrize("namespace", SITEBORNE_SERVICE_NAMESPACES)
def test_all_four_service_namespaces_pass(pcc_schema, namespace):
    v = _extension_container_validator(pcc_schema)
    errs = list(v.iter_errors({namespace: {"ok": True}}))
    assert errs == []


def test_unqualified_key_fails(pcc_schema):
    v = _extension_container_validator(pcc_schema)
    assert list(v.iter_errors({"foo": {}})) != []


@pytest.mark.parametrize(
    "key",
    [
        "Net.siteborne.x.v1",  # uppercase
        "net_siteborne.x.v1",  # underscore
        "net.-siteborne.x.v1",  # leading hyphen in label
        "net.siteborne-.x.v1",  # trailing hyphen in label
        "net..v1",  # empty label
    ],
)
def test_invalid_namespace_shapes_fail(pcc_schema, key):
    v = _extension_container_validator(pcc_schema)
    assert list(v.iter_errors({key: {}})) != []


def test_254_char_key_fails(pcc_schema):
    v = _extension_container_validator(pcc_schema)
    # 5 labels of 61 chars + 4 dots + ".v1" suffix = 61*5 + 4 + 3 = 312 chars.
    key = ".".join(c * 61 for c in "abcde") + ".v1"
    assert len(key) > 253
    assert list(v.iter_errors({key: {}})) != []


def test_11_extensions_fail(pcc_schema):
    v = _extension_container_validator(pcc_schema)
    extensions = {f"net.siteborne.ext{i}.v1": {} for i in range(11)}
    assert list(v.iter_errors(extensions)) != []


def test_extension_value_must_be_object(pcc_schema):
    v = _extension_container_validator(pcc_schema)
    errs = list(v.iter_errors({"net.siteborne.verification.v1": "not-an-object"}))
    assert errs != []


def test_unknown_pcc_root_properties_still_fail(pcc_schema, schema_store):
    resolver = RefResolver.from_schema(pcc_schema, store=schema_store)
    validator = Draft202012Validator(pcc_schema, resolver=resolver)
    doc = valid_document({"extensions": {}, "not_a_real_field": True})
    errs = [e for e in validator.iter_errors(doc) if "not_a_real_field" in e.message]
    assert errs != []


def test_pcc_schema_hash_recorded():
    """Cross-language agreement anchor: TS test asserts the same hash.

    SUN-1000 checkpoint 1M: updated from the 1.0.1 hash as part of this
    checkpoint's own governed PCC schema minor release (1.0.1 -> 1.1.0,
    service_id enum gains 4 .v2 members, classified minor-compatible per
    packages/pcc-schema/policy/COMPATIBILITY.md) -- the same deliberate,
    disclosed drift-pin update already established at checkpoint 1K-A for
    its sibling TS/JS assertions.
    """
    content = PCC_SCHEMA_PATH.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    assert digest == "d32a8e25eba7a7ae4d7d7f7a14c565c1b92c8d8e10810ff885698ed102fdbcc0"


# --- Full service-output integration: required extension enforcement ------

SERVICE_OUTPUT_FILES = {
    "net.siteborne.company-evidence.v1": "company-evidence-output.schema.json",
    "net.siteborne.web-context.v1": "web-context-output.schema.json",
    "net.siteborne.document-evidence.v1": "document-evidence-output.schema.json",
    "net.siteborne.agent-verification.v1": "agent-verification-output.schema.json",
}

SERVICE_ID_BY_NAMESPACE = {
    "net.siteborne.company-evidence.v1": "company_evidence_graph.v1",
    "net.siteborne.web-context.v1": "web_context_verified.v1",
    "net.siteborne.document-evidence.v1": "document_evidence_json.v1",
    "net.siteborne.agent-verification.v1": "verify_agent_output.v1",
}


def _output_validator(namespace, schema_store):
    schema = load_json(SCHEMAS_DIR / "services" / SERVICE_OUTPUT_FILES[namespace])
    resolver = RefResolver.from_schema(schema, store=schema_store)
    return schema, Draft202012Validator(schema, resolver=resolver)


@pytest.mark.parametrize("namespace", SITEBORNE_SERVICE_NAMESPACES)
def test_service_output_with_required_extension_passes(namespace, schema_store):
    schema, validator = _output_validator(namespace, schema_store)
    service_id = SERVICE_ID_BY_NAMESPACE[namespace]
    doc = valid_document(
        {
            "contract": {
                **valid_document()["contract"],
                "service_id": service_id,
                "output_schema_hash": "sha256:" + "c" * 64,
            },
            "extensions": {namespace: {}},
        }
    )
    errs = [e for e in validator.iter_errors(doc) if e.path and e.path[0] == "extensions"]
    assert errs == [], f"unexpected extensions error for {namespace}: {errs}"


@pytest.mark.parametrize("namespace", SITEBORNE_SERVICE_NAMESPACES)
def test_service_output_missing_required_extension_fails(namespace, schema_store):
    schema, validator = _output_validator(namespace, schema_store)
    service_id = SERVICE_ID_BY_NAMESPACE[namespace]
    doc = valid_document(
        {
            "contract": {
                **valid_document()["contract"],
                "service_id": service_id,
                "output_schema_hash": "sha256:" + "c" * 64,
            },
            "extensions": {},
        }
    )
    errs = list(validator.iter_errors(doc))
    assert any("extensions" in list(e.path) or e.validator == "required" for e in errs)


@pytest.mark.parametrize("namespace", SITEBORNE_SERVICE_NAMESPACES)
def test_another_services_extension_cannot_substitute(namespace, schema_store):
    schema, validator = _output_validator(namespace, schema_store)
    service_id = SERVICE_ID_BY_NAMESPACE[namespace]
    other_namespace = next(n for n in SITEBORNE_SERVICE_NAMESPACES if n != namespace)
    doc = valid_document(
        {
            "contract": {
                **valid_document()["contract"],
                "service_id": service_id,
                "output_schema_hash": "sha256:" + "c" * 64,
            },
            "extensions": {other_namespace: {}},
        }
    )
    errs = list(validator.iter_errors(doc))
    # The required service extension is absent, so this must fail.
    assert errs != []
