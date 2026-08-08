export interface ExtractionOptions {
  selectors?: string[];
  attributes?: string[];
  maxResults?: number;
}

class DomUnavailableError extends Error {
  constructor() {
    super(
      'DOMParser is unavailable: the extraction helpers are Node/JSDOM-test utilities and must not be called from the Worker production path. Use the HTMLRewriter-backed normalizeHtml() path for production extraction.'
    );
    this.name = 'DomUnavailableError';
  }
}

function assertDom(): void {
  if (typeof DOMParser === 'undefined') {
    throw new DomUnavailableError();
  }
}

export function extractBySelector(html: string, selector: string): Element[] {
  assertDom();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll(selector));
}

export function extractTextBySelector(html: string, selector: string): string[] {
  return extractBySelector(html, selector)
    .map((el) => el.textContent?.trim() || '')
    .filter(Boolean);
}

export function extractAttributeBySelector(
  html: string,
  selector: string,
  attribute: string
): string[] {
  return extractBySelector(html, selector)
    .map((el) => el.getAttribute(attribute))
    .filter((v): v is string => v !== null);
}

export function extractStructuredData(
  html: string
): Array<{ type: string; data: Record<string, unknown> }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results: Array<{ type: string; data: Record<string, unknown> }> = [];

  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent || '{}');
      results.push({ type: 'json-ld', data });
    } catch {
      // ignore
    }
  }

  for (const el of Array.from(doc.querySelectorAll('[itemscope]'))) {
    const data = extractMicrodata(el);
    if (Object.keys(data).length > 0) {
      results.push({ type: 'microdata', data });
    }
  }

  return results;
}

function extractMicrodata(el: Element): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const prop of Array.from(el.querySelectorAll('[itemprop]'))) {
    const name = prop.getAttribute('itemprop');
    const value = prop.getAttribute('content') || prop.textContent?.trim() || '';
    if (name) data[name] = value;
  }
  return data;
}

export function extractTables(
  html: string,
  maxRows = 100,
  maxCols = 20
): Array<{ headers: string[]; rows: string[][] }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results: Array<{ headers: string[]; rows: string[][] }> = [];

  for (const table of Array.from(doc.querySelectorAll('table'))) {
    const headers: string[] = [];
    for (const th of Array.from(table.querySelectorAll('th'))) {
      headers.push(th.textContent?.trim() || '');
    }

    const rows: string[][] = [];
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const row: string[] = [];
      for (const cell of Array.from(tr.querySelectorAll('td, th'))) {
        row.push(cell.textContent?.trim() || '');
      }
      if (row.length > 0) rows.push(row);
    }

    if (rows.length > maxRows) rows.length = maxRows;
    for (const row of rows) {
      if (row.length > maxCols) row.length = maxCols;
    }

    if (headers.length > 0 || rows.length > 0) {
      results.push({ headers, rows });
    }
  }

  return results;
}

export function extractLinks(
  html: string,
  baseUrl?: string
): Array<{ href: string; text: string; title?: string }> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results: Array<{ href: string; text: string; title?: string }> = [];

  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') || '';
    const absoluteHref = baseUrl ? new URL(href, baseUrl).toString() : href;
    results.push({
      href: absoluteHref,
      text: a.textContent?.trim() || '',
      title: a.getAttribute('title') || undefined,
    });
  }

  return results;
}

export function extractMetaTags(html: string): Record<string, string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const results: Record<string, string> = {};

  for (const meta of Array.from(doc.querySelectorAll('meta'))) {
    const name =
      meta.getAttribute('name') || meta.getAttribute('property') || meta.getAttribute('http-equiv');
    const content = meta.getAttribute('content');
    if (name && content) {
      results[name] = content;
    }
  }

  return results;
}

export function extractOpenGraph(html: string): Record<string, string> {
  return extractMetaTags(html);
}

export function extractTwitterCard(html: string): Record<string, string> {
  return extractMetaTags(html);
}
