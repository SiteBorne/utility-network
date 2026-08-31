"""SUN-1221E5Q6G — versioned internal request/response contract between the
Worker and this executor. §3/§4 of the directive: no payment material of any
kind may appear here — enforced structurally (this module has no field for
it) and by `tests/test_no_payment_material.py`'s field-name/type audit."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EXECUTOR_REQUEST_CONTRACT_VERSION: Literal[1] = 1

# Fields that must NEVER appear anywhere in this module — checked by a test
# that walks every model's field names, not just eyeballed here.
FORBIDDEN_FIELD_SUBSTRINGS = (
    "payment",
    "signature",
    "eip3009",
    "eip_3009",
    "facilitator",
    "receipt_signing",
    "cdp_",
    "seller_wallet",
    "buyer_wallet",
    "private_key",
)


class WebctxFetchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_version: Literal[1] = EXECUTOR_REQUEST_CONTRACT_VERSION
    correlation_id: str = Field(min_length=1, max_length=128)
    target_url: str = Field(min_length=1, max_length=2048)
    retrieval_mode: Literal["direct"]
    deadline_ms: int = Field(gt=0, le=30_000)
    max_response_bytes: int = Field(gt=0, le=10_000_000)
    security_policy_version: Literal[1] = 1
    # SUN-1221E5Q6G — when True, return the FIRST hop's raw result verbatim
    # (status/headers/body) even if it is a 3xx, instead of following it.
    # `packages/provider-adapters/src/http/client.ts`'s `SecureHttpClient`
    # already owns a well-tested, Worker-side redirect loop that calls the
    # injected `InjectedHttpClient.fetch()` once per hop with
    # `redirect: 'manual'` and independently revalidates each redirect
    # target itself before ever asking this executor to fetch it (defense-
    # in-depth, unchanged) — `ModalSafeEgressClient`
    # (packages/provider-adapters/src/http/modal-safe-egress-client.ts)
    # sets this to True on every call for exactly that reason. Defaults to
    # False so this executor's own multi-hop redirect handling (§5 steps
    # 16-19 of the SUN-1221E5Q6G directive, fully implemented and tested)
    # remains available for any future direct/non-Worker-mediated caller.
    single_hop: bool = False


class RedirectHop(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    status: int


class WebctxFetchSuccess(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_class: Literal["success"] = "success"
    http_status: int
    final_url: str
    redirect_chain: list[RedirectHop] = Field(default_factory=list)
    # Every response header, lowercased — not just content_type — so a
    # `single_hop=True` caller (`ModalSafeEgressClient`) can reconstruct a
    # faithful `Response` object including `location` (needed by
    # `SecureHttpClient`'s own redirect-loop detection on a 3xx hop),
    # `content-length`, and `content-encoding`.
    headers: dict[str, str] = Field(default_factory=dict)
    content_base64: str
    content_type: str | None = None
    truncated: bool
    elapsed_ms: int


class WebctxFetchFailure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_class: Literal["failure"] = "failure"
    # Mirrors packages/provider-adapters/src/errors.ts's WEBCTX_* reason-code
    # taxonomy where semantically applicable (SUN-1221E5Q6G §18) — a stable,
    # closed set the Worker-side client maps 1:1 onto the same
    # `classifyGenericAdapterErrorReason` bucket names, never a raw
    # exception string.
    reason_code: Literal[
        "WEBCTX_URL_VALIDATION_FAILED",
        "WEBCTX_DNS_RESOLUTION_FAILED",
        "WEBCTX_SSRF_BLOCKED",
        "WEBCTX_UPSTREAM_CONNECTION_FAILED",
        "WEBCTX_REQUEST_WRITE_FAILED",
        "WEBCTX_RESPONSE_READ_FAILED",
        "WEBCTX_HTTP_PREMATURE_EOF",
        "WEBCTX_HTTP_INVALID_RESPONSE_STATUS",
        "WEBCTX_RESPONSE_PARSE_FAILED",
        "WEBCTX_RESPONSE_TOO_LARGE",
        "WEBCTX_REDIRECT_POLICY_BLOCKED",
        "WEBCTX_TIMEOUT",
        "WEBCTX_UPSTREAM_PROTOCOL_ERROR",
    ]
    stage: Literal[
        "url_validation", "dns_resolution", "connect", "tls", "request_write", "response_read", "redirect",
    ]
    message: str = Field(max_length=500)
    elapsed_ms: int
