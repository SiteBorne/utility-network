"""
Python semantic validators for SITEBORNE service contracts.
Mirrors the TypeScript validators in packages/contracts/src/semantic/validators.ts

Pydantic v2 models (this repo pins pydantic>=2.7 — see pyproject.toml).
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

# Regex patterns (matching TypeScript exactly)
SHA256_REGEX = re.compile(r'^sha256:[a-f0-9]{64}$')
RFC3339_REGEX = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$')
MONEY_AMOUNT_REGEX = re.compile(r'^(0|[1-9]\d*)(\.\d{1,18})?$')
DOMAIN_REGEX = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$')
EXTENSION_NAMESPACE_REGEX = re.compile(r'^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?){2,}$')
SERVICE_ID_REGEX = re.compile(r'^[a-z0-9_]+\.v[0-9]+$')
SERVICE_VERSION_REGEX = re.compile(r'^v[0-9]+(\.[0-9]+)*$')
UUID_REGEX = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
ULID_REGEX = re.compile(r'^[0-9A-HJKMNP-TV-Z]{26}$')
REQUEST_ID_REGEX = re.compile(f'^(?:{UUID_REGEX.pattern}|{ULID_REGEX.pattern})$')


# Validation functions
def is_valid_sha256(hash_str: str) -> bool:
    return bool(SHA256_REGEX.match(hash_str))


def is_valid_rfc3339(ts: str) -> bool:
    return bool(RFC3339_REGEX.match(ts))


def is_valid_money_amount(amount: str) -> bool:
    return bool(MONEY_AMOUNT_REGEX.match(amount))


def is_valid_domain(domain: str) -> bool:
    return bool(DOMAIN_REGEX.match(domain))


def is_valid_extension_namespace(ns: str) -> bool:
    return bool(EXTENSION_NAMESPACE_REGEX.match(ns)) and len(ns) <= 253


def is_valid_service_id(sid: str) -> bool:
    return bool(SERVICE_ID_REGEX.match(sid))


def is_valid_service_version(ver: str) -> bool:
    return bool(SERVICE_VERSION_REGEX.match(ver))


def is_valid_request_id(rid: str) -> bool:
    return bool(REQUEST_ID_REGEX.match(rid))


def is_timestamp_after(after: str, before: str) -> bool:
    try:
        return datetime.fromisoformat(after.replace('Z', '+00:00')) > datetime.fromisoformat(
            before.replace('Z', '+00:00')
        )
    except ValueError:
        return False


# Validation functions returning list of errors
def validate_hash_pairing(input_hash: str, input_schema_hash: str, output_schema_hash: str) -> List[str]:
    errors = []
    if not is_valid_sha256(input_hash):
        errors.append('input_hash must be valid sha256')
    if not is_valid_sha256(input_schema_hash):
        errors.append('input_schema_hash must be valid sha256')
    if not is_valid_sha256(output_schema_hash):
        errors.append('output_schema_hash must be valid sha256')
    return errors


def validate_money(amount: str, currency: str) -> List[str]:
    errors = []
    if not is_valid_money_amount(amount):
        errors.append('amount must be canonical decimal string')
    if currency != 'USD':
        errors.append('currency must be USD')
    return errors


def validate_extension_namespace(ns: str) -> List[str]:
    errors = []
    if not is_valid_extension_namespace(ns):
        errors.append(
            f"extension namespace '{ns}' must be reverse-domain qualified "
            "(max 253 chars, min 3 labels, lowercase DNS-safe)"
        )
    return errors


def validate_service_pairing(service_id: str, service_version: str) -> List[str]:
    errors = []
    if not is_valid_service_id(service_id):
        errors.append('service_id must match pattern')
    if not is_valid_service_version(service_version):
        errors.append('service_version must match pattern vN')
    return errors


def validate_quote_exact_upto(scheme: str, price: Optional[dict] = None, max_price: Optional[dict] = None) -> List[str]:
    errors = []
    if scheme == 'exact':
        if not price:
            errors.append('exact scheme requires price')
        if max_price:
            errors.append('exact scheme must not have maximum_authorized_price')
    elif scheme == 'upto':
        if not max_price:
            errors.append('upto scheme requires maximum_authorized_price')
        if price:
            errors.append('upto scheme must not have price')
    return errors


def validate_timestamp_ordering(issued_at: str, expires_at: str) -> List[str]:
    errors = []
    if not is_valid_rfc3339(issued_at):
        errors.append('issued_at must be RFC3339 UTC')
    if not is_valid_rfc3339(expires_at):
        errors.append('expires_at must be RFC3339 UTC')
    if not is_timestamp_after(expires_at, issued_at):
        errors.append('expires_at must be after issued_at')
    return errors


def validate_exactly_one_mode(modes: dict, mode_names: list) -> List[str]:
    present = [k for k in mode_names if k in modes and modes[k] is not None]
    if len(present) != 1:
        return [f"exactly one of [{', '.join(mode_names)}] must be provided"]
    return []


def validate_service_extension(extensions: dict, required_ns: str) -> List[str]:
    errors = []
    if required_ns not in extensions:
        errors.append(f"required extension namespace '{required_ns}' is missing")
    for ns in extensions.keys():
        if not is_valid_extension_namespace(ns):
            errors.append(f"extension namespace '{ns}' is invalid")
    return errors


def validate_wrong_extension(extensions: dict, wrong_ns: str) -> List[str]:
    if wrong_ns in extensions:
        return [f"wrong service extension '{wrong_ns}' is not allowed"]
    return []


def validate_completeness(completeness: dict) -> List[str]:
    errors = []
    r = completeness.get('requested_fields', 0)
    p = completeness.get('populated_fields', 0)
    s = completeness.get('supported_fields', 0)
    sc = completeness.get('score', 0)
    if s > p:
        errors.append('supported_fields cannot exceed populated_fields')
    if p > r:
        errors.append('populated_fields cannot exceed requested_fields')
    if not (0 <= sc <= 1):
        errors.append('score must be in [0, 1]')
    if r < 0 or p < 0 or s < 0:
        errors.append('counts cannot be negative')
    return errors


def validate_deterministic_failures(verification: dict) -> List[str]:
    if verification.get('decision') == 'pass':
        det_failures = verification.get('deterministic_failures', [])
        if det_failures and len(det_failures) > 0:
            return ['deterministic failures prevent pass decision']
    return []


# ---------------------------------------------------------------------------
# Pydantic v2 models for generated code (common/envelope schemas)
# ---------------------------------------------------------------------------

class MoneyModel(BaseModel):
    amount: str = Field(..., pattern=r'^(0|[1-9]\d*)(\.\d{1,18})?$')
    currency: str = Field(default='USD', pattern=r'^[A-Z]{3}$')
    network: Optional[str] = Field(None, pattern=r'^[a-z0-9-]+$', max_length=64)
    asset: Optional[str] = Field(None, pattern=r'^[A-Z0-9]{3,10}$')
    precision: Optional[int] = Field(None, ge=0, le=18)


class RequestEnvelopeModel(BaseModel):
    request_id: str = Field(..., pattern=REQUEST_ID_REGEX.pattern)
    service_id: str = Field(..., pattern=SERVICE_ID_REGEX.pattern)
    service_version: str = Field(..., pattern=SERVICE_VERSION_REGEX.pattern)
    response_schema_version: str = Field(..., pattern=SERVICE_VERSION_REGEX.pattern)
    idempotency_key: str = Field(..., min_length=16, max_length=128, pattern=r'^[a-zA-Z0-9_-]+$')
    freshness_seconds: int = Field(..., ge=0, le=2592000)
    minimum_verification_score: float = Field(..., ge=0, le=1)
    maximum_authorized_price: MoneyModel
    buyer_metadata: Optional[dict] = None
    input: dict
    extensions: Optional[dict] = None


class QuoteRequestModel(BaseModel):
    request_id: str = Field(..., pattern=REQUEST_ID_REGEX.pattern)
    service_id: str = Field(..., pattern=SERVICE_ID_REGEX.pattern)
    service_version: str = Field(..., pattern=SERVICE_VERSION_REGEX.pattern)
    input_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    input_schema_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    output_schema_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    requested_pricing_scheme: Literal['exact', 'upto']
    maximum_authorized_price: Optional[dict] = None
    requested_freshness_seconds: Optional[int] = Field(None, ge=0, le=2592000)
    requested_execution_mode: Optional[Literal['sync', 'async']] = None
    idempotency_key: str = Field(..., min_length=16, max_length=128, pattern=r'^[a-zA-Z0-9_-]+$')


class QuoteResponseModel(BaseModel):
    quote_id: str = Field(..., pattern=REQUEST_ID_REGEX.pattern)
    request_id: str = Field(..., pattern=REQUEST_ID_REGEX.pattern)
    service_id: str = Field(..., pattern=SERVICE_ID_REGEX.pattern)
    service_version: str = Field(..., pattern=SERVICE_VERSION_REGEX.pattern)
    pricing_scheme: Literal['exact', 'upto']
    price: Optional[dict] = None
    maximum_authorized_price: Optional[dict] = None
    currency: Literal['USD']
    payment_network: str = Field(..., pattern=r'^[a-z0-9-]+$', max_length=64)
    payment_asset: str = Field(..., pattern=r'^[A-Z0-9]{3,10}$')
    estimated_execution_class: Literal['light', 'standard', 'heavy', 'intensive']
    execution_mode: Literal['sync', 'async']
    issued_at: str = Field(..., pattern=RFC3339_REGEX.pattern)
    expires_at: str = Field(..., pattern=RFC3339_REGEX.pattern)
    input_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    input_schema_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    output_schema_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    pricing_policy_version: str = Field(..., pattern=SERVICE_VERSION_REGEX.pattern)
    expected_completeness: float = Field(..., ge=0, le=1)
    declared_limitations: list = Field(default_factory=list, max_length=20)
    production_enabled: Literal[False]
    payment_required: bool

    @model_validator(mode='after')
    def validate_exact_upto(self) -> 'QuoteResponseModel':
        if self.pricing_scheme == 'exact':
            if not self.price:
                raise ValueError('exact scheme requires price')
            if self.maximum_authorized_price:
                raise ValueError('exact scheme must not have maximum_authorized_price')
        elif self.pricing_scheme == 'upto':
            if not self.maximum_authorized_price:
                raise ValueError('upto scheme requires maximum_authorized_price')
            if self.price:
                raise ValueError('upto scheme must not have price')
        return self

    @model_validator(mode='after')
    def validate_timestamps(self) -> 'QuoteResponseModel':
        if not is_timestamp_after(self.expires_at, self.issued_at):
            raise ValueError('expires_at must be after issued_at')
        return self


class StructuredErrorModel(BaseModel):
    error_id: str = Field(..., pattern=REQUEST_ID_REGEX.pattern)
    error_code: str = Field(..., pattern=r'^[A-Z][A-Z0-9_]*$', max_length=64)
    category: Literal[
        'validation', 'authorization', 'payment_required', 'payment_invalid', 'rate_limited',
        'unsupported', 'unavailable', 'provider_failure', 'verification_failure', 'conflict',
        'duplicate', 'internal', 'quarantined',
    ]
    message: str = Field(..., max_length=512)
    retryable: bool
    request_id: str = Field(..., pattern=REQUEST_ID_REGEX.pattern)
    service_id: str = Field(..., pattern=SERVICE_ID_REGEX.pattern)
    occurred_at: str = Field(..., pattern=RFC3339_REGEX.pattern)
    job_id: Optional[str] = Field(None, pattern=REQUEST_ID_REGEX.pattern)
    quote_id: Optional[str] = Field(None, pattern=REQUEST_ID_REGEX.pattern)
    failed_field_paths: Optional[list] = None
    limitations: Optional[list] = None
    retry_after_seconds: Optional[int] = Field(None, ge=1, le=86400)
    original_receipt_reference: Optional[str] = Field(None, pattern=SHA256_REGEX.pattern)
    provider_class: Optional[str] = Field(None, pattern=r'^[a-z0-9_-]+$', max_length=32)
    quarantine_reason: Optional[str] = Field(None, max_length=256)
    extensions: Optional[dict] = None


class ServiceMetadataModel(BaseModel):
    service_id: str = Field(..., pattern=SERVICE_ID_REGEX.pattern)
    service_version: str = Field(..., pattern=SERVICE_VERSION_REGEX.pattern)
    title: str = Field(..., max_length=128)
    description: str = Field(..., max_length=1024)
    capabilities: list = Field(..., max_length=20)
    input_schema_uri: Optional[str] = None
    input_schema_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    output_schema_uri: Optional[str] = None
    output_schema_hash: str = Field(..., pattern=SHA256_REGEX.pattern)
    pcc_version: Literal['1.0.0']
    pricing_schemes: list = Field(..., min_length=1, max_length=2)
    base_price: dict
    maximum_price: Optional[dict] = None
    execution_mode: Literal['sync', 'async', 'both']
    maximum_input_bytes: int = Field(..., ge=0, le=10485760)
    expected_latency_class: Literal['fast', 'standard', 'slow', 'variable']
    authorization_classification: Literal['public', 'buyer_authorized', 'restricted']
    promotion_state: Literal[
        'draft', 'case_supported', 'multi_case_supported', 'verified_pattern',
        'executable_candidate', 'executable_verified', 'retired', 'tombstoned',
    ]
    production_enabled: Literal[False]
    declared_limitations: list = Field(default_factory=list, max_length=20)
    protocols: dict = Field(..., min_length=7, max_length=7)
    updated_at: str = Field(..., pattern=RFC3339_REGEX.pattern)


# ---------------------------------------------------------------------------
# Service input/output schema semantic validators (SUN-0101 Task 10)
# ---------------------------------------------------------------------------
#
# Mirrors validators.ts's SERVICE_EXTENSION_NAMESPACE / validateServiceOutputDocument.
# Each of the 4 services' output document is a PCC document that must carry
# exactly its own namespaced extension and no other service's, plus the
# cross-field checks JSON Schema composition can't express cleanly.

SERVICE_EXTENSION_NAMESPACE: Dict[str, str] = {
    'company_evidence_graph.v1': 'net.siteborne.company-evidence.v1',
    'web_context_verified.v1': 'net.siteborne.web-context.v1',
    'document_evidence_json.v1': 'net.siteborne.document-evidence.v1',
    'verify_agent_output.v1': 'net.siteborne.agent-verification.v1',
}


def validate_service_output_document(doc: Dict[str, Any], expected_service_id: str) -> List[str]:
    """Validate a service output PCC document against the semantic invariants
    for expected_service_id: correct service/version pairing, valid contract
    hash triple, its own (and only its own) namespaced extension present,
    valid issued/expires ordering, and internally-consistent
    completeness/decision."""
    errors: List[str] = []
    required_ns = SERVICE_EXTENSION_NAMESPACE.get(expected_service_id)
    if required_ns is None:
        return [f"unknown service_id '{expected_service_id}' — not in SERVICE_EXTENSION_NAMESPACE registry"]

    contract = doc.get('contract', {})
    if contract.get('service_id') != expected_service_id:
        errors.append(
            f"contract.service_id must be '{expected_service_id}', got '{contract.get('service_id')}'"
        )
    errors.extend(validate_service_pairing(contract.get('service_id', ''), contract.get('service_version', '')))
    errors.extend(
        validate_hash_pairing(
            contract.get('input_hash', ''),
            contract.get('input_schema_hash', ''),
            contract.get('output_schema_hash', ''),
        )
    )
    errors.extend(validate_timestamp_ordering(contract.get('issued_at', ''), contract.get('expires_at', '')))

    extensions = doc.get('extensions') or {}
    errors.extend(validate_service_extension(extensions, required_ns))
    for other_service_id, other_ns in SERVICE_EXTENSION_NAMESPACE.items():
        if other_service_id == expected_service_id:
            continue
        errors.extend(validate_wrong_extension(extensions, other_ns))

    errors.extend(validate_completeness(doc.get('completeness', {})))
    errors.extend(validate_deterministic_failures(doc.get('verification', {})))

    return errors


def validate_document_evidence_input_mode(input_data: Dict[str, Any]) -> List[str]:
    """document-evidence-input.v1 requires exactly one of artifact_reference /
    upload_reference / document_url (enforced structurally via oneOf); this is
    the same invariant re-checked at the application layer."""
    return validate_exactly_one_mode(
        input_data, ['artifact_reference', 'upload_reference', 'document_url']
    )


def validate_company_evidence_input_has_identifier(input_data: Dict[str, Any]) -> List[str]:
    """company-evidence-input.v1 requires at least one of company_name /
    ticker / domain / identifiers (enforced structurally via anyOf);
    re-checked here as a semantic-layer guard."""
    keys = ['company_name', 'ticker', 'domain', 'identifiers']
    present = [k for k in keys if input_data.get(k) is not None]
    if not present:
        return [f"at least one of [{', '.join(keys)}] must be provided"]
    return []


# Validation functions (for direct use)
def validate_all_common(data: dict) -> List[str]:
    """Run all common semantic validations."""
    errors = []
    errors.extend(
        validate_hash_pairing(
            data.get('input_hash', ''), data.get('input_schema_hash', ''), data.get('output_schema_hash', '')
        )
    )
    errors.extend(validate_service_pairing(data.get('service_id', ''), data.get('service_version', '')))
    return errors


__all__ = [
    'validate_hash_pairing', 'validate_money', 'validate_extension_namespace',
    'validate_service_pairing', 'validate_quote_exact_upto', 'validate_timestamp_ordering',
    'validate_exactly_one_mode', 'validate_service_extension', 'validate_wrong_extension',
    'validate_completeness', 'validate_deterministic_failures',
    'MoneyModel', 'RequestEnvelopeModel', 'QuoteRequestModel', 'QuoteResponseModel',
    'StructuredErrorModel', 'ServiceMetadataModel', 'validate_all_common',
    'SERVICE_EXTENSION_NAMESPACE', 'validate_service_output_document',
    'validate_document_evidence_input_mode', 'validate_company_evidence_input_has_identifier',
]
