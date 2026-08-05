# @siteborne/pcc-schema

Normative schema package for Proof-Carrying Context (PCC) 1.0.0.

## Overview

This package provides:

- The canonical JSON Schema for PCC 1.0.0
- TypeScript runtime validators (Zod)
- Structural and semantic validation functions
- Canonicalization and signing utilities
- Compatibility and policy documentation

## Installation

```bash
pnpm install
```

## Usage

```typescript
import {
  validateSchema,
  validateSemantic,
  canonicalize,
  hashCanonical,
} from '@siteborne/pcc-schema';

const structural = validateSchema(document);
const semantic = validateSemantic(document);
const hash = hashCanonical(document);
```

## Schema Source

The single source of truth is:

```
../../schemas/proof-carrying-context.schema.json
```

All generated models derive from this file.

## Scripts

- `build` — Compile TypeScript
- `test` — Run Vitest suite
- `lint` — ESLint
- `typecheck` — TypeScript --noEmit

## Policies

- [Canonicalization](./CANONICALIZATION.md)
- [Compatibility](./COMPATIBILITY.md)
- [Signature Policy](./SIGNATURE_POLICY.md)

## License

MIT
