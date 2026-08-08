import type { EvidenceLocator } from '../types';

export function createLocator(
  type: EvidenceLocator['type'],
  value: string,
  sourceUri?: string
): EvidenceLocator {
  return { type, value, source_uri: sourceUri };
}

export function createJsonPointerLocator(pointer: string, sourceUri?: string): EvidenceLocator {
  return { type: 'json_pointer', value: pointer, source_uri: sourceUri };
}

export function createTextQuoteLocator(quote: string, sourceUri?: string): EvidenceLocator {
  return { type: 'text_quote', value: quote, source_uri: sourceUri };
}

export function createCssSelectorLocator(selector: string, sourceUri?: string): EvidenceLocator {
  return { type: 'css_selector', value: selector, source_uri: sourceUri };
}

export function createXPathLocator(xpath: string, sourceUri?: string): EvidenceLocator {
  return { type: 'xpath', value: xpath, source_uri: sourceUri };
}

export function createByteRangeLocator(
  start: number,
  end: number,
  sourceUri?: string
): EvidenceLocator {
  return { type: 'byte_range', value: `${start}-${end}`, source_uri: sourceUri };
}

export function createArtifactPointerLocator(
  artifactId: string,
  sourceUri?: string
): EvidenceLocator {
  return { type: 'artifact_pointer', value: artifactId, source_uri: sourceUri };
}

export function createDatabaseRecordLocator(recordId: string, sourceUri?: string): EvidenceLocator {
  return { type: 'database_record', value: recordId, source_uri: sourceUri };
}

export function createPageRegionLocator(region: string, sourceUri?: string): EvidenceLocator {
  return { type: 'page_region', value: region, source_uri: sourceUri };
}

export function resolveJsonPointer<T>(data: T, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return data;

  const parts = pointer.split('/').slice(1);
  let current: unknown = data;

  for (const part of parts) {
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const index = parseInt(decoded, 10);
      if (isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[decoded];
    } else {
      return undefined;
    }
  }

  return current;
}

export function buildJsonPointer(path: (string | number)[]): string {
  return '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

export function extractTextQuotes(text: string, maxQuotes = 5, maxLength = 200): string[] {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  return sentences.slice(0, maxQuotes).map((s) => s.trim().slice(0, maxLength));
}

export function findMatchingLocators(
  locators: EvidenceLocator[],
  type: EvidenceLocator['type']
): EvidenceLocator[] {
  return locators.filter((l) => l.type === type);
}

export function getFirstLocator(
  locators: EvidenceLocator[],
  type: EvidenceLocator['type']
): EvidenceLocator | undefined {
  return locators.find((l) => l.type === type);
}
