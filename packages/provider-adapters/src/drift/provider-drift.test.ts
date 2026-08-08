import { describe, expect, it } from 'vitest';
import { detectDrift, inferSchema } from './index';
import type { ShapeSchema } from './types';

const SEC_SUBMISSIONS_SHAPE: ShapeSchema = {
  type: 'object',
  required: ['cik', 'entityName'],
  properties: {
    cik: { type: 'string', format: 'identifier' },
    entityName: { type: 'string' },
    sic: { type: 'string' },
    tickers: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    exchanges: { type: 'array', items: { type: 'string' } },
    filings: {
      type: 'object',
      properties: {
        recent: {
          type: 'object',
          properties: { accessionNumber: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  },
};

const SEC_COMPANY_FACTS_SHAPE: ShapeSchema = {
  type: 'object',
  required: ['cik', 'entityName'],
  properties: {
    cik: { type: 'string', format: 'identifier' },
    entityName: { type: 'string' },
    facts: { type: 'object', properties: { 'us-gaap': { type: 'object' } } },
  },
};

const OPENALEX_WORK_SHAPE: ShapeSchema = {
  type: 'object',
  required: ['id', 'doi', 'title'],
  properties: {
    id: { type: 'string', format: 'identifier' },
    doi: { type: 'string' },
    title: { type: 'string' },
    cited_by_count: { type: 'number' },
  },
};

const CROSSREF_ITEM_SHAPE: ShapeSchema = {
  type: 'object',
  required: ['DOI', 'title'],
  properties: {
    DOI: { type: 'string', format: 'identifier' },
    title: { type: 'array', items: { type: 'string' } },
    author: { type: 'array', items: { type: 'object' } },
  },
};

const GITHUB_REPO_SHAPE: ShapeSchema = {
  type: 'object',
  required: ['id', 'full_name'],
  properties: {
    id: { type: 'number', format: 'identifier' },
    full_name: { type: 'string' },
    stargazers_count: { type: 'number' },
  },
};

const FEDERAL_REGISTER_DOC_SHAPE: ShapeSchema = {
  type: 'object',
  required: ['document_number', 'title'],
  properties: {
    document_number: { type: 'string', format: 'identifier' },
    title: { type: 'string' },
    publication_date: { type: 'string', format: 'timestamp' },
    agencies: { type: 'array', items: { type: 'object' } },
  },
};

function expectChange(result: ReturnType<typeof detectDrift>, type: string): void {
  expect(result.changes.some((c) => c.type === type)).toBe(true);
}

function useRefSchema(expected: ShapeSchema) {
  return { expectedShapeHash: 'stable', expectedSchema: expected };
}

describe('provider-specific drift — SEC submissions', () => {
  it('flags removed required entityName as source_changed', () => {
    const observed = inferSchema({ ...BASE_SEC_SUB, entityName: undefined }).schema;
    const result = detectDrift({
      providerId: 'sec-edgar',
      capability: 'company_submissions',
      ...useRefSchema(SEC_SUBMISSIONS_SHAPE),
      observedData: { cik: '0000320193' },
    });
    expect(result.changes.some((c) => c.type === 'required_field_missing')).toBe(true);
    expect(result.classification).toBe('source_changed');
    expect(result.result_class).toBe('source_changed');
    void observed;
  });
  it('flags swapped cik identifier format', () => {
    const result = detectDrift({
      providerId: 'sec-edgar',
      capability: 'company_submissions',
      ...useRefSchema(SEC_SUBMISSIONS_SHAPE),
      observedData: { cik: 'https://example.com/CIK0000320193', entityName: 'Apple Inc.' },
    });
    expectChange(result, 'identifier_format_changed');
  });
  it('does not flag a safe optional addition when policy blocks continuation', () => {
    const observed = inferSchema({
      ...BASE_SEC_SUB,
      sicDescription: 'Prepackaged Software',
    }).schema;
    const result = detectDrift({
      providerId: 'sec-edgar',
      capability: 'company_submissions',
      ...useRefSchema(SEC_SUBMISSIONS_SHAPE),
      observedData: {
        cik: '0000320193',
        entityName: 'Apple Inc.',
        sicDescription: 'Prepackaged Software',
      },
      policy: { allowOptionalAdditions: false, requireAllFields: false },
    });
    expect(result.changes.some((c) => c.type === 'optional_field_added')).toBe(true);
    expect(result.classification).toBe('source_changed');
    void observed;
  });
});

describe('provider-specific drift — SEC company facts', () => {
  it('flags missing facts object as source_changed', () => {
    const observed = inferSchema({ cik: '0000320193', entityName: 'Apple Inc.' }).schema;
    const result = detectDrift({
      providerId: 'sec-edgar',
      capability: 'company_facts',
      ...useRefSchema(SEC_COMPANY_FACTS_SHAPE),
      observedData: { cik: '0000320193', entityName: 'Apple Inc.', facts: undefined },
    });
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.classification).toBe('source_changed');
    void observed;
  });
  it('flags wrapped payload under "data" as source_changed', () => {
    const observed = inferSchema({
      data: { cik: '0000320193', entityName: 'Apple Inc.', facts: { 'us-gaap': {} } },
    }).schema;
    const result = detectDrift({
      providerId: 'sec-edgar',
      capability: 'company_facts',
      ...useRefSchema(SEC_COMPANY_FACTS_SHAPE),
      observedData: {
        data: { cik: '0000320193', entityName: 'Apple Inc.', facts: { 'us-gaap': {} } },
      },
    });
    expectChange(result, 'unexpected_wrapper');
    expect(result.classification).toBe('source_changed');
    void observed;
  });
});

describe('provider-specific drift — OpenAlex', () => {
  it('flags missing required title', () => {
    const result = detectDrift({
      providerId: 'openalex',
      capability: 'openalex_work',
      ...useRefSchema(OPENALEX_WORK_SHAPE),
      observedData: { id: 'W2741809807', doi: '10.1/x' },
    });
    expect(result.changes.some((c) => c.type === 'required_field_missing')).toBe(true);
    expect(result.classification).toBe('source_changed');
  });
  it('flags cited_by_count type change to string', () => {
    const result = detectDrift({
      providerId: 'openalex',
      capability: 'openalex_work',
      ...useRefSchema(OPENALEX_WORK_SHAPE),
      observedData: { id: 'W2741809807', doi: '10.1/x', title: 't', cited_by_count: 'many' },
    });
    expectChange(result, 'field_type_changed');
  });
});

describe('provider-specific drift — Crossref', () => {
  it('flags missing required DOI', () => {
    const result = detectDrift({
      providerId: 'crossref',
      capability: 'crossref_doi',
      ...useRefSchema(CROSSREF_ITEM_SHAPE),
      observedData: { title: ['t'] },
    });
    expect(result.changes.some((c) => c.type === 'required_field_missing')).toBe(true);
    expect(result.classification).toBe('source_changed');
  });
  it('flags title type change from array to string', () => {
    const result = detectDrift({
      providerId: 'crossref',
      capability: 'crossref_doi',
      ...useRefSchema(CROSSREF_ITEM_SHAPE),
      observedData: { DOI: '10.1/x', title: 'A single string' },
    });
    expectChange(result, 'field_type_changed');
  });
});

describe('provider-specific drift — GitHub Public', () => {
  it('flags missing required full_name', () => {
    const result = detectDrift({
      providerId: 'github-public',
      capability: 'github_repository',
      ...useRefSchema(GITHUB_REPO_SHAPE),
      observedData: { id: 123 },
    });
    expect(result.changes.some((c) => c.type === 'required_field_missing')).toBe(true);
  });
  it('flags stargazers_count type change to string', () => {
    const result = detectDrift({
      providerId: 'github-public',
      capability: 'github_repository',
      ...useRefSchema(GITHUB_REPO_SHAPE),
      observedData: { id: 123, full_name: 'a/b', stargazers_count: 'lots' },
    });
    expectChange(result, 'field_type_changed');
  });
});

describe('provider-specific drift — Federal Register', () => {
  it('flags missing required document_number', () => {
    const result = detectDrift({
      providerId: 'federal-register',
      capability: 'federal_register_document',
      ...useRefSchema(FEDERAL_REGISTER_DOC_SHAPE),
      observedData: { title: 't' },
    });
    expect(result.changes.some((c) => c.type === 'required_field_missing')).toBe(true);
    expect(result.classification).toBe('source_changed');
  });
  it('flags publication_date timestamp format change', () => {
    const result = detectDrift({
      providerId: 'federal-register',
      capability: 'federal_register_document',
      ...useRefSchema(FEDERAL_REGISTER_DOC_SHAPE),
      observedData: {
        document_number: '2024-00001',
        title: 't',
        publication_date: '01/05/2024',
        agencies: [],
      },
    });
    expectChange(result, 'timestamp_format_changed');
  });
});

const BASE_SEC_SUB = {
  cik: '0000320193',
  entityName: 'Apple Inc.',
  sic: '7372',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  filings: { recent: { accessionNumber: ['0000320193-24-000005'] } },
};
