import {
  canonicalize,
  contentHash,
  getOutputSchemaId,
  type KeyRegistry,
} from '@siteborne/verification';
import { verifySelfVerifyingPcc, type SelfVerifyingPcc } from '@siteborne/service-runtime';
import type { ValidateFunction } from 'ajv';
import { outputValidatorsById } from '../../generated/output-validators.generated.js';
import type { ArtifactStore } from '../artifacts/store';
import type { ArtifactRecord } from '../types';
import type { ExecutorOutcome } from '../routes/x402-service';

export const LEGACY_RECEIPT_ONLY = 'LEGACY_RECEIPT_ONLY' as const;
export const SELF_VERIFYING_PCC_VNEXT = 'SELF_VERIFYING_PCC_VNEXT' as const;
export const R2_CONTENT_ADDRESS = 'R2_CONTENT_ADDRESS' as const;

/**
 * The service-runtime budget is the candidate wire-size authority. Keeping
 * this boundary at 5,000,000 bytes makes the accepted maximum explicit and
 * prevents a vNext PCC from ever being returned as an ordinary Workflow step
 * value (1 MiB) or written inline to D1 (2,000,000 bytes).
 */
export const MAX_VNEXT_PCC_BYTES = 5_000_000;

export type ResultRecordFormat = typeof LEGACY_RECEIPT_ONLY | typeof SELF_VERIFYING_PCC_VNEXT;

export interface VNextPccArtifactReference {
  readonly storage: typeof R2_CONTENT_ADDRESS;
  readonly content_hash: `sha256:${string}`;
  readonly byte_length: number;
  readonly media_type: 'application/pcc+json';
}

export interface VNextPccResultRecord {
  readonly result_format: typeof SELF_VERIFYING_PCC_VNEXT;
  readonly result_reference: VNextPccArtifactReference;
}

export interface LegacyResultRecord {
  readonly result_format?: typeof LEGACY_RECEIPT_ONLY;
  readonly body: unknown;
}

export type StoredResultRecord = VNextPccResultRecord | LegacyResultRecord;

export async function validateGovernedVNextPcc(
  serviceId: string,
  pcc: Readonly<Record<string, unknown>>,
  keyRegistry?: KeyRegistry
): Promise<string | null> {
  const schemaId = getOutputSchemaId(serviceId);
  const validator = schemaId
    ? (outputValidatorsById[schemaId] as ValidateFunction | undefined)
    : undefined;
  if (!validator) return 'missing_precompiled_output_validator';
  if (!validator(pcc)) return 'pcc_schema_validation_failed';
  if (!keyRegistry) return 'missing_pcc_key_registry';
  const verification = await verifySelfVerifyingPcc(pcc as SelfVerifyingPcc, keyRegistry);
  return verification.valid
    ? null
    : `pcc_crypto_verification_failed:${verification.errors[0] ?? 'unknown'}`;
}

function authorizationClass(serviceId: string): ArtifactRecord['authorization_class'] {
  return serviceId === 'company_evidence_graph.v3' || serviceId === 'web_context_verified.v3'
    ? 'public'
    : 'buyer_authorized';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function classifyStoredResultRecord(value: unknown): ResultRecordFormat | null {
  if (!isRecord(value)) return null;
  if (value.result_format === SELF_VERIFYING_PCC_VNEXT) return SELF_VERIFYING_PCC_VNEXT;
  if (value.result_format === undefined || value.result_format === LEGACY_RECEIPT_ONLY) {
    return 'body' in value ? LEGACY_RECEIPT_ONLY : null;
  }
  return null;
}

function isVNextReference(value: unknown): value is VNextPccArtifactReference {
  return (
    isRecord(value) &&
    value.storage === R2_CONTENT_ADDRESS &&
    typeof value.content_hash === 'string' &&
    /^sha256:[0-9a-f]{64}$/.test(value.content_hash) &&
    typeof value.byte_length === 'number' &&
    value.media_type === 'application/pcc+json'
  );
}

export async function resolveStoredResultBody(
  value: unknown,
  reader?: Pick<PccResultArtifactStore, 'read'>
): Promise<Readonly<Record<string, unknown>> | null> {
  const format = classifyStoredResultRecord(value);
  if (!format || !isRecord(value)) return null;
  if (format === LEGACY_RECEIPT_ONLY) {
    return isRecord(value.body) ? value.body : null;
  }
  if (!reader || !isVNextReference(value.result_reference)) return null;
  try {
    return await reader.read(value.result_reference);
  } catch {
    return null;
  }
}

export class PccResultArtifactStore {
  constructor(private readonly artifacts: ArtifactStore) {}

  async stage(input: {
    readonly jobId: string;
    readonly serviceId: string;
    readonly pcc: Readonly<Record<string, unknown>>;
    readonly createdAt: string;
  }): Promise<VNextPccArtifactReference> {
    const canonical = canonicalize(input.pcc);
    const bytes = new TextEncoder().encode(canonical);
    if (bytes.byteLength > MAX_VNEXT_PCC_BYTES) {
      throw new Error(`vnext_pcc_exceeds_${MAX_VNEXT_PCC_BYTES}_byte_limit`);
    }
    const hash = (await contentHash(canonical)) as `sha256:${string}`;
    await this.artifacts.put(
      {
        id: input.jobId,
        content_hash: hash,
        media_type: 'application/pcc+json',
        byte_length: bytes.byteLength,
        created_at: input.createdAt,
        authorization_class: authorizationClass(input.serviceId),
        retention_class: 'standard',
        job_id: input.jobId,
        artifact_type: 'output',
      },
      bytes
    );
    return {
      storage: R2_CONTENT_ADDRESS,
      content_hash: hash,
      byte_length: bytes.byteLength,
      media_type: 'application/pcc+json',
    };
  }

  async isReady(reference: VNextPccArtifactReference): Promise<boolean> {
    if (
      reference.storage !== R2_CONTENT_ADDRESS ||
      reference.media_type !== 'application/pcc+json' ||
      !Number.isInteger(reference.byte_length) ||
      reference.byte_length <= 0 ||
      reference.byte_length > MAX_VNEXT_PCC_BYTES
    ) {
      return false;
    }
    const metadata = await this.artifacts.getByContentHash(reference.content_hash);
    return (
      metadata !== null &&
      metadata.content_hash === reference.content_hash &&
      metadata.byte_length === reference.byte_length &&
      metadata.media_type === reference.media_type
    );
  }

  async read(reference: VNextPccArtifactReference): Promise<Readonly<Record<string, unknown>>> {
    if (!(await this.isReady(reference))) throw new Error('vnext_pcc_artifact_not_ready');
    const bytes = await this.artifacts.getContentByContentHash(reference.content_hash);
    if (!bytes || bytes.byteLength !== reference.byte_length) {
      throw new Error('vnext_pcc_artifact_length_mismatch');
    }
    const canonical = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if ((await contentHash(canonical)) !== reference.content_hash) {
      throw new Error('vnext_pcc_artifact_hash_mismatch');
    }
    const parsed: unknown = JSON.parse(canonical);
    if (!isRecord(parsed) || canonicalize(parsed) !== canonical) {
      throw new Error('vnext_pcc_artifact_not_canonical_json_object');
    }
    return parsed;
  }

  /**
   * Runs inside the Workflow's durable `invoke-executor` callback. The full
   * candidate body is committed to R2 before the callback returns, and the
   * persisted step value contains only a bounded reference. Large service
   * output is removed from that step value as well; its signed copy remains in
   * the PCC object.
   */
  async prepareExecutorOutcome(input: {
    readonly outcome: ExecutorOutcome;
    readonly jobId: string;
    readonly serviceId: string;
    readonly createdAt: string;
  }): Promise<ExecutorOutcome> {
    const representation = input.outcome.resultRepresentation;
    if (!representation || 'reference' in representation) return input.outcome;
    if (!input.outcome.linkEvidenceInputs) {
      throw new Error('missing_link_evidence_inputs');
    }
    const reference = await this.stage({
      jobId: input.jobId,
      serviceId: input.serviceId,
      pcc: representation.body,
      createdAt: input.createdAt,
    });
    if (reference.content_hash !== input.outcome.linkEvidenceInputs.buyerReceiptHash) {
      throw new Error('link_evidence_hash_mismatch');
    }
    return {
      ...input.outcome,
      result: { ...input.outcome.result, output: undefined },
      resultRepresentation: { format: SELF_VERIFYING_PCC_VNEXT, reference },
    };
  }
}
