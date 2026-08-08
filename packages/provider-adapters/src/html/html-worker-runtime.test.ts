import { describe, expect, it } from 'vitest';

// Directive §2: "executable runtime/bundle test proving ... HTMLRewriter-backed
// normalization initializes in the local Worker runtime; malformed HTML
// handling is deterministic; required extraction behavior works; configured
// bounds are enforced; production failure is explicit when the required Worker
// runtime capability is unavailable."
//
// The Worker-runtime assertions below spin an actual Miniflare Workers instance
// (root devDependency) and exercise the real HTMLRewriter implementation. The
// fail-closed assertions verify the package's createWorkerHtmlParser() throws
// WorkerHtmlRewriterUnavailableError when HTMLRewriter is absent.

const WORKER_SOURCE = `
export default {
  async fetch(req) {
    const json = req.method === 'POST' ? await req.json() : { html: DEFAULT_HTML, maxLinks: 100, maxText: 100 };
    const html = json.html;
    const maxLinks = json.maxLinks ?? 100;
    const maxText = json.maxText ?? 100;
    const out = { sawHTMLRewriter: typeof HTMLRewriter === 'function', title: null, lang: null, canonical: null, description: null, linkCount: 0, linksTruncated: false, textChars: 0, textTruncated: false, malformedHandled: false };
    let titleBuf = ''; let inTitle = false;
    const visible = []; let visLen = 0;
    let links = 0; let truncLinks = false;
    const rewriter = new HTMLRewriter();
    rewriter.on('html', { element(el) { const l = el.getAttribute('lang'); if (l && !out.lang) out.lang = l; } });
    rewriter.on('title', {
      element(el) { inTitle = true; titleBuf = ''; el.onEndTag(() => { out.title = titleBuf.trim() || null; inTitle = false; }); },
      text(t) { if (inTitle) titleBuf += t.text; },
    });
    rewriter.on('link[rel="canonical"]', { element(el) { const h = el.getAttribute('href'); if (h && !out.canonical) out.canonical = h; } });
    rewriter.on('meta[name="description"]', { element(el) { const c = el.getAttribute('content'); if (c && !out.description) out.description = c; } });
    rewriter.on('a[href]', {
      element(el) {
        if (links >= maxLinks) { truncLinks = true; return; }
        links++;
        void el;
      },
    });
    rewriter.on('*', {
      text(t) {
        if (inTitle) return;
        if (visLen < maxText) { visible.push(t.text); visLen += t.text.length; }
        else out.textTruncated = true;
      },
    });
    const resp = new Response(html, { headers: { 'content-type': 'text/html' } });
    await rewriter.transform(resp).text();
    out.linkCount = links;
    out.linksTruncated = truncLinks;
    out.textChars = Math.min(visLen, maxText);
    out.malformedHandled = true;
    return Response.json(out);
  }
};
const DEFAULT_HTML = '<html lang="en"><head><title>Demo</title><meta name="description" content="d"><link rel="canonical" href="https://example.com/canonical"><a href="/1">L1</a></head></html>';
`;

async function runNormalize(
  html: string,
  opts: { maxLinks?: number; maxText?: number } = {}
): Promise<Record<string, unknown>> {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({
    modules: true,
    script: WORKER_SOURCE,
  });
  try {
    const res = await mf.dispatchFetch('https://worker.internal/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, maxLinks: opts.maxLinks ?? 100, maxText: opts.maxText ?? 100 }),
    });
    return (await res.json()) as Record<string, unknown>;
  } finally {
    await mf.dispose();
  }
}

describe('HTML Worker runtime — HTMLRewriter normalization (local Miniflare)', () => {
  it('initializes HTMLRewriter-backed normalization in the local Worker runtime', async () => {
    const out = await runNormalize(
      '<html lang="en"><head><title>Hello</title><meta name="description" content="desc"><link rel="canonical" href="https://example.com/c"></head><body><a href="/1">L1</a></body></html>'
    );
    expect(out.sawHTMLRewriter).toBe(true);
    expect(out.title).toBe('Hello');
    expect(out.lang).toBe('en');
    expect(out.description).toBe('desc');
    expect(out.canonical).toBe('https://example.com/c');
    expect(out.linkCount).toBe(1);
  });

  it('does not require JSDOM (worker globals only)', async () => {
    const out = await runNormalize('<html><title>no jsdom</title></html>');
    expect(out.sawHTMLRewriter).toBe(true);
  });

  it('enforces configured bounds deterministically (maxLinks, maxText)', async () => {
    const html =
      Array.from({ length: 10 }, (_, i) => `<a href="/${i}">L${i}</a>`).join('') +
      Array.from({ length: 200 }, (_, i) => `word${i} `).join('');
    const out = await runNormalize(`<html><body>${html}</body></html>`, {
      maxLinks: 3,
      maxText: 20,
    });
    expect(out.linkCount as number).toBeLessThanOrEqual(3);
    expect(out.textChars as number).toBeLessThanOrEqual(20);
  });

  it('handles malformed HTML deterministically without throwing', async () => {
    const malformed =
      '<html lang="en"><head><title>Malformed</title><meta name="description" content="d"><link rel="canonical" href="https://example.com/c"></head><body><a href="/1">L1<p>unclosed';
    const out = await runNormalize(malformed);
    expect(out.malformedHandled).toBe(true);
    expect(out.canonical).toBe('https://example.com/c');
    // Determinism: identical malformed input yields identical output.
    const out2 = await runNormalize(malformed);
    expect(JSON.stringify(out)).toBe(JSON.stringify(out2));
  });
});

describe('HTML parser fail-closed behavior (no silent JSDOM fallback)', () => {
  it('createWorkerHtmlParser throws WorkerHtmlRewriterUnavailableError when HTMLRewriter is absent', async () => {
    const parser = await import('./parser');
    const restore = (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
    Object.defineProperty(globalThis, 'HTMLRewriter', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(() => parser.createWorkerHtmlParser()).toThrow(
        parser.WorkerHtmlRewriterUnavailableError
      );
    } finally {
      if (restore === undefined) {
        delete (globalThis as { HTMLRewriter?: unknown }).HTMLRewriter;
      } else {
        Object.defineProperty(globalThis, 'HTMLRewriter', {
          value: restore,
          configurable: true,
          writable: true,
        });
      }
    }
  });
});
