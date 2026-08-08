# SITEBORNE Utility Network - ADR 0001: Public Adapter Boundary

## Context

The SITEBORNE Utility Network needs to provide credential-independent adapters
for various data sources. These adapters must be reusable across different
services and maintain clear boundaries.

## Decision

We will define a clear public boundary for all provider-adapters that includes:

- Well-defined input/output interfaces
- Consistent error handling and result classification
- Strict security boundaries (no direct access to credentials or sensitive data)
- Deterministic behavior for testability

## Status

Accepted

## Decision Outcomes

- All adapters will implement a common `execute()` method with typed inputs and
  outputs
- All adapters will return standardized `AdapterResult` objects with clear
  classification
- All adapters will use the same error handling patterns
- All adapters will have health check endpoints

## Consequences

- Clear separation between public and internal APIs
- Easier testing and maintenance of adapter implementations
- Consistent user experience across all data sources
- Clear boundaries for security and terms enforcement
