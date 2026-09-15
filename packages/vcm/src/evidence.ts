/**
 * Evidence and release provenance (Master Reference Part II §"Provenance /
 * release-evidence").
 */
import type { GitSha, IsoTimestamp, Sha256Digest } from './primitives';
import type { ProtocolSurface } from './types';
import type { ContractReleaseVersion, DeploymentVersion, VcmReleaseVersion } from './versions';
import type { ProvenanceRef } from './types';
import type { Unknown_ } from './sentinels';

export type EvidenceKind =
  | 'git_commit'
  | 'docs_report'
  | 'contract_release'
  | 'promotion_requirement'
  | 'live_query';

export interface EvidenceRef {
  readonly kind: EvidenceKind;
  readonly locator: string;
  readonly observedAt: IsoTimestamp;
}

export interface MetadataRelease {
  readonly vcmReleaseVersion: VcmReleaseVersion;
  readonly modelDigest: Sha256Digest;
  readonly provenance: ProvenanceRef;
  readonly deploymentVersion: DeploymentVersion | Unknown_;
  readonly projectionDigests: Readonly<Partial<Record<ProtocolSurface, Sha256Digest>>>;
  readonly qualificationEvidence: readonly EvidenceRef[];
}

export type { GitSha, ContractReleaseVersion };
