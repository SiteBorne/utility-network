/**
 * R3-A4-55 — runtime version self-report.
 *
 * Reads ONLY the platform-injected `CF_VERSION_METADATA` binding
 * (`[version_metadata]` in the Wrangler config) and reports it verbatim.
 * No caller-supplied value is ever echoed, so the report says which Worker
 * version is actually executing, not which one somebody expected.
 *
 * Observation only. The report is never read by, and never gates, provider
 * dispatch, result release, settlement or payment. Nothing here touches D1,
 * Workflows, providers or secrets. `tag` is operator-chosen text: evidence
 * consumers treat it as an annotation, never as source authority.
 */

/** Shape of the Cloudflare `version_metadata` binding (id, tag, timestamp). */
export interface VersionMetadataBinding {
  readonly id: string;
  readonly tag: string;
  readonly timestamp: string;
}

export const RUNTIME_VERSION_EVENT = 'siteborne.runtime_version' as const;

export interface RuntimeVersionReport {
  readonly deployment_unit: string;
  readonly platform_version_id: string;
  readonly platform_version_tag: string | null;
  readonly platform_version_timestamp: string | null;
}

/** Returns null when the binding is absent (local tests, older configs). */
export function runtimeVersionReport(
  metadata: VersionMetadataBinding | undefined,
  deploymentUnit: string
): RuntimeVersionReport | null {
  if (!metadata || typeof metadata.id !== 'string' || metadata.id.length === 0) return null;
  return {
    deployment_unit: deploymentUnit,
    platform_version_id: metadata.id,
    platform_version_tag: metadata.tag ? metadata.tag : null,
    platform_version_timestamp: metadata.timestamp ? metadata.timestamp : null,
  };
}

/**
 * Emit the report as one structured Workers Logs event. Used where the
 * Worker has no HTTP surface (the dedicated paid-continuation host). Never throws and
 * returns nothing, so no caller can branch on it.
 */
export function emitRuntimeVersionEvent(env: object | undefined, deploymentUnit: string): void {
  try {
    const metadata = (env as { CF_VERSION_METADATA?: VersionMetadataBinding } | undefined)
      ?.CF_VERSION_METADATA;
    const report = runtimeVersionReport(metadata, deploymentUnit);
    console.info(
      JSON.stringify(
        report
          ? { event: RUNTIME_VERSION_EVENT, ...report }
          : {
              event: RUNTIME_VERSION_EVENT,
              deployment_unit: deploymentUnit,
              platform_version_id: null,
            }
      )
    );
  } catch {
    // Observation must never affect execution.
  }
}
