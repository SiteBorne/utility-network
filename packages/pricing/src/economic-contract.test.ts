import { describe, expect, it } from 'vitest';
import {
  ECONOMIC_SERVICE_IDS,
  buildAllEconomicOffers,
  buildEconomicOffer,
  canonicalEconomicProjectionJson,
  challengePricingKey,
  checkModeAvailability,
  compareEconomicProjections,
  governDeclaredLimitations,
  projectEconomicOffer,
  validateEconomicProjection,
  type EconomicOfferProjection,
  type EconomicServiceId,
  type PaymentDestination,
} from './economic-contract';
import {
  resolveMaxDocumentPages,
  resolvePricingSourceVersion,
  resolveServiceMaxPriceUsd,
} from './service-prices';
import { calculateDocumentUsage } from './document-usage';

const DESTINATION: PaymentDestination = {
  network: 'eip155:8453',
  asset: '0x000000000000000000000000000000000000dEaD',
  payTo: '0x1111111111111111111111111111111111111111',
};

function project(
  serviceId: EconomicServiceId,
  overrides: { productionEnabled?: boolean; destination?: PaymentDestination | null } = {}
): EconomicOfferProjection {
  return projectEconomicOffer(buildEconomicOffer(serviceId), {
    resource: `https://utility.siteborne.net/${serviceId.slice(serviceId.lastIndexOf('.') + 1)}/x`,
    productionEnabled: overrides.productionEnabled ?? false,
    destination: overrides.destination === undefined ? DESTINATION : overrides.destination,
  });
}

describe('canonical economic contract: governed derivation', () => {
  it('derives every amount from the governed pricing resolver, never a literal', () => {
    for (const offer of buildAllEconomicOffers()) {
      for (const mode of offer.modes) {
        expect(mode.amountUsd, `${offer.serviceId}/${mode.mode}`).toBe(
          resolveServiceMaxPriceUsd(mode.pricingKey)
        );
      }
      expect(offer.pricingSourceVersion).toBe(resolvePricingSourceVersion());
    }
  });

  it('covers exactly the eight canonical service ids', () => {
    expect(buildAllEconomicOffers().map((o) => o.serviceId)).toEqual([...ECONOMIC_SERVICE_IDS]);
  });

  it('pins the first-release v2 commercial truth (repricing requires deliberate review)', () => {
    const at = (id: EconomicServiceId) => project(id);
    expect(at('company_evidence_graph.v2').list_amount).toBe('0.0312');
    const web = at('web_context_verified.v2');
    expect(web.list_amount).toBe('0.008');
    expect(web.modes.find((m) => m.mode === 'rendered')?.amount).toBe('0.029');
    const verify = at('verify_agent_output.v2');
    expect(verify.list_amount).toBe('0.017');
    expect(verify.modes.find((m) => m.mode === 'independent_reproduction')?.amount).toBe('0.049');
    const doc = at('document_evidence_json.v2');
    expect(doc.tier_prices).toEqual([
      { tier: 'native', unit: 'page', amount: '0.0098' },
      { tier: 'ocr', unit: 'page', amount: '0.0156' },
      { tier: 'table', unit: 'page', amount: '0.0238' },
    ]);
    expect(doc.authorization_maximum).toBe('0.19');
  });
});

describe('exact / upto / tier semantics', () => {
  it('exact offers declare one fixed amount and settle at it', () => {
    const p = project('verify_agent_output.v2');
    expect(p.scheme).toBe('exact');
    expect(p.amount_kind).toBe('exact');
    expect(p.authorization_maximum).toBeNull();
    expect(p.actual_settlement_model).toBe('equals_exact_amount');
    expect(p.tier_prices).toBeNull();
  });

  it('document offers are upto: per-page tiers under a ceiling, measured settlement', () => {
    const p = project('document_evidence_json.v2');
    expect(p.scheme).toBe('upto');
    expect(p.amount_kind).toBe('authorized_maximum');
    expect(p.list_amount).toBeNull();
    expect(p.price_unit).toBe('page');
    expect(p.actual_settlement_model).toBe('measured_usage_not_exceeding_authorization');
    expect(p.measured_usage_semantics?.authorization_is_ceiling_not_charge).toBe(true);
    expect(p.limits).toEqual({ max_document_pages: resolveMaxDocumentPages() });
  });

  it('the declared tier semantics equal the real settlement calculator', () => {
    const p = project('document_evidence_json.v2');
    const semantics = p.measured_usage_semantics!;
    expect(semantics.tier_precedence).toEqual(['table', 'ocr', 'native']);
    const usage = calculateDocumentUsage([
      { page_number: 1, ocr_used: false, table_count: 0 },
      { page_number: 2, ocr_used: true, table_count: 0 },
      { page_number: 3, ocr_used: true, table_count: 2 },
    ]);
    expect(usage.page_costs.map((c) => c.tier)).toEqual(['native', 'ocr', 'table']);
    const price = (tier: string) => p.tier_prices!.find((t) => t.tier === tier)!.amount;
    expect(usage.page_costs.map((c) => c.price_usd_micro)).toEqual(
      ['native', 'ocr', 'table'].map((t) => Math.round(Number(price(t)) * 1e6))
    );
  });

  it('the document authorization ceiling bounds every tier and the whole page limit is not a price', () => {
    const p = project('document_evidence_json.v2');
    expect(validateEconomicProjection(p)).toEqual([]);
    const usage = calculateDocumentUsage(
      Array.from({ length: 50 }, (_, i) => ({ page_number: i + 1, ocr_used: true, table_count: 1 }))
    );
    expect(usage.capped).toBe(true);
    expect(usage.total_usd_micro).toBe(usage.max_job_usd_micro);
  });

  it('the x402 challenge key matches the offer default mode for every service', () => {
    for (const id of ECONOMIC_SERVICE_IDS) {
      const projection = project(id);
      const defaultMode = projection.modes.find((m) => m.mode === projection.default_mode)!;
      expect(defaultMode.amount).toBe(resolveServiceMaxPriceUsd(challengePricingKey(id)));
    }
  });
});

describe('PRICE_DEFINED is separate from CAPABILITY_AVAILABLE', () => {
  it('web rendered has a governed price but is unavailable and not advertised', () => {
    const p = project('web_context_verified.v2');
    const rendered = p.modes.find((m) => m.mode === 'rendered')!;
    expect(rendered.price_defined).toBe(true);
    expect(rendered.capability_available).toBe(false);
    expect(rendered.unavailable_reason).toBeTruthy();
    expect(p.available_modes).toEqual(['direct']);
    expect(p.default_mode).toBe('direct');
  });

  it('verify independent_reproduction has a governed price but is unavailable', () => {
    const p = project('verify_agent_output.v2');
    const reproduction = p.modes.find((m) => m.mode === 'independent_reproduction')!;
    expect(reproduction.price_defined).toBe(true);
    expect(reproduction.capability_available).toBe(false);
    expect(p.available_modes).toEqual(['standard']);
  });

  it('company and document are defined but not production-admitted', () => {
    expect(project('company_evidence_graph.v2').release_posture).toBe(
      'defined_not_production_admitted'
    );
    expect(project('document_evidence_json.v2').release_posture).toBe(
      'defined_not_production_admitted'
    );
    expect(project('web_context_verified.v2').release_posture).toBe('first_release_candidate');
    expect(project('verify_agent_output.v2').release_posture).toBe('first_release_candidate');
  });

  it('v1 ids are compatibility identities, never the current commercial identity', () => {
    for (const id of ECONOMIC_SERVICE_IDS.filter((x) => x.endsWith('.v1'))) {
      expect(project(id).contract_role).toBe('compatibility');
      expect(project(id).release_posture).toBe('compatibility_not_admitted');
    }
  });
});

describe('pre-payment mode gate', () => {
  it('rejects rendered web retrieval before any economic step', () => {
    const check = checkModeAvailability('web_context_verified.v2', {
      target_url: 'https://example.com/',
      retrieval_mode: 'rendered',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('retrieval_mode_unavailable');
      expect(check.message).toContain('No quote was created and nothing was charged');
      expect(check.message).toContain('Available: direct');
    }
  });

  it('rejects independent_reproduction before any economic step', () => {
    const check = checkModeAvailability('verify_agent_output.v2', {
      verification_mode: 'independent_reproduction',
    });
    expect(check).toMatchObject({ ok: false, code: 'verification_mode_unavailable' });
  });

  it('never substitutes: available modes and services without a selector pass', () => {
    expect(checkModeAvailability('web_context_verified.v2', { retrieval_mode: 'direct' })).toEqual({
      ok: true,
    });
    expect(
      checkModeAvailability('verify_agent_output.v2', { verification_mode: 'standard' })
    ).toEqual({ ok: true });
    expect(
      checkModeAvailability('company_evidence_graph.v2', { retrieval_mode: 'rendered' })
    ).toEqual({
      ok: true,
    });
    expect(checkModeAvailability('web_context_verified.v2', null)).toEqual({ ok: true });
  });
});

describe('projection validation and contradiction detection', () => {
  it('every unmodified projection is self-consistent, production disabled or enabled', () => {
    for (const id of ECONOMIC_SERVICE_IDS) {
      expect(validateEconomicProjection(project(id))).toEqual([]);
    }
    for (const id of ['web_context_verified.v2', 'verify_agent_output.v2'] as const) {
      expect(validateEconomicProjection(project(id, { productionEnabled: true }))).toEqual([]);
    }
  });

  it('fails: production-enabled with no destination or a sentinel payTo', () => {
    expect(
      validateEconomicProjection(
        project('web_context_verified.v2', { productionEnabled: true, destination: null })
      ).join('\n')
    ).toContain('no payment destination');
    expect(
      validateEconomicProjection(
        project('web_context_verified.v2', {
          productionEnabled: true,
          destination: { ...DESTINATION, payTo: 'siteborne-fixture:payto-not-configured' },
        })
      ).join('\n')
    ).toContain('sentinel or malformed');
  });

  it('fails: a compatibility identity marked production-enabled', () => {
    expect(
      validateEconomicProjection(
        project('web_context_verified.v1', { productionEnabled: true })
      ).join('\n')
    ).toContain('compatibility identity cannot be production-enabled');
  });

  it('fails: unavailable mode advertised as available / as the default', () => {
    const base = project('web_context_verified.v2');
    const tampered: EconomicOfferProjection = {
      ...base,
      available_modes: ['direct', 'rendered'],
      default_mode: 'rendered',
    };
    const problems = validateEconomicProjection(tampered).join('\n');
    expect(problems).toContain('available_modes lists rendered but the mode is unavailable');
    expect(problems).toContain('default_mode rendered is unavailable');
  });

  it('fails: exact/upto mismatch and a v1 id posing as the current v2 identity', () => {
    const doc = project('document_evidence_json.v2');
    expect(validateEconomicProjection({ ...doc, scheme: 'exact' as const }).length).toBeGreaterThan(
      0
    );
    const v1 = project('web_context_verified.v1');
    expect(
      validateEconomicProjection({ ...v1, contract_role: 'current' as const }).join('\n')
    ).toContain('non-v2 service id is projected as the current commercial identity');
  });

  it('detects cross-surface contradictions leaf by leaf', () => {
    const a = project('web_context_verified.v2');
    expect(compareEconomicProjections(a, { ...a })).toEqual([]);
    const paths = (b: EconomicOfferProjection) =>
      compareEconomicProjections(a, b).map((d) => d.path);
    expect(paths({ ...a, list_amount: '0.009' })).toEqual(['list_amount']);
    expect(paths({ ...a, scheme: 'upto' })).toContain('scheme');
    expect(
      paths({
        ...a,
        payment: { ...a.payment!, pay_to: '0x2222222222222222222222222222222222222222' },
      })
    ).toEqual(['payment.pay_to']);
    expect(paths({ ...a, payment: { ...a.payment!, network: 'eip155:84532' } })).toEqual([
      'payment.network',
    ]);
    expect(paths({ ...a, payment: { ...a.payment!, asset: '0xabc' } })).toEqual(['payment.asset']);
    expect(paths({ ...a, pricing_source_version: '9.9.9' })).toEqual(['pricing_source_version']);
    expect(paths({ ...a, production_enabled: true })).toEqual(['production_enabled']);
    const doc = project('document_evidence_json.v2');
    expect(
      compareEconomicProjections(doc, { ...doc, limits: { max_document_pages: 100 } }).map(
        (d) => d.path
      )
    ).toEqual(['limits.max_document_pages']);
  });

  it('compares resources by path so request-origin surfaces can differ only in host', () => {
    const a = project('web_context_verified.v2');
    const other = { ...a, resource: 'https://other.example/v2/x' };
    expect(compareEconomicProjections(a, other)).toEqual([]);
    const differentPath = { ...a, resource: 'https://utility.siteborne.net/v2/y' };
    expect(compareEconomicProjections(a, differentPath).map((d) => d.path)).toEqual([
      'resource_path',
    ]);
  });

  it('canonical serialization is key-order independent', () => {
    const a = project('verify_agent_output.v2');
    const reordered = Object.fromEntries(
      Object.entries(a).reverse()
    ) as unknown as EconomicOfferProjection;
    expect(canonicalEconomicProjectionJson(reordered)).toBe(canonicalEconomicProjectionJson(a));
  });
});

describe('governed declared limitations (one page limit)', () => {
  const STALE = ['Maximum 100 pages per job', 'Maximum file size 10MB', 'OCR quality varies'];

  it('replaces the stale frozen page claim with the governed limit for document services', () => {
    for (const id of ['document_evidence_json.v1', 'document_evidence_json.v2']) {
      const governed = governDeclaredLimitations(id, STALE);
      expect(governed[0]).toBe(`Maximum ${resolveMaxDocumentPages()} pages per job`);
      expect(governed.join(' ')).not.toContain('100');
      expect(governed.slice(1)).toEqual(STALE.slice(1));
    }
  });

  it('leaves other services and non-page limitations untouched, and is idempotent', () => {
    expect(governDeclaredLimitations('web_context_verified.v2', STALE)).toEqual(STALE);
    const once = governDeclaredLimitations('document_evidence_json.v2', STALE);
    expect(governDeclaredLimitations('document_evidence_json.v2', once)).toEqual(once);
    expect(governDeclaredLimitations('document_evidence_json.v2', [])).toEqual([]);
  });

  it('never mutates its input', () => {
    const input = Object.freeze([...STALE]);
    expect(() => governDeclaredLimitations('document_evidence_json.v2', input)).not.toThrow();
    expect(input[0]).toBe('Maximum 100 pages per job');
  });
});
