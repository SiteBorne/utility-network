# SITEBORNE Utility Network — Root Adapter Commands, CI, Hygiene, and Secret Scanning

## Root Commands

The following root commands are available for managing adapters and the overall system:

- `pnpm adapters:test` - Run all adapter execution tests
- `pnpm adapters:fixtures:verify` - Verify all fixture files
- `pnpm adapters:manifests:verify` - Verify all manifest files
- `pnpm adapters:check` - Run comprehensive adapter checks including:
  - Format verification
  - Linting
  - Type checking
  - Execution tests
  - Property tests
  - Fixture matrix verification
  - Manifest verification
  - Public export verification
  - Runtime parser verification
  - Hygiene verification
- `pnpm check` - Invoke all checks including format, lint, typecheck, tests, and secret scan
- `pnpm secrets:scan` - Run secret scanning with repository-standard scanner
- `pnpm check` - Run all checks including format, lint, typecheck, tests, and secret scan

## Root Command Details

### `pnpm adapters:test`
Executes all adapter execution tests to verify public interface functionality.

### `pnpm adapters:fixtures:verify`
Verifies all fixture files for correctness and validity.

### `pnpm adapters:manifests:verify`
Verifies all manifest files for correctness and validation.

### `pnpm adapters:check`
Includes:
- Adapter formatting
- Adapter linting
- Adapter type checking
- Execution tests
- Property tests
- Fixture matrix verification
- Manifest verification
- Public export verification
- Runtime parser verification
- Hygiene verification

### `pnpm check`
Invokes:
- format:check
- lint
- typecheck
- TypeScript tests
- Python tests
- PCC/service/OpenAPI drift
- Contract verification
- Migration/D1 checks
- Control-plane checks
- Adapter checks
- Governance/state/tasks
- Secret scan

A condition where `format:check` fails but `pnpm check` passes is forbidden.

Adapter gates are added to CI pipelines.