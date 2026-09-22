/**
 * The eleven version namespaces (Master Reference Part I §4 / Part II §2).
 * Every version-shaped fact in VCM is scoped to exactly one of these named
 * types -- there is no bare `version` field anywhere in the model.
 */
import type { SemVer } from './primitives';
import { parseSemVer } from './primitives';
import type { Unknown_ } from './sentinels';

/** Registry `service_version` values. Extend this union, never widen it
 * silently, when a v3 generation is introduced (v1/v2 are permanent
 * parallel identities per docs/contracts/VERSIONING.md, not a
 * deprecation ladder). */
export type ServiceGeneration = 'v1' | 'v2' | 'v3';

export function isServiceGeneration(value: string): value is ServiceGeneration {
  return value === 'v1' || value === 'v2' || value === 'v3';
}

/** contracts/releases/<version>/CONTRACT_RELEASE.yaml's own version. */
export type ContractReleaseVersion = SemVer;

/** The PCC wire format version stamped on a receipt (`pcc_version` in the
 * legacy registry files). Only '1.0.0' has ever been observed; kept as a
 * SemVer (not a literal union) because the wire format is versioned
 * independently of everything else and a new wire version is a normal,
 * expected future event. */
export type PccWireVersion = SemVer;

/** `@siteborne/pcc-schema`'s own generator/schema-shape version
 * (`contracts/releases/*.yaml`'s `pcc_dependency.schema_release`) --
 * deliberately kept distinct from PccWireVersion: the wire format a
 * receipt is signed against and the schema-generation tooling that
 * produced today's schemas are two different facts that happen to share a
 * numbering scheme today but are not required to move together.
 */
export type PccSchemaRelease = SemVer;

/** MCP's date-based protocol version string, e.g. '2026-07-28'. */
export type McpProtocolVersion = string & { readonly __brand: 'McpProtocolVersion' };
const MCP_PROTOCOL_VERSION_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseMcpProtocolVersion(value: string): McpProtocolVersion {
  if (!MCP_PROTOCOL_VERSION_RE.test(value)) {
    throw new TypeError(`invalid McpProtocolVersion: ${value}`);
  }
  return value as McpProtocolVersion;
}

/** x402's integer protocol version, from `@x402/core`'s `x402Version`. */
export type X402ProtocolVersion = number;

/** This package's own schema shape version -- bumps when a TypeScript type
 * in this module changes shape, independent of any particular compiled
 * instance of the model. */
export type VcmSchemaVersion = SemVer;

/** The version of one specific compiled VCM instance (a `VcmSchemaVersion`
 * may have many `VcmReleaseVersion`s compiled against it over time). */
export type VcmReleaseVersion = SemVer;

/** A single protocol-surface adapter's own output-shape version (e.g. the
 * A2A adapter's Agent Card projector). Not implemented as a real adapter in
 * this checkpoint -- reserved for METADATA-VCM-04. */
export type ProjectionVersion = SemVer;

/** Operational, not static: which exact Cloudflare Worker version is
 * currently serving traffic. Never appears in CanonicalStaticModel. */
export type DeploymentVersion =
  | { readonly platform: 'cloudflare-workers'; readonly workerVersionId: string }
  | Unknown_;

/** governance/RISK_LIMITS.yaml's own top-level `version:` field, as
 * returned by `@siteborne/pricing`'s `resolvePricingSourceVersion()`. Not a
 * SemVer type alias because the governance file's own field is a bare
 * string today ('1.0.0') validated only by that package, not by this one --
 * re-parsing it here would be a second, divergent authority over the same
 * fact. */
export type PricingPolicyVersion = string;

export function makeContractReleaseVersion(value: string): ContractReleaseVersion {
  return parseSemVer(value);
}
export function makePccWireVersion(value: string): PccWireVersion {
  return parseSemVer(value);
}
export function makePccSchemaRelease(value: string): PccSchemaRelease {
  return parseSemVer(value);
}
export function makeVcmSchemaVersion(value: string): VcmSchemaVersion {
  return parseSemVer(value);
}
export function makeVcmReleaseVersion(value: string): VcmReleaseVersion {
  return parseSemVer(value);
}
