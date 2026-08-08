import type { ShapeSchema } from './types';
import { createHash } from 'node:crypto';

export function computeShapeHash(schema: ShapeSchema): string {
  const canonical = canonicalShapeJson(schema);
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalShapeJson(schema: ShapeSchema): string {
  const ordered = orderShape(schema);
  return JSON.stringify(ordered, Object.keys(ordered).sort());
}

function orderShape(schema: ShapeSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type };
  if (schema.properties) {
    const props: Record<string, Record<string, unknown>> = {};
    for (const key of Object.keys(schema.properties).sort()) {
      props[key] = orderShape(schema.properties[key]);
    }
    out.properties = props;
  }
  if (schema.required) out.required = [...schema.required].sort();
  if (schema.optional) out.optional = [...schema.optional].sort();
  if (schema.enum) out.enum = [...schema.enum].sort((a, b) => String(a).localeCompare(String(b)));
  if (schema.maxDepth !== undefined) out.maxDepth = schema.maxDepth;
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
  if (schema.format) out.format = schema.format;
  if (schema.parentKey) out.parentKey = schema.parentKey;
  if (schema.type === 'array' && schema.items) out.items = orderShape(schema.items);
  return out;
}

export interface InferredSchema {
  schema: ShapeSchema;
  depth: number;
  itemShape?: InferredSchema;
}

export function inferSchema(data: unknown, maxDepth = 16): InferredSchema {
  return infer(data, 0, maxDepth);
}

function infer(data: unknown, depth: number, maxDepth: number): InferredSchema {
  if (data === null) return { schema: { type: 'null' }, depth };
  if (Array.isArray(data)) {
    const sample = data.length > 0 ? data[0] : undefined;
    const child = sample !== undefined ? infer(sample, depth + 1, maxDepth) : undefined;
    const schema: ShapeSchema = {
      type: 'array',
      maxItems: data.length,
    };
    if (child) {
      schema.items = child.schema;
      return { schema, depth, itemShape: child };
    }
    schema.items = { type: 'unknown' };
    return { schema, depth };
  }
  if (typeof data === 'object') {
    if (depth >= maxDepth) {
      return { schema: { type: 'object', maxDepth }, depth };
    }
    const props: Record<string, ShapeSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const child = infer(value, depth + 1, maxDepth);
      props[key] = markFormat(child.schema, key, value);
      required.push(key);
    }
    return { schema: { type: 'object', properties: props, required }, depth };
  }
  if (typeof data === 'string') return { schema: inferStringShape(data), depth };
  if (typeof data === 'number') return { schema: { type: 'number' }, depth };
  if (typeof data === 'boolean') return { schema: { type: 'boolean' }, depth };
  return { schema: { type: 'unknown' }, depth };
}

function markFormat(schema: ShapeSchema, key: string, value: unknown): ShapeSchema {
  if (typeof value === 'string') {
    if (looksLikeIsoTimestamp(value)) return { ...schema, format: 'timestamp' };
    if (looksLikeIdentifier(key, value)) return { ...schema, format: 'identifier' };
  }
  if (key.toLowerCase().includes('cursor') || key.toLowerCase().includes('next_cursor')) {
    return { ...schema, format: 'pagination-cursor' };
  }
  return schema;
}

function inferStringShape(value: string): ShapeSchema {
  if (looksLikeIsoTimestamp(value)) return { type: 'string', format: 'timestamp' };
  return { type: 'string' };
}

export const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}([Tt]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function looksLikeIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_RE.test(value);
}

const IDENTIFIER_KEY_PATTERNS = [
  /^cik$/,
  /^.*_cik$/i,
  /^accession(number)?$/i,
  /^doi$/i,
  /^openalex_?id$/i,
  /^w\d+$/i,
  /^a\d+$/i,
  /^github_?id$/i,
  /^id$/i,
  /^document_?number$/i,
  /^agency_?id$/i,
];

export function looksLikeIdentifier(key: string, value: string): boolean {
  if (value.length === 0 || value.length > 128) return false;
  if (/[\s/]/.test(value)) return false;
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) return false;
  return IDENTIFIER_KEY_PATTERNS.some((re) => re.test(key));
}

export function shapeValueFingerprint(data: unknown): string {
  return JSON.stringify(strippedCopy(data));
}

function strippedCopy(data: unknown): unknown {
  if (Array.isArray(data)) return data.slice(0, 16).map(strippedCopy);
  if (data === null) return null;
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(data as Record<string, unknown>).sort()) {
      out[key] = strippedCopy((data as Record<string, unknown>)[key]);
    }
    return out;
  }
  return data;
}
