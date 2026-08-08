import type { SourceObservation, EvidenceLocator } from '../types';
import { createSourceObservation, createProvenanceStep } from '../evidence/source-observation';
import { createLocator } from '../evidence/locators';
import { createAutoHtmlParser, createWorkerHtmlParser } from './parser';

export interface HtmlNormalizationOptions {
  maxNodes?: number;
  maxDepth?: number;
  maxTextLength?: number;
  maxLinks?: number;
  maxTableRows?: number;
  maxTableCols?: number;
  removeScripts?: boolean;
  removeStyles?: boolean;
  removeComments?: boolean;
  removeHidden?: boolean;
  removeNavigation?: boolean;
  keepStructuredData?: boolean;
}

export const DEFAULT_HTML_NORMALIZATION_OPTIONS: HtmlNormalizationOptions = {
  maxNodes: 50000,
  maxDepth: 100,
  maxTextLength: 1000000,
  maxLinks: 5000,
  maxTableRows: 1000,
  maxTableCols: 50,
  removeScripts: true,
  removeStyles: true,
  removeComments: true,
  removeHidden: true,
  removeNavigation: true,
  keepStructuredData: true,
};

export interface NormalizedHtmlResult {
  title: string | null;
  canonicalLink: string | null;
  language: string | null;
  metaDescription: string | null;
  headings: Array<{ level: number; text: string; selector: string }>;
  paragraphs: Array<{ text: string; selector: string }>;
  lists: Array<{
    type: 'ul' | 'ol';
    items: Array<{ text: string; selector: string }>;
    selector: string;
  }>;
  tables: Array<{ headers: string[]; rows: string[][]; selector: string }>;
  links: Array<{ href: string; text: string; selector: string }>;
  visibleText: string;
  structuredData: Array<{ type: string; data: Record<string, unknown>; selector: string }>;
  promptInjectionSignals: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    excerpt: string;
    selector: string;
  }>;
  truncation: {
    nodes: boolean;
    depth: boolean;
    text: boolean;
    links: boolean;
    tables: boolean;
  };
  nodeCount: number;
  maxDepthReached: number;
}

export function normalizeHtml(
  html: string,
  sourceUrl: string,
  options: HtmlNormalizationOptions = DEFAULT_HTML_NORMALIZATION_OPTIONS
): NormalizedHtmlResult {
  // Production path: the Worker HTMLRewriter parser is the authoritative
  // implementation. createAutoHtmlParser() selects HTMLRewriter in the Worker
  // runtime and JSDOM only in the Node test runtime; the worker path throws
  // explicitly when HTMLRewriter is unavailable (no silent JSDOM fallback).
  const parser = createAutoHtmlParser();
  return parser.parse(html, sourceUrl, options);
}

export function normalizeHtmlWithWorkerParser(
  html: string,
  sourceUrl: string,
  options: HtmlNormalizationOptions = DEFAULT_HTML_NORMALIZATION_OPTIONS
): NormalizedHtmlResult {
  const parser = createWorkerHtmlParser();
  return parser.parse(html, sourceUrl, options);
}

export function createHtmlNormalizationObservation(
  result: NormalizedHtmlResult,
  sourceUrl: string,
  contentHash: string,
  adapterVersion: string,
  policyVersion: string,
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypassed',
  freshnessStatus: 'fresh' | 'stale' | 'unknown',
  warnings: string[],
  limitations: string[]
): SourceObservation {
  const locators: EvidenceLocator[] = [
    createLocator('css_selector', 'title', sourceUrl),
    createLocator('css_selector', 'meta[name="description"]', sourceUrl),
    createLocator('css_selector', 'h1, h2, h3, h4, h5, h6', sourceUrl),
    createLocator('css_selector', 'p', sourceUrl),
    createLocator('css_selector', 'a[href]', sourceUrl),
  ];

  for (const signal of result.promptInjectionSignals) {
    locators.push(createLocator('css_selector', signal.selector, sourceUrl));
  }

  const transformationHistory = [
    createProvenanceStep('parse_html', adapterVersion),
    createProvenanceStep('remove_scripts_styles', adapterVersion),
    createProvenanceStep('extract_visible_text', adapterVersion),
    createProvenanceStep('detect_prompt_injection', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'html-normalizer',
    capability: 'html_normalization',
    sourceUri: sourceUrl,
    sourceType: 'public_web',
    retrievedAt: new Date(),
    contentHash,
    mediaType: 'text/html',
    evidenceLocators: locators,
    normalizedValue: result,
    rawValueHash: contentHash,
    adapterVersion,
    policyVersion,
    cacheStatus,
    freshnessStatus,
    authorizationClassification: 'public',
    limitations: [
      ...limitations,
      ...(result.truncation.nodes ? ['node_limit'] : []),
      ...(result.truncation.text ? ['text_limit'] : []),
    ],
    warnings,
    transformationHistory,
  });
}
