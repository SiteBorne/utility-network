import { describe, expect, it } from 'vitest';
import { AgentCard } from '@a2a-js/sdk';
import {
  A2A_PROTOCOL_VERSION,
  SITEBORNE_A2A_INTERFACE_URL,
  SITEBORNE_MTLS_SECURITY_SCHEME_KEY,
  SITEBORNE_SERVICE_IDS,
  SITEBORNE_X402_EXTENSION_URI,
  buildUnsignedSiteborneAgentCard,
} from './index';

describe('SITEBORNE A2A v1 Agent Card contract', () => {
  it('builds the immutable four-skill production-disabled JSON-RPC card without legacy fields', () => {
    const card = buildUnsignedSiteborneAgentCard();
    const wire = AgentCard.toJSON(card) as Record<string, unknown>;

    expect(card.name).toBe('SITEBORNE Utility Network');
    expect(card.supportedInterfaces).toEqual([
      {
        url: SITEBORNE_A2A_INTERFACE_URL,
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
        tenant: '',
      },
    ]);
    expect(card.skills.map((skill) => skill.id)).toEqual(SITEBORNE_SERVICE_IDS);
    expect(card.skills.every((skill) => skill.inputModes.includes('application/json'))).toBe(true);
    expect(card.skills.every((skill) => skill.outputModes.includes('application/json'))).toBe(true);
    // SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION:
    // no second argument means `mtlsProductionActive` defaults `false` --
    // the production-compatible state before real mTLS is operator-
    // qualified -- so the default card declares no security scheme at
    // all. See the dedicated 'mTLS declaration truthfulness gate' describe
    // block below for the CAPABILITY_TRUE/CAPABILITY_FALSE proof.
    expect(Object.keys(card.securitySchemes)).toEqual([]);
    expect(card.securityRequirements).toEqual([]);
    expect(card.capabilities?.streaming).toBe(false);
    expect(card.capabilities?.pushNotifications).toBe(false);
    expect(card.capabilities?.extendedAgentCard).toBe(false);
    expect(card.capabilities?.extensions).toHaveLength(1);
    expect(card.capabilities?.extensions[0]).toMatchObject({
      uri: SITEBORNE_X402_EXTENSION_URI,
      required: false,
      params: {
        x402Version: 2,
        paymentRequiredForUsefulExecution: true,
        productionEnabled: false,
      },
    });
    expect(card.signatures).toEqual([]);
    expect(wire).not.toHaveProperty('protocolVersion');
    expect(wire).not.toHaveProperty('url');
    expect(JSON.stringify(wire)).not.toContain('kind');
  });

  // SUN-1222B: guards against the top-level/per-service productionEnabled
  // divergence found live in production during SUN-1222A -- the top-level
  // x402 extension flag must always equal "at least one service below it
  // is production-enabled", never an independently hand-set value.
  it('derives the top-level x402 productionEnabled from the per-service map, never independently', () => {
    const noneActive = buildUnsignedSiteborneAgentCard();
    const params = noneActive.capabilities?.extensions[0]?.params as {
      productionEnabled: boolean;
      services: Array<{ serviceId: string; productionEnabled: boolean }>;
    };
    expect(params.productionEnabled).toBe(false);
    expect(params.services.every((service) => service.productionEnabled === false)).toBe(true);

    const oneActive = buildUnsignedSiteborneAgentCard({
      'verify_agent_output.v2': true,
    });
    const activeParams = oneActive.capabilities?.extensions[0]?.params as {
      productionEnabled: boolean;
      services: Array<{ serviceId: string; productionEnabled: boolean }>;
    };
    expect(activeParams.productionEnabled).toBe(true);
    const flaggedService = activeParams.services.find(
      (service) => service.serviceId === 'verify_agent_output.v2'
    );
    expect(flaggedService?.productionEnabled).toBe(true);
    // Every other service stays false, and the top-level flag stays a pure
    // aggregate -- it does not flip every service to "active" alongside it.
    expect(
      activeParams.services.filter((service) => service.serviceId !== 'verify_agent_output.v2')
    ).toSatisfy((rest: Array<{ productionEnabled: boolean }>) =>
      rest.every((service) => service.productionEnabled === false)
    );

    const allInactiveAgain = buildUnsignedSiteborneAgentCard({
      'verify_agent_output.v2': false,
    });
    const inactiveParams = allInactiveAgain.capabilities?.extensions[0]?.params as {
      productionEnabled: boolean;
    };
    expect(inactiveParams.productionEnabled).toBe(false);
  });

  // SUN-1222B (Agent Card skill normalization): external machine-discovery
  // consumers (observed live: Agenstry) reported the eight skills as four
  // visually-identical pairs. `company_evidence_graph.v1` and
  // `.v2` share byte-identical `title`/`description`/`capabilities` in the
  // registry (SUN-1000 checkpoint 1M's "same economics, same schemas, only
  // service_id/service_version differ") -- version-specific IDs stay
  // (`executor.ts`'s `SERVICE_ID_SET` dispatches directly on them, and every
  // frozen input/output schema, x402 price, and contract-release artifact is
  // keyed by the full `<family>.v<n>` id -- collapsing to four skills would
  // break real dispatch, not just cosmetics), so the fix is distinguishable
  // human-facing metadata per skill, not fewer skills.
  it('gives every skill a unique human-facing name distinguishing its service-contract major', () => {
    const card = buildUnsignedSiteborneAgentCard();
    const names = card.skills.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);

    const descriptions = card.skills.map((skill) => skill.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);

    // Both majors of all four capability families stay discoverable, and
    // each name states its own major explicitly (not just a shared prefix).
    for (const family of [
      'Company Evidence Graph',
      'Verified Web Context',
      'Document Evidence JSON',
      'Agent Output Verification',
    ]) {
      const v1 = card.skills.find(
        (skill) => skill.id.endsWith('.v1') && skill.name.includes(family)
      );
      const v2 = card.skills.find(
        (skill) => skill.id.endsWith('.v2') && skill.name.includes(family)
      );
      expect(v1, `expected a v1 skill for ${family}`).toBeDefined();
      expect(v2, `expected a v2 skill for ${family}`).toBeDefined();
      expect(v1?.name).not.toBe(v2?.name);
      expect(v1?.name.toLowerCase()).toContain('v1');
      expect(v2?.name.toLowerCase()).toContain('v2');
    }
  });
});

// SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A §8/§9/§18/§19: truthfully
// declares native A2A mutualTLS caller-identity support without gating the
// public anonymous probe (root securityRequirements stays []) and without
// costing the "Valid AgentCard" / "Protocol version" conformance criteria.
describe('SITEBORNE A2A Agent Card mTLS security-scheme declaration', () => {
  it('declares mutualTLS under the wire key defined by the pinned SDK', () => {
    // SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION:
    // explicitly activates the gate -- these tests prove the *shape* of
    // the declaration when it IS truthfully active, not the default
    // (now-gated-off) state. See the truthfulness gate describe block
    // below for CAPABILITY_FALSE/default coverage.
    const card = buildUnsignedSiteborneAgentCard(undefined, true);
    const wire = AgentCard.toJSON(card) as {
      securitySchemes?: Record<string, { mtlsSecurityScheme?: { description?: string } }>;
    };

    const scheme = card.securitySchemes[SITEBORNE_MTLS_SECURITY_SCHEME_KEY];
    expect(scheme?.scheme?.$case).toBe('mtlsSecurityScheme');
    expect(
      scheme?.scheme?.$case === 'mtlsSecurityScheme' ? scheme.scheme.value.description : undefined
    ).toEqual(expect.stringContaining('mutual TLS'));

    // The exact wire shape SITEBORNE's own pinned @a2a-js/sdk@1.0.1
    // SecurityScheme.toJSON() produces for a mtls oneof member -- proven by
    // reading node_modules/.pnpm/@a2a-js+sdk@1.0.1_*/…/dist/index.js, not
    // assumed. Agenstry (and any other conformant A2A client) reads exactly
    // this shape from GET /.well-known/agent-card.json.
    const wireScheme = wire.securitySchemes?.[SITEBORNE_MTLS_SECURITY_SCHEME_KEY];
    expect(wireScheme?.mtlsSecurityScheme).toBeDefined();
    expect(wireScheme?.mtlsSecurityScheme?.description).toEqual(
      expect.stringContaining('mutual TLS')
    );
  });

  it('never requires mTLS to reach the agent root -- the public probe stays anonymous', () => {
    const card = buildUnsignedSiteborneAgentCard();
    // An empty securityRequirements array is A2A's own "no requirement"
    // representation (see @a2a-js/sdk AgentCard doc comment: "Security
    // requirements for contacting the agent"). Anything non-empty here
    // would gate Agenstry's own anonymous SendMessage heartbeat probe,
    // which SUN-1222C-agent-trust-100-design.md §9 explicitly forbids.
    expect(card.securityRequirements).toEqual([]);
  });

  it('every skill also carries no per-skill security requirement in this slice', () => {
    // SUN-1222C-AGENT-TRUST-100-IMPLEMENTATION-A §10: no existing production
    // skill is being (mis)marked as mTLS-required just to chase conformance
    // points. Skill-level enforcement is a distinct, later, separately
    // authorized decision (design doc §10/§13, "Option D").
    const card = buildUnsignedSiteborneAgentCard();
    for (const skill of card.skills) {
      expect(skill.securityRequirements, `skill ${skill.id}`).toEqual([]);
    }
  });

  it('declaring mTLS does not disturb the x402 extension payload', () => {
    const card = buildUnsignedSiteborneAgentCard(
      {
        'web_context_verified.v2': true,
        'verify_agent_output.v2': true,
      },
      true
    );
    const x402Extension = card.capabilities?.extensions.find(
      (extension) => extension.uri === SITEBORNE_X402_EXTENSION_URI
    );
    expect(x402Extension?.params).toMatchObject({
      x402Version: 2,
      paymentRequiredForUsefulExecution: true,
      productionEnabled: true,
    });
    // mTLS declaration and the x402 extension are structurally independent
    // planes of the same card -- adding one must not perturb the other.
    expect(Object.keys(card.securitySchemes)).toEqual([SITEBORNE_MTLS_SECURITY_SCHEME_KEY]);
  });
});

// SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION §9/§10/
// §11: the mTLS security-scheme declaration above was unconditional --
// deploying the code as it stood before this checkpoint would advertise a
// native mTLS capability that does not yet exist in production (no real
// Cloudflare mTLS interface has been provisioned or operator-qualified).
// This describe block is the genuine RED->GREEN->mutation proof for the
// truthfulness gate: `mtlsProductionActive` (default `false`, matching
// every other production-activation flag's fail-closed convention in this
// codebase) must be the ONLY thing that turns the declaration on.
describe('SITEBORNE A2A Agent Card mTLS declaration truthfulness gate (SUN-1222C-DEPLOYMENT-DEPENDENCY-AND-MTLS-TRUTHFULNESS-REMEDIATION)', () => {
  it('CAPABILITY_FALSE (default, no second argument): omits securitySchemes.mtls entirely -- the production-compatible state before real mTLS is qualified', () => {
    const card = buildUnsignedSiteborneAgentCard();
    const wire = AgentCard.toJSON(card) as { securitySchemes?: Record<string, unknown> };

    expect(card.securitySchemes).toEqual({});
    expect(Object.keys(card.securitySchemes)).toHaveLength(0);
    expect(wire.securitySchemes ?? {}).toEqual({});
  });

  it('CAPABILITY_FALSE explicit (mtlsProductionActive: false): identical to the default -- no hidden second way to enable it', () => {
    const card = buildUnsignedSiteborneAgentCard(undefined, false);
    expect(card.securitySchemes).toEqual({});
  });

  it('CAPABILITY_TRUE (mtlsProductionActive: true): declares mutualTLS with the exact native A2A representation, unchanged from the pre-gate shape', () => {
    const card = buildUnsignedSiteborneAgentCard(undefined, true);
    const wire = AgentCard.toJSON(card) as {
      securitySchemes?: Record<string, { mtlsSecurityScheme?: { description?: string } }>;
    };

    expect(Object.keys(card.securitySchemes)).toEqual([SITEBORNE_MTLS_SECURITY_SCHEME_KEY]);
    const scheme = card.securitySchemes[SITEBORNE_MTLS_SECURITY_SCHEME_KEY];
    expect(scheme?.scheme?.$case).toBe('mtlsSecurityScheme');
    const wireScheme = wire.securitySchemes?.[SITEBORNE_MTLS_SECURITY_SCHEME_KEY];
    expect(wireScheme?.mtlsSecurityScheme?.description).toEqual(
      expect.stringContaining('mutual TLS')
    );
  });

  it('CAPABILITY_FALSE and CAPABILITY_TRUE both remain strict A2A-valid, keep root securityRequirements empty, and leave every skill/x402-extension field untouched', () => {
    const falseCard = buildUnsignedSiteborneAgentCard(undefined, false);
    const trueCard = buildUnsignedSiteborneAgentCard(undefined, true);

    for (const card of [falseCard, trueCard]) {
      expect(card.securityRequirements).toEqual([]);
      expect(card.skills.every((skill) => skill.securityRequirements.length === 0)).toBe(true);
      expect(card.skills.map((skill) => skill.id)).toEqual(SITEBORNE_SERVICE_IDS);
      // A2A SDK's own conformance round-trip -- throws on a structurally
      // invalid card, exactly like every other card construction test in
      // this file.
      expect(() => AgentCard.toJSON(card)).not.toThrow();
    }

    // Public anonymous probe semantics (root requirements empty) and the
    // x402 extension are identical regardless of the mTLS gate's state.
    expect(falseCard.securityRequirements).toEqual(trueCard.securityRequirements);
    expect(falseCard.capabilities?.extensions).toEqual(trueCard.capabilities?.extensions);
  });
});
