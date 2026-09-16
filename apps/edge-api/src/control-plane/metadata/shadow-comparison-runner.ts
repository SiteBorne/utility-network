/**
 * METADATA-VCM-06 §XIII/§XVI/§XXI, implemented per METADATA-VCM-IMPL-04A.
 * The one shared entry point both A2A (`routes/a2a.ts`) and MCP
 * (`routes/mcp.ts`) call into for `shadow_compare`. Its return type is
 * `Promise<void>` -- there is no code path by which its result could be
 * served, by construction, not by caller discipline. Every failure mode
 * (a throwing shadow builder, a rejected promise, a throwing telemetry
 * sink) is caught here and never propagates, so a VCM-side fault can never
 * affect the legacy response the caller already decided to serve.
 *
 * Reuses IMPL-03B's `compareProjections`/`summarizeDifferences` --
 * comparison semantics are identical to offline qualification
 * (`OFFLINE_COMPARATOR_RUNTIME_COMPARATOR_SAME_SEMANTICS=YES`), just
 * wrapped into a smaller, telemetry-safe result.
 */
import { compareProjections, summarizeDifferences, type ComparatorConfig } from '@siteborne/vcm';
import { recordMetadataProjectionComparison } from '../telemetry/metadata-projection-telemetry';

export interface RunShadowComparisonParams {
  readonly surface: 'a2a' | 'mcp';
  readonly existing: unknown;
  /** May be sync or async, and may throw/reject -- both are caught. */
  readonly buildShadow: () => unknown | Promise<unknown>;
  readonly governedDifferences?: ComparatorConfig['governedDifferences'];
}

function safeLogError(payload: Record<string, unknown>): void {
  try {
    console.error(JSON.stringify(payload));
  } catch {
    // best-effort, matches metadata-projection-telemetry.ts's own discipline
  }
}

/**
 * Never throws. Never returns anything the caller could serve. Records
 * bounded telemetry (never full projection content) and, on any internal
 * failure, degrades to a single structured error log rather than
 * propagating -- a comparison failure is equivalent to "could not compare
 * this time," not "the legacy response is now suspect."
 */
export async function runShadowComparison(params: RunShadowComparisonParams): Promise<void> {
  const { surface, existing, buildShadow, governedDifferences } = params;
  try {
    const shadow = await buildShadow();
    const differences = compareProjections(existing, shadow, { governedDifferences });
    const summary = summarizeDifferences(differences);
    const fellBackToLegacy = summary.UNEXPLAINED_DIFFERENCE > 0;
    try {
      recordMetadataProjectionComparison({ surface, differenceSummary: summary, fellBackToLegacy });
    } catch {
      // Telemetry failure must never affect served output or propagate
      // (VCM-06 §XXI) -- the comparison itself already completed.
    }
  } catch (error) {
    safeLogError({
      event: 'metadata_projection_compare_error',
      surface,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
