/**
 * Per-generation contract release / PCC schema-release mapping, read
 * directly from contracts/releases/<version>/CONTRACT_RELEASE.yaml (not
 * invented -- the legacy registry files carry no contract-release field of
 * their own, only `pcc_version`, which is the wire version, not the
 * schema-generation release).
 *
 * contracts/releases/1.0.0/CONTRACT_RELEASE.yaml and
 * contracts/releases/1.0.1/CONTRACT_RELEASE.yaml both list all four v1
 * services at `contract_version: '1.0.0'`, `schema_release: '1.0.1'`.
 * contracts/releases/2.0.0/CONTRACT_RELEASE.yaml (frozen normative,
 * 2026-08-17) lists all four v2 services at `contract_version: '2.0.0'`,
 * `schema_release: '1.1.0'`. Verified identical across all four families
 * in every release file -- this is a per-generation fact, not a
 * per-service one, in the current data.
 */
import type { ServiceGeneration } from '../versions';

export interface ContractMapEntry {
  readonly contractReleaseVersion: string;
  readonly pccSchemaRelease: string;
}

const CONTRACT_MAP: Readonly<Record<ServiceGeneration, ContractMapEntry>> = {
  v1: { contractReleaseVersion: '1.0.0', pccSchemaRelease: '1.0.1' },
  v2: { contractReleaseVersion: '2.0.0', pccSchemaRelease: '1.1.0' },
};

export function contractMapFor(generation: ServiceGeneration): ContractMapEntry {
  return CONTRACT_MAP[generation];
}
