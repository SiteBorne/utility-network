"""
Tests for packages/contracts/src/semantic/validators.py — mirrors
validators.test.ts (TypeScript) for cross-language agreement.
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validators as v  # noqa: E402


def H(c: str) -> str:
    return f"sha256:{c * 64}"


class TestServiceIdPattern:
    @pytest.mark.parametrize(
        "service_id",
        [
            "company_evidence_graph.v1",
            "web_context_verified.v1",
            "document_evidence_json.v1",
            "verify_agent_output.v1",
        ],
    )
    def test_accepts_canonical_ids(self, service_id):
        assert v.is_valid_service_id(service_id)

    def test_rejects_three_segment_id(self):
        assert not v.is_valid_service_id("company.evidence.v1")

    def test_rejects_id_missing_version(self):
        assert not v.is_valid_service_id("company_evidence_graph")


class TestHashAndPairingHelpers:
    def test_valid_triple(self):
        assert v.validate_hash_pairing(H("a"), H("b"), H("c")) == []

    def test_malformed_hash(self):
        assert v.validate_hash_pairing("not-a-hash", H("b"), H("c")) != []

    def test_service_pairing_valid(self):
        assert v.validate_service_pairing("company_evidence_graph.v1", "v1") == []

    def test_timestamp_ordering_valid(self):
        assert v.validate_timestamp_ordering("2026-08-05T10:00:00Z", "2026-08-06T10:00:00Z") == []

    def test_timestamp_ordering_reversed(self):
        errs = v.validate_timestamp_ordering("2026-08-06T10:00:00Z", "2026-08-05T10:00:00Z")
        assert "expires_at must be after issued_at" in errs


class TestQuoteExactUpto:
    def test_exact_requires_price(self):
        assert v.validate_quote_exact_upto("exact", price={"amount": "1"}) == []
        assert "exact scheme requires price" in v.validate_quote_exact_upto("exact")

    def test_exact_forbids_max_price(self):
        errs = v.validate_quote_exact_upto("exact", price={"amount": "1"}, max_price={"amount": "2"})
        assert "exact scheme must not have maximum_authorized_price" in errs

    def test_upto_requires_max_price(self):
        assert v.validate_quote_exact_upto("upto", max_price={"amount": "2"}) == []
        assert "upto scheme requires maximum_authorized_price" in v.validate_quote_exact_upto("upto")

    def test_upto_forbids_price(self):
        errs = v.validate_quote_exact_upto("upto", price={"amount": "1"}, max_price={"amount": "2"})
        assert "upto scheme must not have price" in errs


class TestExactlyOneMode:
    def test_exactly_one_passes(self):
        assert v.validate_exactly_one_mode({"a": 1}, ["a", "b", "c"]) == []

    def test_zero_fails(self):
        assert v.validate_exactly_one_mode({}, ["a", "b", "c"]) != []

    def test_more_than_one_fails(self):
        assert v.validate_exactly_one_mode({"a": 1, "b": 2}, ["a", "b", "c"]) != []


class TestCompletenessAndDecision:
    def test_consistent_completeness(self):
        assert v.validate_completeness(
            {"requested_fields": 5, "populated_fields": 4, "supported_fields": 4, "score": 0.8}
        ) == []

    def test_supported_exceeds_populated(self):
        errs = v.validate_completeness(
            {"requested_fields": 5, "populated_fields": 2, "supported_fields": 4, "score": 0.4}
        )
        assert "supported_fields cannot exceed populated_fields" in errs

    def test_pass_with_deterministic_failures_rejected(self):
        errs = v.validate_deterministic_failures({"decision": "pass", "deterministic_failures": ["x"]})
        assert "deterministic failures prevent pass decision" in errs

    def test_fail_with_deterministic_failures_allowed(self):
        assert v.validate_deterministic_failures({"decision": "fail", "deterministic_failures": ["x"]}) == []


class TestPydanticModels:
    def test_money_model_valid(self):
        v.MoneyModel(amount="0.039", currency="USD")

    def test_money_model_rejects_scientific_notation(self):
        with pytest.raises(ValidationError):
            v.MoneyModel(amount="3.9e-2", currency="USD")

    def test_request_envelope_model_valid(self):
        v.RequestEnvelopeModel(
            request_id="3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a",
            service_id="company_evidence_graph.v1",
            service_version="v1",
            response_schema_version="v1",
            idempotency_key="idem_abc123xyz4567890",
            freshness_seconds=86400,
            minimum_verification_score=0.7,
            maximum_authorized_price={"amount": "0.039", "currency": "USD"},
            input={"company_name": "Acme Corp"},
        )

    def test_request_envelope_model_rejects_bad_service_id(self):
        with pytest.raises(ValidationError):
            v.RequestEnvelopeModel(
                request_id="3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a",
                service_id="nope",
                service_version="v1",
                response_schema_version="v1",
                idempotency_key="idem_abc123xyz4567890",
                freshness_seconds=86400,
                minimum_verification_score=0.7,
                maximum_authorized_price={"amount": "0.039", "currency": "USD"},
                input={},
            )

    def test_quote_response_model_valid(self):
        v.QuoteResponseModel(
            quote_id="3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7b",
            request_id="3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a",
            service_id="company_evidence_graph.v1",
            service_version="v1",
            pricing_scheme="exact",
            price={"amount": "0.039", "currency": "USD"},
            currency="USD",
            payment_network="base",
            payment_asset="USDC",
            estimated_execution_class="standard",
            execution_mode="sync",
            issued_at="2026-08-05T10:00:00Z",
            expires_at="2026-08-06T10:00:00Z",
            input_hash=H("a"),
            input_schema_hash=H("b"),
            output_schema_hash=H("c"),
            pricing_policy_version="v1",
            expected_completeness=0.8,
            declared_limitations=[],
            production_enabled=False,
            payment_required=True,
        )

    def test_quote_response_model_rejects_exact_with_max_price(self):
        with pytest.raises(ValidationError):
            v.QuoteResponseModel(
                quote_id="3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7b",
                request_id="3fa85f64-4b2c-4d8e-9f1a-2b3c4d5e6f7a",
                service_id="company_evidence_graph.v1",
                service_version="v1",
                pricing_scheme="exact",
                price={"amount": "0.039", "currency": "USD"},
                maximum_authorized_price={"amount": "0.10", "currency": "USD"},
                currency="USD",
                payment_network="base",
                payment_asset="USDC",
                estimated_execution_class="standard",
                execution_mode="sync",
                issued_at="2026-08-05T10:00:00Z",
                expires_at="2026-08-06T10:00:00Z",
                input_hash=H("a"),
                input_schema_hash=H("b"),
                output_schema_hash=H("c"),
                pricing_policy_version="v1",
                expected_completeness=0.8,
                declared_limitations=[],
                production_enabled=False,
                payment_required=True,
            )

    def test_service_metadata_model_valid(self):
        v.ServiceMetadataModel(
            service_id="company_evidence_graph.v1",
            service_version="v1",
            title="Company Evidence Graph",
            description="desc",
            capabilities=["identity_resolution"],
            input_schema_hash=H("a"),
            output_schema_hash=H("b"),
            pcc_version="1.0.0",
            pricing_schemes=["exact"],
            base_price={"amount": "0.039", "currency": "USD"},
            execution_mode="sync",
            maximum_input_bytes=102400,
            expected_latency_class="standard",
            authorization_classification="public",
            promotion_state="executable_candidate",
            production_enabled=False,
            declared_limitations=[],
            protocols={
                "x402": "planned",
                "mcp": "planned",
                "a2a": "planned",
                "nevermined": "planned",
                "agentverse": "planned",
                "coinbase_bazaar": "planned",
                "mcp_registry": "planned",
            },
            updated_at="2026-08-05T10:00:00Z",
        )


def _base_doc(service_id: str, ns: str) -> dict:
    return {
        "contract": {
            "service_id": service_id,
            "service_version": "v1",
            "input_hash": H("a"),
            "input_schema_hash": H("b"),
            "output_schema_hash": H("c"),
            "issued_at": "2026-08-05T10:00:00Z",
            "expires_at": "2026-08-06T10:00:00Z",
        },
        "extensions": {ns: {"ok": True}},
        "completeness": {"requested_fields": 5, "populated_fields": 4, "supported_fields": 4, "score": 0.8},
        "verification": {"decision": "pass", "deterministic_failures": []},
    }


class TestValidateServiceOutputDocument:
    @pytest.mark.parametrize("service_id,ns", list(v.SERVICE_EXTENSION_NAMESPACE.items()))
    def test_passes_with_own_extension(self, service_id, ns):
        errors = v.validate_service_output_document(_base_doc(service_id, ns), service_id)
        assert errors == []

    def test_missing_required_extension_fails(self):
        doc = _base_doc("company_evidence_graph.v1", "net.siteborne.company-evidence.v1")
        doc["extensions"] = {}
        errors = v.validate_service_output_document(doc, "company_evidence_graph.v1")
        assert any("required extension namespace" in e for e in errors)

    def test_wrong_service_extension_substituted_fails(self):
        doc = _base_doc("company_evidence_graph.v1", "net.siteborne.web-context.v1")
        errors = v.validate_service_output_document(doc, "company_evidence_graph.v1")
        assert any("wrong service extension" in e for e in errors)
        assert any("required extension namespace" in e for e in errors)

    def test_service_id_mismatch_fails(self):
        doc = _base_doc("web_context_verified.v1", "net.siteborne.company-evidence.v1")
        errors = v.validate_service_output_document(doc, "company_evidence_graph.v1")
        assert any("contract.service_id must be 'company_evidence_graph.v1'" in e for e in errors)


class TestInputSideGuards:
    def test_document_evidence_input_mode_exactly_one(self):
        assert v.validate_document_evidence_input_mode({"document_url": "https://x.example/a.pdf"}) == []
        assert v.validate_document_evidence_input_mode({}) != []
        assert (
            v.validate_document_evidence_input_mode(
                {"document_url": "https://x.example/a.pdf", "upload_reference": "up_1"}
            )
            != []
        )

    def test_company_evidence_input_has_identifier(self):
        assert v.validate_company_evidence_input_has_identifier({"ticker": "ACME"}) == []
        assert v.validate_company_evidence_input_has_identifier({}) != []
