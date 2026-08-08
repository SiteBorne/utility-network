import type { NormalizedHtmlResult, HtmlNormalizationOptions } from './normalize';
import { runInjectionTextScan } from './injection-signals';
// Type-only import — erased at compile time, so it does not pull jsdom into
// the Worker production bundle. The runtime value is loaded lazily via
// require() inside parseHtmlWithJsdom(), which only ever executes in the
// Node test runtime (see createNodeHtmlParser's guard).
import type { JSDOM as JSDOMCtor } from 'jsdom';

export interface HtmlParser {
  parse(html: string, sourceUrl: string, options?: HtmlNormalizationOptions): NormalizedHtmlResult;
}

export type ParserRuntime = 'worker' | 'node-test' | 'unknown';

export function detectParserRuntime(): ParserRuntime {
  if (typeof HTMLRewriter !== 'undefined') return 'worker';
  if (typeof process !== 'undefined' && process.versions?.node) return 'node-test';
  return 'unknown';
}

export class WorkerHtmlRewriterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerHtmlRewriterUnavailableError';
  }
}

export class JSDOMInProductionError extends Error {
  constructor(provider: string) {
    super(
      `JSDOM HTML parser is test-only and must not run in production paths (requested by ${provider}). Use createWorkerHtmlParser() in the Worker runtime.`
    );
    this.name = 'JSDOMInProductionError';
  }
}

interface OpenCtx {
  title: boolean;
  heading: boolean;
  paragraph: boolean;
  link: boolean;
  item: boolean;
  cell: boolean;
  script: boolean;
  style: boolean;
  jsonLd: boolean;
}

interface Builder {
  result: NormalizedHtmlResult;
  options: Required<HtmlNormalizationOptions>;
  nodeCount: number;
  buffer: {
    title: string;
    jsonLd: string;
    heading: string;
    paragraph: string;
    link: string;
    item: string;
    cell: string;
  };
  pending: {
    headingLevel: number;
    linkHref: string | null;
    listType: 'ul' | 'ol' | null;
    listItems: Array<{ text: string }>;
    cellKind: 'th' | 'td' | null;
    table: { headers: string[]; rows: string[][] } | null;
    row: string[] | null;
  };
  visible: string[];
  visibleLength: number;
  counts: { heading: number; para: number; link: number; list: number; table: number };
}

function emptyResult(): NormalizedHtmlResult {
  return {
    title: null,
    canonicalLink: null,
    language: null,
    metaDescription: null,
    headings: [],
    paragraphs: [],
    lists: [],
    tables: [],
    links: [],
    visibleText: '',
    structuredData: [],
    promptInjectionSignals: [],
    truncation: { nodes: false, depth: false, text: false, links: false, tables: false },
    nodeCount: 0,
    maxDepthReached: 0,
  };
}

function resolveOptions(options?: HtmlNormalizationOptions): Required<HtmlNormalizationOptions> {
  return {
    maxNodes: options?.maxNodes ?? 50000,
    maxDepth: options?.maxDepth ?? 100,
    maxTextLength: options?.maxTextLength ?? 1_000_000,
    maxLinks: options?.maxLinks ?? 5000,
    maxTableRows: options?.maxTableRows ?? 1000,
    maxTableCols: options?.maxTableCols ?? 50,
    removeScripts: options?.removeScripts ?? true,
    removeStyles: options?.removeStyles ?? true,
    removeComments: options?.removeComments ?? true,
    removeHidden: options?.removeHidden ?? true,
    removeNavigation: options?.removeNavigation ?? true,
    keepStructuredData: options?.keepStructuredData ?? true,
  };
}

function makeBuilder(options?: HtmlNormalizationOptions): Builder {
  return {
    result: emptyResult(),
    options: resolveOptions(options),
    nodeCount: 0,
    buffer: { title: '', jsonLd: '', heading: '', paragraph: '', link: '', item: '', cell: '' },
    pending: {
      headingLevel: 0,
      linkHref: null,
      listType: null,
      listItems: [],
      cellKind: null,
      table: null,
      row: null,
    },
    visible: [],
    visibleLength: 0,
    counts: { heading: 0, para: 0, link: 0, list: 0, table: 0 },
  };
}

export function createWorkerHtmlParser(): HtmlParser {
  if (typeof HTMLRewriter === 'undefined') {
    throw new WorkerHtmlRewriterUnavailableError(
      'HTMLRewriter is not available in this runtime. The Worker HTML parser requires the Cloudflare Workers HTMLRewriter capability. Production cannot silently fall back to JSDOM.'
    );
  }
  return { parse: parseHtmlWithHtmlRewriter };
}

export function createNodeHtmlParser(): HtmlParser {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw new JSDOMInProductionError('createNodeHtmlParser');
  }
  return { parse: parseHtmlWithJsdom };
}

export function createAutoHtmlParser(): HtmlParser {
  const runtime = detectParserRuntime();
  if (runtime === 'worker') return createWorkerHtmlParser();
  if (runtime === 'node-test') return createNodeHtmlParser();
  throw new WorkerHtmlRewriterUnavailableError(
    'Unknown runtime: neither HTMLRewriter nor Node/JSDOM is available.'
  );
}

function parseHtmlWithHtmlRewriter(
  html: string,
  _sourceUrl: string,
  options?: HtmlNormalizationOptions
): NormalizedHtmlResult {
  if (typeof HTMLRewriter === 'undefined') {
    throw new WorkerHtmlRewriterUnavailableError('HTMLRewriter is not available in this runtime.');
  }
  const rewriter: HTMLRewriterLike = HTMLRewriter;
  const b = makeBuilder(options);
  const ctx: OpenCtx = {
    title: false,
    heading: false,
    paragraph: false,
    link: false,
    item: false,
    cell: false,
    script: false,
    style: false,
    jsonLd: false,
  };
  installHandlers(rewriter, b, ctx);
  const base = new Response(html, { headers: { 'content-type': 'text/html' } });
  rewriter.transform(base).text();
  finalize(b);
  return b.result;
}

function installHandlers(rewriter: HTMLRewriterLike, b: Builder, ctx: OpenCtx): void {
  const opts = b.options;

  const reg = (selector: string, onStart: (el: ElementLike) => void, onEnd?: () => void): void => {
    rewriter.on(selector, {
      element(el: ElementLike) {
        b.nodeCount++;
        if (opts.maxNodes && b.nodeCount > opts.maxNodes) b.result.truncation.nodes = true;
        onStart(el);
        if (onEnd) el.onEndTag?.(onEnd);
      },
    });
  };

  reg('html', (el) => {
    const lang = el.getAttribute('lang');
    if (lang && !b.result.language) b.result.language = lang;
  });

  reg('link[rel="canonical"]', (el) => {
    const href = el.getAttribute('href');
    if (href && !b.result.canonicalLink) b.result.canonicalLink = href;
  });

  reg('meta[name="description"]', (el) => {
    const content = el.getAttribute('content');
    if (content && !b.result.metaDescription) b.result.metaDescription = content;
  });

  reg(
    'title',
    () => {
      ctx.title = true;
      b.buffer.title = '';
    },
    () => {
      ctx.title = false;
      b.result.title = b.buffer.title.trim() || null;
      b.buffer.title = '';
    }
  );

  reg(
    'script',
    (el) => {
      ctx.script = true;
      if (el.getAttribute('type') === 'application/ld+json') {
        ctx.jsonLd = true;
        b.buffer.jsonLd = '';
      }
    },
    () => {
      ctx.script = false;
      if (ctx.jsonLd) {
        ctx.jsonLd = false;
        finalizeJsonLd(b);
      }
    }
  );

  reg(
    'style',
    () => {
      ctx.style = true;
    },
    () => {
      ctx.style = false;
    }
  );

  for (let level = 1; level <= 6; level++) {
    const tag = `h${level}`;
    reg(
      tag,
      () => {
        ctx.heading = true;
        b.buffer.heading = '';
        b.pending.headingLevel = level;
      },
      () => {
        ctx.heading = false;
        const text = b.buffer.heading.trim();
        if (text && b.counts.heading < opts.maxLinks) {
          b.counts.heading++;
          b.result.headings.push({
            level,
            text,
            selector: `body ${tag}:nth-of-type(${b.counts.heading})`,
          });
        }
        b.buffer.heading = '';
        b.pending.headingLevel = 0;
      }
    );
  }

  reg(
    'p',
    () => {
      ctx.paragraph = true;
      b.buffer.paragraph = '';
    },
    () => {
      ctx.paragraph = false;
      const text = b.buffer.paragraph.trim();
      if (text && b.counts.para < opts.maxNodes) {
        b.counts.para++;
        b.result.paragraphs.push({ text, selector: `body p:nth-of-type(${b.counts.para})` });
      }
      b.buffer.paragraph = '';
    }
  );

  for (const tag of ['ul', 'ol'] as const) {
    reg(
      tag,
      () => {
        b.pending.listType = tag;
        b.pending.listItems = [];
      },
      () => {
        if (b.pending.listType && b.pending.listItems.length > 0 && b.counts.list < opts.maxNodes) {
          b.counts.list++;
          b.result.lists.push({
            type: b.pending.listType,
            items: b.pending.listItems.map((it, i) => ({
              text: it.text,
              selector: `${tag} > li:nth-child(${i + 1})`,
            })),
            selector: `body ${tag}:nth-of-type(${b.counts.list})`,
          });
        }
        b.pending.listType = null;
        b.pending.listItems = [];
      }
    );
  }

  reg(
    'li',
    () => {
      ctx.item = true;
      b.buffer.item = '';
    },
    () => {
      ctx.item = false;
      if (b.pending.listType) {
        const text = b.buffer.item.trim();
        if (text) b.pending.listItems.push({ text });
      }
      b.buffer.item = '';
    }
  );

  reg(
    'table',
    () => {
      if (b.counts.table >= opts.maxTableRows) {
        b.result.truncation.tables = true;
        b.pending.table = null;
        return;
      }
      b.pending.table = { headers: [], rows: [] };
    },
    () => {
      if (b.pending.table && (b.pending.table.headers.length || b.pending.table.rows.length)) {
        b.counts.table++;
        b.result.tables.push({
          headers: b.pending.table.headers,
          rows: b.pending.table.rows.map((r) => r.slice(0, opts.maxTableCols)),
          selector: `body table:nth-of-type(${b.counts.table})`,
        });
      }
      b.pending.table = null;
    }
  );

  reg(
    'tr',
    () => {
      b.pending.row = b.pending.table ? [] : null;
    },
    () => {
      if (b.pending.table && b.pending.row && b.pending.row.length > 0) {
        if (b.pending.table.rows.length < opts.maxTableRows) {
          b.pending.table.rows.push(b.pending.row);
        } else {
          b.result.truncation.tables = true;
        }
      }
      b.pending.row = null;
    }
  );

  reg(
    'th',
    () => {
      ctx.cell = true;
      b.pending.cellKind = 'th';
      b.buffer.cell = '';
    },
    () => {
      ctx.cell = false;
      if (b.pending.row !== null) {
        const value = b.buffer.cell.trim();
        if (b.pending.cellKind === 'th' && b.pending.table && b.pending.table.rows.length === 0) {
          b.pending.table.headers.push(value);
        }
        b.pending.row.push(value);
      }
      b.pending.cellKind = null;
      b.buffer.cell = '';
    }
  );

  reg(
    'td',
    () => {
      ctx.cell = true;
      b.pending.cellKind = 'td';
      b.buffer.cell = '';
    },
    () => {
      ctx.cell = false;
      if (b.pending.row !== null) b.pending.row.push(b.buffer.cell.trim());
      b.pending.cellKind = null;
      b.buffer.cell = '';
    }
  );

  reg(
    'a[href]',
    (el) => {
      if (b.counts.link >= opts.maxLinks) {
        b.result.truncation.links = true;
        b.pending.linkHref = null;
        return;
      }
      ctx.link = true;
      b.pending.linkHref = el.getAttribute('href') || '';
      b.buffer.link = '';
    },
    () => {
      ctx.link = false;
      if (b.pending.linkHref !== null) {
        b.counts.link++;
        b.result.links.push({
          href: b.pending.linkHref,
          text: b.buffer.link.trim(),
          selector: `body a:nth-of-type(${b.counts.link})`,
        });
      }
      b.pending.linkHref = null;
      b.buffer.link = '';
    }
  );

  // Single universal text handler. HTMLRewriter interleaves element start/end
  // and text; attribution to the currently-open buffer is driven by the
  // booleans above (one registration per selector owns its open/close). This
  // is a streaming flat attribution — a documented parity limitation vs a tree
  // DOM (nested overlapping elements may cross-attribute; see PARSER_PARITY.md).
  rewriter.on('*', {
    text(t: TextLike) {
      const text = t.text;
      if (ctx.jsonLd) {
        b.buffer.jsonLd += text;
        return;
      }
      if (ctx.script || ctx.style) return;
      if (ctx.title) {
        b.buffer.title += text;
        return;
      }
      if (ctx.link) b.buffer.link += text;
      if (ctx.item) b.buffer.item += text;
      if (ctx.cell) b.buffer.cell += text;
      if (ctx.heading) b.buffer.heading += text;
      if (ctx.paragraph) b.buffer.paragraph += text;
      appendVisible(b, text);
    },
  });

  rewriter.onComments?.(() => {
    /* comments consumed, not surfaced */
  });
}

function finalizeJsonLd(b: Builder): void {
  const json = b.buffer.jsonLd.trim();
  if (json && b.options.keepStructuredData) {
    try {
      const data = JSON.parse(json) as unknown;
      if (data && typeof data === 'object') {
        b.result.structuredData.push({
          type: 'json-ld',
          data: data as Record<string, unknown>,
          selector: 'script[type="application/ld+json"]',
        });
      }
    } catch {
      // malformed JSON-LD omitted deterministically
    }
  }
  b.buffer.jsonLd = '';
}

function appendVisible(b: Builder, text: string): void {
  const opts = b.options;
  if (opts.maxTextLength && b.visibleLength >= opts.maxTextLength) {
    b.result.truncation.text = true;
    return;
  }
  b.visible.push(text);
  b.visibleLength += text.length;
  if (opts.maxTextLength && b.visibleLength > opts.maxTextLength) {
    const overflow = b.visibleLength - opts.maxTextLength;
    const last = b.visible[b.visible.length - 1];
    b.visible[b.visible.length - 1] = last.slice(0, last.length - overflow);
    b.visibleLength = opts.maxTextLength;
    b.result.truncation.text = true;
  }
}

function finalize(b: Builder): void {
  b.result.visibleText = b.visible.join('').replace(/\s+/g, ' ').trim();
  b.result.nodeCount = b.nodeCount;
  b.result.promptInjectionSignals = runInjectionTextScan(b.result.visibleText);
}

function parseHtmlWithJsdom(
  html: string,
  _sourceUrl: string,
  options?: HtmlNormalizationOptions
): NormalizedHtmlResult {
  const b = makeBuilder(options);
  const opts = b.options;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JSDOM } = require('jsdom') as { JSDOM: typeof JSDOMCtor };
  const dom = new JSDOM(html, { contentType: 'text/html' });
  const doc = dom.window.document;
  const r = b.result;

  r.title = doc.querySelector('title')?.textContent?.trim() || null;
  r.canonicalLink = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;
  r.language = doc.documentElement.lang || null;
  r.metaDescription =
    doc.querySelector('meta[name="description"]')?.getAttribute('content') || null;

  r.headings = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'))
    .slice(0, opts.maxNodes)
    .map((el, i) => ({
      level: parseInt(el.tagName[1], 10),
      text: el.textContent?.trim() || '',
      selector: `body ${el.tagName.toLowerCase()}:nth-of-type(${i + 1})`,
    }));
  r.paragraphs = Array.from(doc.querySelectorAll('p'))
    .slice(0, opts.maxNodes)
    .map((el, i) => ({
      text: el.textContent?.trim() || '',
      selector: `body p:nth-of-type(${i + 1})`,
    }));
  r.links = Array.from(doc.querySelectorAll('a[href]'))
    .slice(0, opts.maxLinks)
    .map((a, i) => ({
      href: a.getAttribute('href') || '',
      text: a.textContent?.trim() || '',
      selector: `body a:nth-of-type(${i + 1})`,
    }));
  for (const table of Array.from(doc.querySelectorAll('table')).slice(0, opts.maxTableRows)) {
    const headers = Array.from(table.querySelectorAll('th')).map(
      (th) => th.textContent?.trim() || ''
    );
    const rows = Array.from(table.querySelectorAll('tr'))
      .map((tr) =>
        Array.from(tr.querySelectorAll('td,th'))
          .map((c) => c.textContent?.trim() || '')
          .slice(0, opts.maxTableCols)
      )
      .slice(0, opts.maxTableRows);
    r.tables.push({ headers, rows, selector: 'table' });
  }
  for (const list of Array.from(doc.querySelectorAll('ul,ol'))) {
    const type = list.tagName.toLowerCase() as 'ul' | 'ol';
    const items = Array.from(list.querySelectorAll(':scope > li')).map((li) => ({
      text: li.textContent?.trim() || '',
      selector: 'li',
    }));
    r.lists.push({ type, items, selector: list.tagName.toLowerCase() });
  }
  if (opts.keepStructuredData) {
    for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const data = JSON.parse(script.textContent || '{}') as Record<string, unknown>;
        if (data && typeof data === 'object')
          r.structuredData.push({
            type: 'json-ld',
            data,
            selector: 'script[type="application/ld+json"]',
          });
      } catch {
        /* malformed omitted */
      }
    }
  }
  r.visibleText = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  r.nodeCount = doc.querySelectorAll('*').length;
  r.promptInjectionSignals = runInjectionTextScan(r.visibleText);
  return r;
}

interface HTMLRewriterLike {
  on(selector: string, handlers: Record<string, unknown>): this;
  transform(response: Response): Response;
  onComments?(cb: (c: CommentLike) => void): this;
}
interface ElementLike {
  tagName: string;
  getAttribute(name: string): string | null;
  onEndTag?(handler: () => void): void;
}
interface TextLike {
  text: string;
  readonly lastInTextNode?: boolean;
}
interface CommentLike {
  text: string;
}

declare const HTMLRewriter: HTMLRewriterLike | undefined;
