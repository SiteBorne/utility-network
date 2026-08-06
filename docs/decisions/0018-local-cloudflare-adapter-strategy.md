# ADR 0018: Local Cloudflare Adapter Strategy

## Status

Accepted

## Context

The control plane must work locally without Cloudflare credentials while also
being deployable to Cloudflare Workers with real bindings. This requires adapter
patterns for D1, R2, and Queues.

## Decision

Implement a three-layer adapter strategy:

### 1. Interface Layer (Repository/Store Interfaces)

- TypeScript interfaces defining all persistence operations
- Independent of D1-specific SQL where practical
- Used by control plane business logic

### 2. In-Memory Implementations (Local/Test)

- Full implementations using Map/Map-based stores
- Deterministic, fast, no external dependencies
- Used for local development, unit tests, CI
- No fake success behavior - real constraints enforced

### 3. Cloudflare Adapters (Production)

- D1Repository: Wraps D1 prepared statements with same interface
- R2ArtifactStoreAdapter: Implements ArtifactStore using R2 bucket
- R2QueueProducerAdapter/ConsumerAdapter: Implements QueueProducer/Consumer
  using Cloudflare Queues
- Compile without live credentials (binding types only)
- Fail closed in production when bindings absent

### Configuration

- `createControlPlaneConfig(env)` validates production bindings
- Test mode uses explicit local adapters via `createTestConfig()`
- Development mode uses `createDevelopmentConfig()`
- No implicit fallback from production to in-memory
- Paid overflow defaults to false
- Production services default to false

### Type Generation

- Worker environment types generated deterministically from wrangler.toml
- Binding declarations in wrangler.toml without real account IDs/secrets
- Cloudflare Workers types (@cloudflare/workers-types) for compile-time checking

## Consequences

- Local development requires no Cloudflare account
- Tests run in milliseconds with in-memory stores
- Production deployment requires Cloudflare resources
- Clear separation between interface and implementation
- Easy to swap implementations for testing

## Alternatives Considered

- Miniflare for local emulation - rejected due to complexity and non-determinism
- SQLite for local D1 - rejected because in-memory is faster and sufficient
- Single implementation with feature flags - rejected because it couples test
  and production code
