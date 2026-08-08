import type { SecEntity, SecSubmission } from './submissions';
import type { NormalizedFact } from './company-facts';
import type { SourceObservation, EvidenceLocator } from '../types';
import { createSourceObservation, createProvenanceStep } from '../evidence/source-observation';
import { createLocator } from '../evidence/locators';

export const SEC_ADAPTER_VERSION = '0.1.0';

export interface SecSubmissionsAdapterInput {
  cik: string;
  expectedName?: string;
  expectedTicker?: string;
  freshnessMs?: number;
  maxFilings?: number;
  forms?: string[];
  includeFilingMetadata?: boolean;
}

export interface SecSubmissionsAdapterResult {
  entity: SecEntity;
  filings: SecSubmission[];
  warnings: string[];
  limitations: string[];
}

export function createSecSubmissionsObservation(
  entity: SecEntity,
  filings: SecSubmission[],
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
    createLocator('json_pointer', '/cik', sourceUrl),
    createLocator('json_pointer', '/entityName', sourceUrl),
    createLocator('json_pointer', '/tickers', sourceUrl),
    createLocator('json_pointer', '/exchanges', sourceUrl),
    createLocator('json_pointer', '/filings/recent', sourceUrl),
  ];

  for (let i = 0; i < filings.length; i++) {
    locators.push(
      createLocator('json_pointer', `/filings/recent/accessionNumber/${i}`, sourceUrl),
      createLocator('json_pointer', `/filings/recent/filingDate/${i}`, sourceUrl),
      createLocator('json_pointer', `/filings/recent/form/${i}`, sourceUrl)
    );
    if (filings[i].primaryDocument) {
      locators.push(
        createLocator('json_pointer', `/filings/recent/primaryDocument/${i}`, sourceUrl)
      );
    }
  }

  const transformationHistory = [
    createProvenanceStep('fetch_sec_submissions', adapterVersion),
    createProvenanceStep('normalize_entity', adapterVersion),
    createProvenanceStep('normalize_filings', adapterVersion),
    createProvenanceStep('filter_filings', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'sec-edgar',
    capability: 'company_submissions',
    sourceUri: sourceUrl,
    sourceType: 'authoritative',
    retrievedAt: new Date(),
    contentHash,
    mediaType: 'application/json',
    normalizedValue: { entity, filings },
    evidenceLocators: locators,
    adapterVersion,
    policyVersion,
    cacheStatus,
    freshnessStatus,
    authorizationClassification: 'public',
    limitations,
    warnings,
    transformationHistory,
  });
}

export interface SecCompanyFactsAdapterInput {
  cik: string;
  taxonomies?: string[];
  concepts?: string[];
  forms?: string[];
  startDate?: string;
  endDate?: string;
  maxFacts?: number;
  freshnessMs?: number;
}

export interface SecCompanyFactsAdapterResult {
  facts: NormalizedFact[];
  warnings: string[];
  limitations: string[];
}

export function createSecCompanyFactsObservation(
  facts: NormalizedFact[],
  sourceUrl: string,
  contentHash: string,
  adapterVersion: string,
  policyVersion: string,
  cacheStatus: 'hit' | 'miss' | 'stale' | 'bypassed',
  freshnessStatus: 'fresh' | 'stale' | 'unknown',
  warnings: string[],
  limitations: string[]
): SourceObservation {
  const locators: EvidenceLocator[] = [createLocator('json_pointer', '/facts', sourceUrl)];

  const conceptGroups = new Map<string, number>();
  for (const fact of facts) {
    const key = `${fact.taxonomy}|${fact.concept}`;
    conceptGroups.set(key, (conceptGroups.get(key) || 0) + 1);
  }

  for (const [concept, count] of conceptGroups.entries()) {
    if (count <= 5) {
      locators.push(
        createLocator('json_pointer', `/facts/${concept.replace('|', '/')}`, sourceUrl)
      );
    }
  }

  const transformationHistory = [
    createProvenanceStep('fetch_sec_company_facts', adapterVersion),
    createProvenanceStep('normalize_facts', adapterVersion),
    createProvenanceStep('filter_facts', adapterVersion),
    createProvenanceStep('detect_amended', adapterVersion),
  ];

  return createSourceObservation({
    providerId: 'sec-edgar',
    capability: 'company_facts',
    sourceUri: sourceUrl,
    sourceType: 'authoritative',
    retrievedAt: new Date(),
    contentHash,
    mediaType: 'application/json',
    normalizedValue: { facts, conceptCounts: Object.fromEntries(conceptGroups) },
    evidenceLocators: locators,
    adapterVersion,
    policyVersion,
    cacheStatus,
    freshnessStatus,
    authorizationClassification: 'public',
    limitations,
    warnings,
    transformationHistory,
  });
}

export function validateEntityMatch(
  entity: SecEntity,
  expectedName?: string,
  expectedTicker?: string
): { matched: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (expectedName) {
    const entityNameKey = entity.entityName.toLowerCase().trim();
    const expectedNameKey = expectedName.toLowerCase().trim();
    if (entityNameKey !== expectedNameKey) {
      warnings.push(`Entity name mismatch: expected "${expectedName}", got "${entity.entityName}"`);
    }
  }

  if (expectedTicker) {
    const entityTickers = (entity.tickers || []).map((t) => t.toUpperCase());
    const expectedTickerUpper = expectedTicker.toUpperCase();
    if (!entityTickers.includes(expectedTickerUpper)) {
      warnings.push(
        `Ticker mismatch: expected "${expectedTicker}", entity has ${entityTickers.join(', ') || 'none'}`
      );
    }
  }

  return { matched: warnings.length === 0, warnings };
}
