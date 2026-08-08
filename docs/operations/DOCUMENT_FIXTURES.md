# Document Worker Fixture Corpus

`services/modal-worker/fixtures/` — all programmatically generated
(`scripts/generate_fixtures.py`, using reportlab for PDFs and Pillow for
images). No downloaded or uncontrolled copyrighted documents. Total corpus size:
~76 KB.

## Regenerating

```bash
pnpm document-worker:fixtures:generate
```

Regeneration is deterministic given the same reportlab/Pillow versions (fixed
author/title metadata, fixed text content, fixed layout) — pinned library
versions in `pyproject.toml` keep this stable across environments. Byte-for-byte
regeneration is **not** guaranteed across library version bumps (font
rasterization, PDF object ordering, etc. can shift); what's guaranteed is that
extracted _content_ (text, tables, classification) is unchanged, which is what
the test suite actually asserts against.

## Corpus (`fixtures/MANIFEST.json`)

**PDF** (`fixtures/pdf/`): `native_text_one_page`, `native_text_multi_page` (3
pages), `blank_page`, `single_table` (5 rows), `multi_table` (2 tables on one
page), `scanned_page` (image-only, exercises OCR), `encrypted`
(password-protected — never opened, only rejected), `malformed` (corrupt bytes),
`over_page_limit` (12 pages, exceeds the frozen 10-page bound).

**Images** (`fixtures/images/`): `text.png`, `text.jpg` (OCR text), `blank.png`,
`low_contrast.png`, `malformed.png` (corrupt PNG signature+body),
`mismatched_extension.png` (real JPEG bytes, PNG-looking filename — used to
prove magic-byte sniffing, not the declared type, drives media-type validation).

## Adding a fixture

1. Add a `make_*` function to `scripts/generate_fixtures.py`.
2. Call it from `main()`, add the filename to the manifest lists.
3. Add a `@pytest.fixture` in `tests/document/conftest.py` if it'll be reused
   across multiple test files.
4. Regenerate (`pnpm document-worker:fixtures:generate`) and commit the output
   alongside the test that exercises it.

## Verification

`pnpm document-worker:fixtures:verify` checks every file listed in
`MANIFEST.json` actually exists on disk — it fails the build if a fixture
referenced by the manifest is missing (e.g. accidentally left uncommitted).
