# ADR 0019: Resource Reservation and Cost Guard

## Status

Accepted

## Context

The control plane must enforce resource quotas and cost limits before
dispatching jobs to workers. This prevents overspending and ensures fair
resource allocation.

## Decision

Implement deterministic quota reservation and cost guard with additive cost
formula.

### Resource Classes

- `cpu_heavy`: CPU-intensive operations (Modal, browser rendering)
- `storage`: Artifact storage in R2
- `network`: External API calls (SEC, web fetch)
- `verification`: Cryptographic verification operations

Each resource class has:

- Total units (configured)
- Available units (tracked)
- Reserved units (active reservations)
- Replacement cost per unit (decimal string)
- Scarcity multiplier (dynamic based on availability)
- Failure risk multiplier (static per class)

### Additive Cost Formula

```
expected_cost =
  resource_replacement_cost
  + verification_cost
  + facilitator_cost
  + expected_retry_cost
  + refund_reserve
  + storage_cost
```

All monetary values use decimal-safe string arithmetic (no binary
floating-point).

### Scarcity Multipliers

- < 10% remaining: 3.0x
- < 25% remaining: 2.0x
- < 50% remaining: 1.5x
- ≥ 50% remaining: 1.0x

### Quota Reservation Flow

1. Calculate expected cost for requested resource units
2. Verify expected_cost ≤ max_authorized_cost (configured limit)
3. Check available_units ≥ requested_units
4. Reserve units atomically (decrement available, increment reserved)
5. Create QuotaReservation record with expiration (30 minutes)
6. On job completion or failure: release reservation (increment available,
   decrement reserved)
7. Expired reservations auto-released by cleanup job

### Cost Guard Rules

- Paid overflow: false by default (requires operator approval)
- No negative costs (enforced by decimal arithmetic)
- No binary floating-point for money (decimal strings only)
- Reservation cannot exceed configured limits
- Failed reservation = no dispatch
- Reservations expire and release deterministically
- Increasing any cost component never decreases minimum cost (monotonicity)

### Pricing Package Reuse

Uses existing pricing package for:

- Decimal string arithmetic (addDecimal, multiplyDecimal, compareDecimal)
- Margin calculations (rational numerator/denominator)
- Price change limits (20%)
- Margin boundary enforcement

### Testing

- Property tests for cost monotonicity
- Scarcity multiplier boundary tests
- Reservation conflict tests
- Expiration release tests
- Decimal arithmetic precision tests
