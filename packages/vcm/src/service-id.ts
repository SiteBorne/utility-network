/**
 * Canonical service identity (Master Reference Part II §VII / §XVI). The
 * four families observed today in registry/services/*.json.
 */
import type { ServiceGeneration } from './versions';
import { isServiceGeneration } from './versions';

export type ServiceFamily =
  | 'company_evidence_graph'
  | 'web_context_verified'
  | 'document_evidence_json'
  | 'verify_agent_output';

const SERVICE_FAMILIES: readonly ServiceFamily[] = [
  'company_evidence_graph',
  'web_context_verified',
  'document_evidence_json',
  'verify_agent_output',
];

export function isServiceFamily(value: string): value is ServiceFamily {
  return (SERVICE_FAMILIES as readonly string[]).includes(value);
}

export interface CanonicalServiceId {
  readonly family: ServiceFamily;
  readonly generation: ServiceGeneration;
}

/** `${family}.${generation}`, e.g. `document_evidence_json.v2` -- matches
 * the legacy registry's own `service_id` field exactly. */
export type CanonicalServiceIdValue = `${ServiceFamily}.${ServiceGeneration}`;

export function toServiceIdValue(id: CanonicalServiceId): CanonicalServiceIdValue {
  return `${id.family}.${id.generation}`;
}

export class InvalidServiceIdError extends Error {
  constructor(public readonly value: string) {
    super(`invalid CanonicalServiceIdValue: "${value}"`);
    this.name = 'InvalidServiceIdError';
  }
}

export function parseServiceIdValue(value: string): CanonicalServiceId {
  const dot = value.lastIndexOf('.');
  if (dot < 0) throw new InvalidServiceIdError(value);
  const family = value.slice(0, dot);
  const generation = value.slice(dot + 1);
  if (!isServiceFamily(family) || !isServiceGeneration(generation)) {
    throw new InvalidServiceIdError(value);
  }
  return { family, generation };
}

export function serviceIdEquals(a: CanonicalServiceId, b: CanonicalServiceId): boolean {
  return a.family === b.family && a.generation === b.generation;
}
