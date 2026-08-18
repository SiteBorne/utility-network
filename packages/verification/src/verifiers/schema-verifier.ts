import {
  getAjv,
  getOutputSchemaId,
  getPrecompiledOutputValidator,
  knownServiceIds,
} from '../schema-registry';
import type { ValidateFunction } from 'ajv';
import type { CandidateResult, VerificationContext, VerificationResult, Verifier } from '../types';
import { buildResult } from './base';

export const SCHEMA_VERIFIER_ID = 'schema_verifier';
export const SCHEMA_VERIFIER_VERSION = '1.0.0';

/**
 * Verifies the candidate output against the frozen output schema for its
 * declared service_id (schemas/services/*.schema.json). Uses the actual
 * frozen schema artifacts via ajv, not a hand-written divergent copy.
 */
export class SchemaVerifier implements Verifier {
  readonly verifierId = SCHEMA_VERIFIER_ID;
  readonly verifierVersion = SCHEMA_VERIFIER_VERSION;
  readonly capabilities = ['schema_conformance'] as const;
  readonly dependsOn: readonly string[] = [];
  readonly mandatory = true;

  async verify(
    candidate: CandidateResult,
    context: VerificationContext
  ): Promise<VerificationResult> {
    const startedAt = context.clock.nowMs();

    if (!knownServiceIds().includes(candidate.service_id)) {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'unknown_service',
        subject: candidate.service_id,
        status: 'fail',
        severity: 'blocking',
        failureCodes: ['unknown_service'],
        findings: [
          {
            code: 'unknown_service',
            message: `Unknown service_id: ${candidate.service_id}`,
            severity: 'blocking',
          },
        ],
      });
    }

    const schemaId = getOutputSchemaId(candidate.service_id);
    if (!schemaId) {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'schema_not_found',
        subject: candidate.service_id,
        status: 'fail',
        severity: 'blocking',
        failureCodes: ['schema_not_found'],
      });
    }

    // SUN-1200 checkpoint F (P0-A): prefer the build-time-precompiled
    // validator (registered once at real Worker module-load time via
    // `setPrecompiledOutputValidators`) over `getAjv()`'s runtime
    // filesystem-based construction/compilation path. When the
    // precompiled override was never set (every non-Worker caller --
    // local scripts, this package's own tests), behavior is unchanged:
    // falls straight through to the exact same `getAjv()` call this file
    // always made.
    const validate =
      (getPrecompiledOutputValidator(schemaId) as ValidateFunction | undefined) ??
      getAjv().getSchema(schemaId);
    if (!validate) {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'schema_not_registered',
        subject: schemaId,
        status: 'fail',
        severity: 'blocking',
        failureCodes: ['schema_not_registered'],
      });
    }

    const valid = validate(candidate.output);
    if (valid) {
      return buildResult(candidate, context, startedAt, {
        verifierId: this.verifierId,
        verifierVersion: this.verifierVersion,
        ruleId: 'schema_conformance',
        subject: schemaId,
        status: 'pass',
        severity: 'info',
        provenance: [`schema:${schemaId}`],
      });
    }

    const findings = (validate.errors ?? []).slice(0, 50).map((e) => ({
      code: 'schema_violation',
      message: `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`,
      severity: 'blocking' as const,
      subject: e.instancePath,
    }));

    return buildResult(candidate, context, startedAt, {
      verifierId: this.verifierId,
      verifierVersion: this.verifierVersion,
      ruleId: 'schema_conformance',
      subject: schemaId,
      status: 'fail',
      severity: 'blocking',
      failureCodes: ['schema_violation'],
      findings,
      provenance: [`schema:${schemaId}`],
    });
  }
}
