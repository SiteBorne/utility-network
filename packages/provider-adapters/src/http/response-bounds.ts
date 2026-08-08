export interface ResponseBounds {
  maxBodyBytes: number;
  maxDecompressedBytes: number;
  maxJsonDepth: number;
  maxJsonKeys: number;
  maxHtmlNodes: number;
  maxHtmlDepth: number;
}

export const DEFAULT_RESPONSE_BOUNDS: ResponseBounds = {
  maxBodyBytes: 10 * 1024 * 1024,
  maxDecompressedBytes: 50 * 1024 * 1024,
  maxJsonDepth: 100,
  maxJsonKeys: 10000,
  maxHtmlNodes: 50000,
  maxHtmlDepth: 100,
};

export function checkBodySize(bytes: number, limit: number): void {
  if (bytes > limit) {
    throw new Error(`Body size ${bytes} exceeds limit ${limit}`);
  }
}

export function checkDecompressedSize(bytes: number, limit: number): void {
  if (bytes > limit) {
    throw new Error(`Decompressed size ${bytes} exceeds limit ${limit}`);
  }
}

export function checkJsonDepth(obj: unknown, maxDepth: number, currentDepth = 0): void {
  if (currentDepth > maxDepth) {
    throw new Error(`JSON depth ${currentDepth} exceeds maximum ${maxDepth}`);
  }
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        checkJsonDepth(item, maxDepth, currentDepth + 1);
      }
    } else {
      for (const value of Object.values(obj)) {
        checkJsonDepth(value, maxDepth, currentDepth + 1);
      }
    }
  }
}

export function checkJsonKeys(obj: unknown, maxKeys: number): number {
  let count = 0;
  function countKeys(o: unknown): void {
    if (o && typeof o === 'object') {
      if (Array.isArray(o)) {
        for (const item of o) countKeys(item);
      } else {
        count += Object.keys(o).length;
        for (const value of Object.values(o)) countKeys(value);
      }
    }
  }
  countKeys(obj);
  if (count > maxKeys) {
    throw new Error(`JSON key count ${count} exceeds maximum ${maxKeys}`);
  }
  return count;
}

export function checkHtmlNodes(nodeCount: number, maxNodes: number): void {
  if (nodeCount > maxNodes) {
    throw new Error(`HTML node count ${nodeCount} exceeds maximum ${maxNodes}`);
  }
}

export function checkHtmlDepth(depth: number, maxDepth: number): void {
  if (depth > maxDepth) {
    throw new Error(`HTML depth ${depth} exceeds maximum ${maxDepth}`);
  }
}

export function createBoundedJsonParse(maxDepth: number, maxKeys: number) {
  return (text: string) => {
    const parsed = JSON.parse(text);
    checkJsonDepth(parsed, maxDepth);
    checkJsonKeys(parsed, maxKeys);
    return parsed;
  };
}

export function createBoundedTextDecoder(maxBytes: number) {
  return (bytes: Uint8Array) => {
    checkBodySize(bytes.length, maxBytes);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  };
}
