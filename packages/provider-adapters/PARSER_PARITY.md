# HTML Normalization Parser Parity Limitations

## Runtime decision

The production HTML normalization path uses the Cloudflare Workers
`HTMLRewriter` streaming implementation (`createWorkerHtmlParser()` in
`packages/provider-adapters/src/html/parser.ts`). This is the only implementation
permitted in the Worker production bundle.

JSDOM is permitted **only** in the Node test/nonproduction path
(`createNodeHtmlParser()` / `parseHtmlWithJsdom()`), and only when:

- it is isolated to tests or an explicitly nonproduction adapter;
- it is absent from the Worker production bundle;
- production source does not silently fall back to JSDOM;
- normalization behavior is tested for parity across both implementations where
  both exist (see `src/html/html-worker-runtime.test.ts`).

If `HTMLRewriter` is unavailable in the runtime, `createWorkerHtmlParser()`
throws `WorkerHtmlRewriterUnavailableError`. There is no silent JSDOM fallback.

## Behaviors that are identical on both paths

- `title`, `<meta name="description">`, `<link rel="canonical">`, and `<html lang>`
  extraction are single-element, unambiguous and produce identical values.
- JSON-LD (`<script type="application/ld+json">`) capture is identical when the
  JSON is well-formed; malformed JSON-LD is omitted deterministically on both
  paths (no throw).
- `removeScripts` / `removeStyles` semantics: script and style content is
  excluded from visible text on both paths.
- Bounded result counts (`maxLinks`, `maxTableRows`/`maxTableCols`, `maxNodes`,
  `maxTextLength`) are enforced on both paths, and truncation flags are set.
- Injection-signal scanning (`runInjectionTextScan`) runs over normalized visible
  text identically (regex-based, runtime-agnostic).

## Behaviors that cannot be identical (streaming vs tree)

`HTMLRewriter` is a streaming rewriter; it does not construct a DOM tree. The
production parser therefore performs **flat streaming attribution** of text to
the currently-open element using open/close booleans driven by `element` /
`onEndTag` handlers. JSDOM parses into a full tree. The following are therefore
**not guaranteed byte-identical** between paths and must be treated as
parity limitations:

- **CSS selector paths** for headings/paragraphs/links/list-items/tables are
  generated as `nth-of-type` counters in document order; they are *stable and
  deterministic* on each path but are not identical to the JSDOM-generated
  structural `:nth-child` paths. Do not depend on selector string equality
  across paths; depend on stable ordering within a path.
- **Nested/overlapping elements**: when elements nest (e.g. `<a>` inside `<p>`,
  `<span>` inside `<h1>`), streaming flat attribution may cross-attribute
  inner text to multiple buffers or to `visibleText` rather than the innermost
  element. The tree path attributes text to the exact descendant. The
  `visibleText` aggregate is identical; per-element text buffers may differ for
  nested content.
- **Table structure from malformed markup**: the streaming parser reconstructs
  rows/cells in document order; JSDOM normalizes via the tree. For well-formed
  tables the row/cell grids match; for malformed tables the streaming path
  approximates and may merge/collapse cells differently.
- **List nesting**: nested `<ul>`/`<ol>` produce a single flattened list in the
  streaming path (current list accumulates items regardless of depth), whereas
  JSDOM preserves `:scope > li` grouping. Flat lists are captured; nesting
  structure is not preserved on the streaming path.
- **`detectHiddenContentSignals` and the `extract.*` helpers** require a DOM and
  are therefore Node/JSDOM-test-only. They throw explicitly when invoked without
  a DOM (no silent production behavior). Hidden-content detection in production
  is performed by the streaming parser's `removeHidden`/text-bounds handling and
  the injection-signal scan, not by selector-based DOM traversal.

## Validation

The executable runtime test `src/html/html-worker-runtime.test.ts` proves, against
a local Miniflare Workers runtime:

- the Worker entry uses `HTMLRewriter` and does not require JSDOM;
- `HTMLRewriter`-backed normalization initializes in the local Worker runtime;
- required extraction (title, description, canonical, language) works;
- configured bounds (maxLinks, maxText) are enforced deterministically;
- malformed HTML is handled deterministically without throwing;
- production fails explicitly (`WorkerHtmlRewriterUnavailableError`) when the
  Worker capability is unavailable.
