# SITEBORNE Utility Network - ADR 0029: Modal Wrapper Separation

## Context

SUN-0400A must produce a credential-independent foundation while still being
genuinely ready for SUN-0400B's live Modal deployment — without coupling the
processing logic to Modal, and without letting "designed for Modal" become an
excuse to skip local testability.

## Decision

Exactly one module, `services/modal-worker/src/modal_worker/modal_app.py`, is
permitted to `import modal`. This is enforced by an executable test
(`tests/test_modal_wrapper.py::test_document_package_never_imports_modal`),
which parses every file under `document/` with `ast` and asserts no
`import modal` / `from modal import ...` statement exists — a structural
guarantee, not a convention relied on by inspection.

```
pure document-processing core (document/)
        ↑ (execute() is the only entry point)
local runner (local_runner.py) — CLI, no modal import
        ↑
Modal deployment wrapper (modal_app.py) — the only file that imports modal
```

`modal_app.py`:

- Constructs `modal.App(...)`, `modal.Image...`, and applies
  `@app.function(...)` — all local Python object construction / decorator
  application at import time. No network call, no credential check, no
  deployment happens on import (proven by
  `test_modal_app_imports_without_credentials`, which explicitly unsets
  `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` first).
- Its deployed entry point (`process_document`) does nothing but
  `WorkerRequest.model_validate_json(...)` → `execute(...)` →
  `.model_dump_json()` — there is no processing logic to diverge between local
  and deployed execution, by construction.
- Defines a placeholder `_ModalArtifactAccessor` whose methods raise
  `NotImplementedError` — SUN-0400A does not implement live R2 access (that
  requires production Cloudflare credentials); this class exists so the
  wrapper's shape is complete and type-checks, not to claim a working live
  artifact path.

## Status

Accepted

## Consequences

- SUN-0400B's scope is genuinely narrowed to deployment mechanics (credentials,
  `modal deploy`, live health/latency/cost verification, a real R2-backed
  `ArtifactAccessor` implementation) — it inherits a processing core that is
  already fully tested, not something to build alongside the deployment work.
- If a future project ever needs a different compute target than Modal, only
  `modal_app.py` (and a new equivalent wrapper) needs to change — `document/`
  and its ~90 tests are unaffected.
