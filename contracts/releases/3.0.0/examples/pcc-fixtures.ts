import * as fs from 'fs';
import * as path from 'path';

const now = '2026-08-05T10:00:00Z';
const tomorrow = '2026-08-06T10:00:00Z';

function makeHash(seed: string): string {
  const hexChars = '0123456789abcdef';
  const char = hexChars[parseInt(seed, 36) % 16] || '0';
  return `sha256:${char.repeat(64)}`;
}

function baseDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc = {
    pcc_version: '2.0.0',
    job_id: 'job_aaaaaaaaaaaaaaaaaaaaaaaa',
    contract: {
      service_id: 'company_evidence_graph.v1',
      service_version: 'v1.0.0',
      input_hash: makeHash('a'),
      input_schema_hash: makeHash('b'),
      output_schema_hash: makeHash('c'),
      quote_id: 'qte_aaaaaaaaaaaaaaaaaaaaaaaa',
      mode: 'paid',
      price: '0.039',
      currency: 'USD',
      network: 'base',
      minimum_quality: 0.8,
      freshness_seconds: 3600,
      issued_at: now,
      expires_at: tomorrow,
      idempotency_key: 'idk_aaaaaaaaaaaaaaaaaaaaaaaa',
    },
    subject: {
      type: 'organization',
      canonical_name: 'Acme Example Corp',
      identifiers: { domain: 'acme.example' },
    },
    claims: [
      {
        claim_id: 'clm_aaaaaaaaaaaaaaaaaaaaaaaa',
        predicate: 'has_name',
        value: 'Acme Example Corp',
        confidence: 0.95,
        evidence_ids: ['evd_aaaaaaaaaaaaaaaaaaaaaaaa'],
        materiality: 'material',
        verification_status: 'verified',
      },
    ],
    evidence: [
      {
        evidence_id: 'evd_aaaaaaaaaaaaaaaaaaaaaaaa',
        source_uri: 'https://acme.example/about',
        retrieved_at: now,
        content_hash: makeHash('d'),
        media_type: 'text/html',
        locator: { type: 'text_quote', value: 'Acme Example Corp' },
        accessibility_status: 'accessible',
        transformation_history: [],
        authorization_classification: 'public',
        freshness_status: 'fresh',
      },
    ],
    completeness: {
      requested_fields: 5,
      populated_fields: 4,
      supported_fields: 4,
      score: 0.8,
      missing_fields: ['ceo_name'],
      unsupported_fields: [],
      stale_fields: [],
      vector: [{ dimension: 'general', requested: 5, populated: 4, supported: 4, score: 0.8 }],
    },
    provenance: {
      routes: [{ type: 'direct', provider: 'web', version: '1.0.0' }],
      providers: [{ name: 'web', version: '1.0.0', capabilities: ['fetch'] }],
      tools: { curl: '8.0.0' },
      models: [],
      software_versions: { pcc: '1.0.0' },
      policy_versions: { verification: '1.0.0' },
      transformations: [],
      cache_provenance: { enabled: false, hit: false },
      execution_environment: { runtime: 'node', version: '22.0.0', platform: 'linux' },
      verification_routes: [],
    },
    verification: {
      schema_valid: true,
      material_claims_supported: true,
      evidence_accessibility: 1.0,
      freshness: 1.0,
      completeness: 0.8,
      cross_source_agreement: 1.0,
      provenance_valid: true,
      prompt_injection_result: { checked: true, result: 'clean' },
      deterministic_failures: [],
      verifier_versions: { pcc: '1.0.0' },
      policy: 'pol_aaaaaaaaaaaaaaaaaaaaaaaa',
      decision: 'pass',
      score: 0.9,
      failed_requirements: [],
    },
    receipt: {
      output_hash: makeHash('e'),
      canonicalization_algorithm: 'RFC8785-JCS',
      policy_hash: makeHash('f'),
      schema_hash: makeHash('g'),
      signature_algorithm: 'Ed25519',
      signing_key_id: 'kid_aaaaaaaaaaaaaaaaaaaaaaaa',
      signature: 'A'.repeat(86),
      signed_at: now,
    },
  };
  return { ...doc, ...overrides };
}

// 1. Complete company evidence result
export const fixture01CompleteCompanyEvidence = baseDoc({
  job_id: 'job_fixture01companyevidence',
  subject: {
    type: 'organization',
    canonical_name: 'Fictional Industries Ltd',
    identifiers: { domain: 'fictional.example', crn: 'FI12345678' },
  },
  claims: [
    {
      claim_id: 'clm_fixture01claim000000000',
      predicate: 'legal_name',
      value: 'Fictional Industries Ltd',
      confidence: 0.98,
      evidence_ids: ['evd_fixture01evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
    {
      claim_id: 'clm_fixture01claim000000001',
      predicate: 'incorporation_year',
      value: 2015,
      confidence: 0.95,
      evidence_ids: ['evd_fixture01evidence000001'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture01evidence000000',
      source_uri: 'https://fictional.example/about',
      source_timestamp: '2026-01-15T09:00:00Z',
      retrieved_at: now,
      content_hash: makeHash('h'),
      media_type: 'text/html',
      locator: { type: 'text_quote', value: 'Fictional Industries Ltd' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
    {
      evidence_id: 'evd_fixture01evidence000001',
      source_uri: 'https://registry.example/crn/FI12345678',
      retrieved_at: now,
      content_hash: makeHash('i'),
      media_type: 'application/json',
      locator: { type: 'json_pointer', value: '/incorporation/year' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 8,
    populated_fields: 8,
    supported_fields: 8,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [
      { dimension: 'identity', requested: 3, populated: 3, supported: 3, score: 1.0 },
      { dimension: 'financial', requested: 3, populated: 3, supported: 3, score: 1.0 },
      { dimension: 'contact', requested: 2, populated: 2, supported: 2, score: 1.0 },
    ],
  },
  verification: { ...(baseDoc().verification as any), decision: 'pass', score: 1.0 },
});

// 2. Partial company result with completeness vector
export const fixture02PartialCompany = baseDoc({
  job_id: 'job_fixture02partialcompany',
  subject: {
    type: 'organization',
    canonical_name: 'Partial Corp',
    identifiers: { domain: 'partial.example' },
  },
  claims: [
    {
      claim_id: 'clm_fixture02claim000000000',
      predicate: 'legal_name',
      value: 'Partial Corp',
      confidence: 0.9,
      evidence_ids: ['evd_fixture02evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture02evidence000000',
      source_uri: 'https://partial.example/',
      retrieved_at: now,
      content_hash: makeHash('j'),
      media_type: 'text/html',
      locator: { type: 'text_quote', value: 'Partial Corp' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 8,
    populated_fields: 4,
    supported_fields: 4,
    score: 0.5,
    missing_fields: ['ceo_name', 'revenue', 'employee_count', 'headquarters'],
    unsupported_fields: [],
    stale_fields: [],
    vector: [
      { dimension: 'identity', requested: 3, populated: 3, supported: 3, score: 1.0 },
      { dimension: 'financial', requested: 3, populated: 0, supported: 0, score: 0.0 },
      { dimension: 'contact', requested: 2, populated: 1, supported: 1, score: 0.5 },
    ],
  },
  verification: { ...(baseDoc().verification as any), decision: 'conditional', score: 0.5 },
});

// 3. Verified absence result
export const fixture03VerifiedAbsence = baseDoc({
  job_id: 'job_fixture03verifiedabsence',
  subject: {
    type: 'organization',
    canonical_name: 'NonExistent Entity',
    identifiers: { domain: 'nonexistent.example' },
  },
  claims: [
    {
      claim_id: 'clm_fixture03claim000000000',
      predicate: 'exists_in_registry',
      value: false,
      confidence: 0.99,
      evidence_ids: ['evd_fixture03evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture03evidence000000',
      source_uri: 'https://registry.example/search?q=nonexistent',
      retrieved_at: now,
      content_hash: makeHash('k'),
      media_type: 'application/json',
      locator: { type: 'json_pointer', value: '/results' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 1,
    populated_fields: 1,
    supported_fields: 1,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'existence', requested: 1, populated: 1, supported: 1, score: 1.0 }],
  },
  verification: { ...(baseDoc().verification as any), decision: 'pass', score: 0.99 },
});

// 4. Direct web extraction result
export const fixture04DirectWebExtraction = baseDoc({
  job_id: 'job_fixture04webextraction',
  contract: {
    ...(baseDoc().contract as any),
    service_id: 'web_context_verified.v1',
    price: '0.009',
  },
  subject: {
    type: 'webpage',
    canonical_name: 'https://blog.example/article-1',
    identifiers: { url: 'https://blog.example/article-1' },
  },
  claims: [
    {
      claim_id: 'clm_fixture04claim000000000',
      predicate: 'title',
      value: 'Example Article Title',
      confidence: 0.97,
      evidence_ids: ['evd_fixture04evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture04evidence000000',
      source_uri: 'https://blog.example/article-1',
      retrieved_at: now,
      content_hash: makeHash('l'),
      media_type: 'text/html',
      locator: { type: 'css_selector', value: 'h1.article-title' },
      accessibility_status: 'accessible',
      transformation_history: [
        { type: 'html_to_text', timestamp: now, tool_version: 'html-parser-1.0.0' },
      ],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 3,
    populated_fields: 3,
    supported_fields: 3,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'content', requested: 3, populated: 3, supported: 3, score: 1.0 }],
  },
});

// 5. Rendered web extraction result
export const fixture05RenderedWebExtraction = baseDoc({
  job_id: 'job_fixture05renderedweb',
  contract: {
    ...(baseDoc().contract as any),
    service_id: 'web_context_verified.v1',
    price: '0.029',
  },
  subject: {
    type: 'webpage',
    canonical_name: 'https://app.example/dashboard',
    identifiers: { url: 'https://app.example/dashboard' },
  },
  claims: [
    {
      claim_id: 'clm_fixture05claim000000000',
      predicate: 'rendered_metric',
      value: 42,
      confidence: 0.92,
      evidence_ids: ['evd_fixture05evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture05evidence000000',
      source_uri: 'https://app.example/dashboard',
      retrieved_at: now,
      content_hash: makeHash('m'),
      media_type: 'image/png',
      locator: { type: 'page_region', value: 'x:100,y:200,w:300,h:400' },
      accessibility_status: 'accessible',
      transformation_history: [
        { type: 'browser_render', timestamp: now, tool_version: 'puppeteer-21.0.0' },
      ],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 2,
    populated_fields: 2,
    supported_fields: 2,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'rendered', requested: 2, populated: 2, supported: 2, score: 1.0 }],
  },
});

// 6. Native-text document result
export const fixture06NativeTextDocument = baseDoc({
  job_id: 'job_fixture06nativedoc',
  contract: {
    ...(baseDoc().contract as any),
    service_id: 'document_evidence_json.v1',
    price: '0.012',
  },
  subject: {
    type: 'document',
    canonical_name: 'Annual Report 2025.pdf',
    identifiers: { filename: 'annual-report-2025.pdf' },
  },
  claims: [
    {
      claim_id: 'clm_fixture06claim000000000',
      predicate: 'page_count',
      value: 24,
      confidence: 1.0,
      evidence_ids: ['evd_fixture06evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture06evidence000000',
      source_uri: 'file:///docs/annual-report-2025.pdf',
      retrieved_at: now,
      content_hash: makeHash('n'),
      media_type: 'application/pdf',
      locator: { type: 'byte_range', value: '0-1024' },
      accessibility_status: 'accessible',
      transformation_history: [
        { type: 'pdf_text_extract', timestamp: now, tool_version: 'pymupdf-1.24.0' },
      ],
      authorization_classification: 'buyer_authorized',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 4,
    populated_fields: 4,
    supported_fields: 4,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'document', requested: 4, populated: 4, supported: 4, score: 1.0 }],
  },
});

// 7. OCR document result
export const fixture07OcrDocument = baseDoc({
  job_id: 'job_fixture07ocrdoc',
  contract: {
    ...(baseDoc().contract as any),
    service_id: 'document_evidence_json.v1',
    price: '0.019',
  },
  subject: {
    type: 'document',
    canonical_name: 'Scanned Invoice 001.jpg',
    identifiers: { filename: 'scanned-invoice-001.jpg' },
  },
  claims: [
    {
      claim_id: 'clm_fixture07claim000000000',
      predicate: 'invoice_total',
      value: '1500.00',
      confidence: 0.88,
      evidence_ids: ['evd_fixture07evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture07evidence000000',
      source_uri: 'file:///docs/scanned-invoice-001.jpg',
      retrieved_at: now,
      content_hash: makeHash('o'),
      media_type: 'image/jpeg',
      locator: { type: 'page_region', value: 'x:50,y:600,w:400,h:100' },
      accessibility_status: 'accessible',
      transformation_history: [
        { type: 'ocr_tesseract', timestamp: now, tool_version: 'tesseract-5.3.0' },
      ],
      authorization_classification: 'buyer_authorized',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 3,
    populated_fields: 3,
    supported_fields: 3,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'invoice', requested: 3, populated: 3, supported: 3, score: 1.0 }],
  },
});

// 8. Standard agent-output verification
export const fixture08AgentOutputVerification = baseDoc({
  job_id: 'job_fixture08agentverify',
  contract: {
    ...(baseDoc().contract as any),
    service_id: 'verify_agent_output.v1',
    price: '0.019',
  },
  subject: {
    type: 'other',
    canonical_name: 'agent-output-batch-42',
    identifiers: { batch_id: 'batch-42' },
  },
  claims: [
    {
      claim_id: 'clm_fixture08claim000000000',
      predicate: 'output_schema_valid',
      value: true,
      confidence: 1.0,
      evidence_ids: ['evd_fixture08evidence000000'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture08evidence000000',
      source_uri: 'https://agent.example/output/batch-42',
      retrieved_at: now,
      content_hash: makeHash('p'),
      media_type: 'application/json',
      locator: { type: 'json_pointer', value: '' },
      accessibility_status: 'accessible',
      transformation_history: [
        { type: 'schema_validate', timestamp: now, tool_version: 'jsonschema-4.22.0' },
      ],
      authorization_classification: 'buyer_authorized',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 2,
    populated_fields: 2,
    supported_fields: 2,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'verification', requested: 2, populated: 2, supported: 2, score: 1.0 }],
  },
});

// 9. Independent reproduction result
export const fixture09IndependentReproduction = baseDoc({
  job_id: 'job_fixture09independent',
  contract: {
    ...(baseDoc().contract as any),
    service_id: 'verify_agent_output.v1',
    price: '0.049',
  },
  subject: {
    type: 'other',
    canonical_name: 'reproduction-target-7',
    identifiers: { target_id: 'target-7' },
  },
  claims: [
    {
      claim_id: 'clm_fixture09claim000000000',
      predicate: 'reproduced_result',
      value: true,
      confidence: 0.96,
      evidence_ids: ['evd_fixture09evidence000000', 'evd_fixture09evidence000001'],
      materiality: 'material',
      verification_status: 'verified',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture09evidence000000',
      source_uri: 'https://agent-a.example/run/target-7',
      retrieved_at: now,
      content_hash: makeHash('q'),
      media_type: 'application/json',
      locator: { type: 'json_pointer', value: '/result' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'buyer_authorized',
      freshness_status: 'fresh',
    },
    {
      evidence_id: 'evd_fixture09evidence000001',
      source_uri: 'https://agent-b.example/run/target-7',
      retrieved_at: now,
      content_hash: makeHash('q'),
      media_type: 'application/json',
      locator: { type: 'json_pointer', value: '/result' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'buyer_authorized',
      freshness_status: 'fresh',
    },
  ],
  completeness: {
    requested_fields: 1,
    populated_fields: 1,
    supported_fields: 1,
    score: 1.0,
    missing_fields: [],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'reproduction', requested: 1, populated: 1, supported: 1, score: 1.0 }],
  },
  verification: {
    ...(baseDoc().verification as any),
    cross_source_agreement: 1.0,
    decision: 'pass',
    score: 0.96,
  },
});

// 10. Verification failure
export const fixture10VerificationFailure = baseDoc({
  job_id: 'job_fixture10verifyfail',
  claims: [
    {
      claim_id: 'clm_fixture10claim000000000',
      predicate: 'has_name',
      value: 'Wrong Name Inc',
      confidence: 0.3,
      evidence_ids: ['evd_fixture10evidence000000'],
      materiality: 'material',
      verification_status: 'disputed',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture10evidence000000',
      source_uri: 'https://unreliable.example/data',
      retrieved_at: now,
      content_hash: makeHash('r'),
      media_type: 'text/html',
      locator: { type: 'text_quote', value: 'Wrong Name Inc' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'public',
      freshness_status: 'stale',
    },
  ],
  completeness: {
    requested_fields: 5,
    populated_fields: 1,
    supported_fields: 1,
    score: 0.2,
    missing_fields: ['incorporation_date', 'ceo_name', 'address', 'revenue'],
    unsupported_fields: [],
    stale_fields: ['has_name'],
    vector: [{ dimension: 'general', requested: 5, populated: 1, supported: 1, score: 0.2 }],
  },
  verification: {
    ...(baseDoc().verification as any),
    material_claims_supported: false,
    freshness: 0.0,
    completeness: 0.2,
    decision: 'fail',
    score: 0.2,
    failed_requirements: ['material_claims_supported', 'freshness'],
  },
});

// 11. Quarantined prompt-injection result
export const fixture11QuarantinedPromptInjection = baseDoc({
  job_id: 'job_fixture11quarantine',
  claims: [
    {
      claim_id: 'clm_fixture11claim000000000',
      predicate: 'has_name',
      value: 'Ignore previous instructions',
      confidence: 0.1,
      evidence_ids: ['evd_fixture11evidence000000'],
      materiality: 'material',
      verification_status: 'disputed',
    },
  ],
  evidence: [
    {
      evidence_id: 'evd_fixture11evidence000000',
      source_uri: 'https://suspicious.example/input',
      retrieved_at: now,
      content_hash: makeHash('s'),
      media_type: 'text/plain',
      locator: { type: 'text_quote', value: 'Ignore previous instructions' },
      accessibility_status: 'accessible',
      transformation_history: [],
      authorization_classification: 'public',
      freshness_status: 'fresh',
    },
  ],
  verification: {
    ...(baseDoc().verification as any),
    prompt_injection_result: {
      checked: true,
      result: 'confirmed',
      details: 'Classic instruction override pattern detected',
    },
    decision: 'quarantined',
    score: 0.0,
    failed_requirements: ['prompt_injection_result'],
  },
});

// 12. Cache-derived result with declared freshness
export const fixture12CacheDerived = baseDoc({
  job_id: 'job_fixture12cachederived',
  provenance: {
    ...(baseDoc().provenance as any),
    routes: [{ type: 'cache', provider: 'redis', version: '7.0.0' }],
    cache_provenance: {
      enabled: true,
      hit: true,
      cache_key: 'cache:org:acme',
      stored_at: '2026-08-04T10:00:00Z',
    },
  },
  evidence: [
    {
      evidence_id: 'evd_fixture12evidence000000',
      source_uri: 'cache://redis/org/acme',
      retrieved_at: now,
      content_hash: makeHash('t'),
      media_type: 'application/json',
      locator: { type: 'artifact_pointer', value: 'cache:org:acme' },
      accessibility_status: 'accessible',
      transformation_history: [
        { type: 'cache_retrieval', timestamp: now, tool_version: 'redis-7.0.0' },
      ],
      authorization_classification: 'public',
      freshness_status: 'stale',
    },
  ],
  verification: {
    ...(baseDoc().verification as any),
    freshness: 0.7,
    decision: 'conditional',
    score: 0.7,
  },
});

// 13. Free benchmark fixture with no live customer utility
export const fixture13FreeBenchmark = baseDoc({
  job_id: 'job_fixture13benchmark',
  contract: {
    ...(baseDoc().contract as any),
    mode: 'benchmark',
    price: undefined,
    network: undefined,
  },
  subject: {
    type: 'organization',
    canonical_name: 'Benchmark Test Entity',
    identifiers: {},
  },
  claims: [
    {
      claim_id: 'clm_fixture13claim000000000',
      predicate: 'benchmark_field',
      value: 'test_value',
      confidence: 0.5,
      evidence_ids: [],
      materiality: 'contextual',
      verification_status: 'unsupported',
    },
  ],
  evidence: [],
  completeness: {
    requested_fields: 1,
    populated_fields: 0,
    supported_fields: 0,
    score: 0.0,
    missing_fields: ['benchmark_field'],
    unsupported_fields: [],
    stale_fields: [],
    vector: [{ dimension: 'benchmark', requested: 1, populated: 0, supported: 0, score: 0.0 }],
  },
  verification: {
    ...(baseDoc().verification as any),
    material_claims_supported: true,
    decision: 'conditional',
    score: 0.0,
  },
});

// 14. Extension-container example
export const fixture14ExtensionContainer = baseDoc({
  job_id: 'job_fixture14extension',
  extensions: {
    'com.example.custom-metrics.v1': {
      custom_metric: 42,
      tags: ['alpha', 'beta'],
    },
  },
});

// Export all fixtures
export const ALL_FIXTURES = [
  fixture01CompleteCompanyEvidence,
  fixture02PartialCompany,
  fixture03VerifiedAbsence,
  fixture04DirectWebExtraction,
  fixture05RenderedWebExtraction,
  fixture06NativeTextDocument,
  fixture07OcrDocument,
  fixture08AgentOutputVerification,
  fixture09IndependentReproduction,
  fixture10VerificationFailure,
  fixture11QuarantinedPromptInjection,
  fixture12CacheDerived,
  fixture13FreeBenchmark,
  fixture14ExtensionContainer,
];

// Write fixtures to disk for external consumers
const fixturesDir = path.resolve(__dirname);
for (let i = 0; i < ALL_FIXTURES.length; i++) {
  const num = String(i + 1).padStart(2, '0');
  const filePath = path.join(fixturesDir, `fixture${num}.json`);
  fs.writeFileSync(filePath, JSON.stringify(ALL_FIXTURES[i], null, 2) + '\n', 'utf-8');
}
