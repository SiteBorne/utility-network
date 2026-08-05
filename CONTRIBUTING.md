# Contributing to SITEBORNE Utility Network

## Development Workflow

1. **Read the master directive**:
   `docs/source/SITEBORNE_UTILITY_NETWORK_MASTER_DIRECTIVE.md`
2. **Check current task**: `TASKS.yaml` shows the active mutation task
3. **Follow serial execution**: Only one mutation task active at a time
4. **Write decision records**: Every rule/provider/service change requires an
   ADR in `docs/decisions/`
5. **Run validation**: `pnpm check` must pass before committing

## Code Standards

- **TypeScript**: Strict mode, no `any`, explicit return types
- **Python**: 3.12, type hints required, mypy strict
- **Formatting**: Prettier (TS/JS/JSON/YAML/MD), Ruff (Python)
- **Linting**: ESLint flat config (TS), Ruff (Python)
- **Tests**: Vitest (TS), pytest (Python) — property-based where applicable

## Commit Convention

Conventional Commits:

```
feat(scope): description
fix(scope): description
docs(scope): description
refactor(scope): description
test(scope): description
chore(scope): description
```

Scope examples: `contracts`, `pcc-schema`, `pricing`, `policy`, `edge-api`,
`modal-worker`, `governance`

## Pull Requests

- All CI checks must pass
- No TODOs in production code
- Decision record required for governance changes
- Update `PROJECT_STATE.yaml` and `TASKS.yaml` as needed

## Task Management

- Only **one** mutation task in `active` state at a time
- External dependencies marked `blocked_external`
- Never mark production systems `implemented` without evidence
- `EXECUTABLE_VERIFIED` required before any production control

## Adding Dependencies

- Only when current increment uses them
- Record exact versions in lockfiles
- Prefer standard library / minimal deps
- Security scan (OSV-Scanner) on new deps
