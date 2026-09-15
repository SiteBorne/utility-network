/**
 * The five frozen digest classes (Master Reference Part II §XIV) -- and
 * only these five. No organization digest, no interaction digest, no
 * metadata-identity digest: the frozen design deliberately rejected them as
 * unnecessary, and this checkpoint does not add digests "because they are
 * possible."
 *
 * Every digest excludes the volatile timestamp fields listed below before
 * canonicalizing, so a digest changes only when semantic content changes,
 * never when a clock ticks.
 */
import { hashCanonical } from './canonical';
import type { Sha256Digest } from './primitives';
import type { CanonicalService, CanonicalStaticModel } from './types';
import type { RuntimeStateOverlay } from './runtime-overlay';
import type { EffectiveMetadataView } from './effective-view';

/** organization + services + pricingPolicyVersion + compatibility +
 * vcmSchemaVersion (structural shape). Excludes vcmReleaseVersion,
 * modelDigest, and compiledAt -- those describe *this compiled instance*,
 * not the content. */
export async function computeModelDigest(model: CanonicalStaticModel): Promise<Sha256Digest> {
  const input = {
    vcmSchemaVersion: model.modelIdentity.vcmSchemaVersion,
    organization: model.organization,
    services: [...model.services].sort((a, b) =>
      `${a.id.family}.${a.id.generation}`.localeCompare(`${b.id.family}.${b.id.generation}`)
    ),
    pricingPolicyVersion: model.pricingPolicyVersion,
    compatibility: model.compatibility,
  };
  return (await hashCanonical(input)) as Sha256Digest;
}

/** Fine-grained, per-service digest -- lets a consumer (notably the
 * registry-parity diff tooling) point at exactly which service changed
 * without hashing the whole model. Services carry no timestamps of their
 * own, so nothing needs excluding. */
export async function computeServiceDigest(service: CanonicalService): Promise<Sha256Digest> {
  return (await hashCanonical(service)) as Sha256Digest;
}

/** Excludes observedAt and every measuredAt inside `security`. */
export async function computeRuntimeOverlayDigest(
  overlay: RuntimeStateOverlay
): Promise<Sha256Digest> {
  const input = {
    deploymentVersion: overlay.deploymentVersion,
    routes: overlay.routes,
    economics: overlay.economics,
    security: overlay.security.map(({ mechanismKind, measuredLevel, evidenceRef }) => ({
      mechanismKind,
      measuredLevel,
      evidenceRef,
    })),
    qualification: overlay.qualification,
  };
  return (await hashCanonical(input)) as Sha256Digest;
}

/** Excludes generatedAt. The `digest` field on EffectiveMetadataView itself
 * is computed identically inside effective-view.ts's project() -- this
 * standalone function exists so a caller holding only a
 * previously-produced view (without re-running project()) can still verify
 * it. */
export async function computeEffectiveViewDigest(
  view: EffectiveMetadataView
): Promise<Sha256Digest> {
  const input = { organizationPublicName: view.organizationPublicName, services: view.services };
  return (await hashCanonical(input)) as Sha256Digest;
}

/** Generic deterministic digest primitive for a generated protocol-surface
 * projection's own output. No adapter exists yet to call this with real
 * output (METADATA-VCM-04+ wires A2A/MCP/OpenAPI/x402/Bazaar) -- this
 * checkpoint implements only the primitive itself. */
export async function computeProjectionDigest(projectionOutput: unknown): Promise<Sha256Digest> {
  return (await hashCanonical(projectionOutput)) as Sha256Digest;
}
