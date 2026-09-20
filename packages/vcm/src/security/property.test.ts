/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately mutate deep clones of a typed bundle into invalid states */
import { describe, expect, it } from 'vitest';
import { buildSecurityDeclarationV1, type SecurityDeclarationBundle } from './declaration';
import {
  checkProjectionNarrowing,
  projectPublicSecurityDeclaration,
  toSecurityFragment,
  SecurityDeclarationError,
} from './project';
import { RELEASE_1_STATUS_CEILINGS, validateSecurityDeclaration } from './validate';
import {
  IMPLEMENTATION_STATUSES,
  EVIDENCE_CLASSES,
  failClosedStatus,
  isNoStrongerThan,
  narrowest,
  statusRank,
} from './vocabulary';

type Mutable = { -readonly [K in keyof SecurityDeclarationBundle]: any };
const base = () => structuredClone(buildSecurityDeclarationV1()) as unknown as Mutable;
const codes = (d: Mutable) =>
  validateSecurityDeclaration(d as unknown as SecurityDeclarationBundle).map((v) => v.code);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('status lattice (exhaustive)', () => {
  const S = IMPLEMENTATION_STATUSES;
  it('is a total order: reflexive, antisymmetric, transitive, total', () => {
    for (const a of S) {
      expect(isNoStrongerThan(a, a)).toBe(true);
      for (const b of S) {
        expect(isNoStrongerThan(a, b) || isNoStrongerThan(b, a)).toBe(true);
        if (isNoStrongerThan(a, b) && isNoStrongerThan(b, a)) expect(a).toBe(b);
        for (const c of S) {
          if (isNoStrongerThan(a, b) && isNoStrongerThan(b, c))
            expect(isNoStrongerThan(a, c)).toBe(true);
        }
      }
    }
  });
  it('narrowest never broadens either operand', () => {
    for (const a of S)
      for (const b of S) {
        const n = narrowest(a, b);
        expect(statusRank(n)).toBeLessThanOrEqual(statusRank(a));
        expect(statusRank(n)).toBeLessThanOrEqual(statusRank(b));
      }
  });
  it('unknown values fail closed to UNSUPPORTED, never stronger', () => {
    for (const junk of ['', 'ENFORCED', 'implemented_enforced', null, undefined, 3, {}, []]) {
      expect(failClosedStatus(junk)).toBe('UNSUPPORTED');
    }
  });
});

describe('unsupported features cannot become implemented (exhaustive)', () => {
  it('every feature x every status above its ceiling is rejected in canonical and in projection', () => {
    for (const [feature, ceiling] of Object.entries(RELEASE_1_STATUS_CEILINGS)) {
      for (const status of IMPLEMENTATION_STATUSES) {
        const d = base();
        d.unsupportedSecurityFeatures.find((n: any) => n.feature === feature).status = status;
        const above = statusRank(status) > statusRank(ceiling);
        expect(codes(d).includes('STATUS_ABOVE_RELEASE_CEILING'), `${feature}:${status}`).toBe(
          above
        );
        if (above)
          expect(() => projectPublicSecurityDeclaration(d as never)).toThrow(
            SecurityDeclarationError
          );
      }
    }
  });
});

describe('external evidence cannot expand authority or identity (exhaustive)', () => {
  it('every class rejects mayImplyIdentity and mayWidenAuthority', () => {
    for (const cls of EVIDENCE_CLASSES) {
      const a = base();
      a.evidenceSemantics.find((e: any) => e.evidenceClass === cls).mayImplyIdentity = true;
      expect(codes(a), cls).toContain('IDENTITY_FROM_EVIDENCE');
      const b = base();
      b.evidenceSemantics.find((e: any) => e.evidenceClass === cls).mayWidenAuthority = true;
      expect(codes(b), cls).toContain('EVIDENCE_WIDENS_AUTHORITY');
    }
  });
  it('a payment profile cannot satisfy an identity requirement with any identity value', () => {
    for (const identity of [
      'established',
      'established_by_payment',
      'verified',
      'caller_identified',
      '',
    ]) {
      const d = base();
      d.supportedSecurityProfiles.find((p: any) => p.id === 'PUBLIC_ECONOMIC_X402').identity =
        identity;
      expect(codes(d), identity).toContain('IDENTITY_FROM_EVIDENCE');
    }
  });
});

describe('projection status <= canonical status (exhaustive)', () => {
  const canonical = buildSecurityDeclarationV1();
  it('every binding x every projected status is flagged iff it exceeds canonical', () => {
    for (const b of canonical.capabilitySecurityBindings) {
      const frag = toSecurityFragment(
        projectPublicSecurityDeclaration(canonical).capabilitySecurityBindings.find(
          (x) => x.id === b.id
        )!
      );
      for (const status of IMPLEMENTATION_STATUSES) {
        const flagged = checkProjectionNarrowing(canonical, [
          { ...frag, implementationStatus: status },
        ]).some((v) => v.message.includes('stronger'));
        expect(flagged, `${b.id}:${status}`).toBe(
          statusRank(status) > statusRank(b.implementationStatus)
        );
      }
    }
  });
  it('a projection can never enable what canonical keeps closed', () => {
    for (const b of canonical.capabilitySecurityBindings.filter((x) => !x.purchasable)) {
      const frag = toSecurityFragment(
        projectPublicSecurityDeclaration(canonical).capabilitySecurityBindings.find(
          (x) => x.id === b.id
        )!
      );
      expect(
        checkProjectionNarrowing(canonical, [{ ...frag, purchasable: true }]).length,
        b.id
      ).toBeGreaterThan(0);
    }
  });
  it('an unknown binding id in a projection is rejected', () => {
    const frag = toSecurityFragment(
      projectPublicSecurityDeclaration(canonical).capabilitySecurityBindings[0]!
    );
    expect(
      checkProjectionNarrowing(canonical, [{ ...frag, bindingId: 'invented/binding' }]).length
    ).toBe(1);
  });
});

describe('seeded random mutation of bindings', () => {
  it('any change that raises availability or purchasability above governance is rejected; narrowing is allowed', () => {
    const rand = mulberry32(0x5ec0de);
    const canonical = buildSecurityDeclarationV1();
    for (let i = 0; i < 400; i++) {
      const idx = Math.floor(rand() * canonical.capabilitySecurityBindings.length);
      const original = canonical.capabilitySecurityBindings[idx]!;
      if (original.kind !== 'paid_service') continue;
      const d = base();
      const b = d.capabilitySecurityBindings[idx];
      const raise = rand() < 0.5;
      if (raise) {
        b.purchasable = true;
        b.available = true;
      } else {
        b.purchasable = false;
      }
      const found = codes(d);
      if (raise && !original.purchasable) {
        expect(
          found.some(
            (c) => c === 'PURCHASABILITY_EXCEEDS_GOVERNANCE' || c === 'CLOSED_CAPABILITY_ENABLED'
          ),
          original.id
        ).toBe(true);
      }
      if (!raise) {
        expect(found.includes('PURCHASABILITY_EXCEEDS_GOVERNANCE'), original.id).toBe(false);
      }
    }
  });
});

describe('public projection cannot expose private fields (exhaustive over sections)', () => {
  it('injected private keys in any canonical section never reach the projection', () => {
    const sections = [
      'policySemantics',
      'runtimeQualification',
      'resultSecurity',
      'economicSecurity',
      'credentialBoundaries',
      'hostileContentBoundaries',
    ] as const;
    for (const section of sections) {
      const d = base();
      d[section][0].privateNotes = 'thresholds 0.42 secretWeight';
      d[section][0].routingScore = 0.87;
      const out = JSON.stringify(projectPublicSecurityDeclaration(d as never));
      expect(out, section).not.toContain('privateNotes');
      expect(out, section).not.toContain('routingScore');
      expect(out, section).not.toContain('secretWeight');
    }
    const d = base();
    d.capabilitySecurityBindings[0].supplierRank = 1;
    d.keyPurposeBoundaries[0].keyMaterial = 'x';
    const out = JSON.stringify(projectPublicSecurityDeclaration(d as never));
    expect(out).not.toContain('supplierRank');
    expect(out).not.toContain('keyMaterial');
  });
});

describe('closed capabilities cannot inherit an enabled profile', () => {
  it('for every closed binding, setting any profile is rejected', () => {
    const canonical = buildSecurityDeclarationV1();
    canonical.capabilitySecurityBindings.forEach((b, i) => {
      if (b.admission !== 'closed_not_admitted') return;
      for (const profile of ['PUBLIC_ECONOMIC_X402', 'PUBLIC_DISCOVERY']) {
        const d = base();
        d.capabilitySecurityBindings[i].securityProfile = profile;
        expect(codes(d), `${b.id}:${profile}`).toContain('CLOSED_CAPABILITY_ENABLED');
      }
    });
  });
});
