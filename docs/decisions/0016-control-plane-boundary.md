# ADR 0016: Control Plane Boundary

## Status

Accepted

## Context

The SITEBORNE Utility Network requires a deterministic, credential-independent
control plane foundation for local development and testing. The control plane
must handle request routing, state management, idempotency, artifact storage,
queue dispatch, quota management, and audit logging without requiring live
Cloudflare credentials.

## Decision

The control plane is implemented as a layered architecture within the edge-api
Hono application:

1. **HTTP Boundary** - Hono middleware for request validation, security headers,
   timing, and audit context
2. **Request Context** - Typed request context with request ID, correlation ID,
   idempotency key, and test mode detection
3. **Structural Validation** - Content-Type and body size validation
4. **Semantic Validation** - Service contract resolution and schema hash
   verification
5. **Service Contract Resolution** - Mapping service IDs to frozen contract
   versions
6. **Idempotency Acquisition** - Transactional idempotency record creation with
   exactly-once job creation semantics
7. **Job Creation** - Job and initial attempt records with proper state
   initialization
8. **State Machine Transition** - Deterministic orchestration states with
   allowed/forbidden transitions
9. **Quota Reservation** - Resource class-based quota with additive cost formula
   and scarcity multipliers
10. **Dispatch Decision** - Queue dispatch with bounded message payloads
11. **Queue Abstraction** - In-memory and R2-compatible queue producer/consumer
    interfaces
12. **Artifact Abstraction** - Content-addressed artifact storage with SHA-256
    verification
13. **Audit Persistence** - Structured audit and security event logging with PII
    redaction
14. **Deterministic Response** - Typed responses with contract validation

## Consequences

- Local development works without Cloudflare credentials
- All control plane components are testable with in-memory implementations
- Production deployment requires Cloudflare bindings but fails closed when
  absent
- No payment, provider execution, or external service calls in this increment
- Four service implementations remain not implemented
- Production readiness remains false

## Alternatives Considered

- Implementing directly against Cloudflare bindings only - rejected because it
  blocks local development
- Using a separate local emulator - rejected in favor of in-memory
  implementations that are faster and more deterministic
- Deferring control plane to later increment - rejected because services need
  orchestration foundation
