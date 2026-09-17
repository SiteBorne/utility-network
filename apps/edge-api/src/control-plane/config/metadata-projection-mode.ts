/**
 * METADATA-VCM-06 §V-§VII, implemented per METADATA-VCM-IMPL-04A. Two
 * independent per-surface closed enums, not a shared boolean -- A2A and
 * MCP have unrelated blast radii and must be independently rollback-able
 * (VCM-06 §V/§VI). One strict allow-list parser shared by both call sites,
 * so there is exactly one place that can ever produce a value outside the
 * four literals -- mirroring the existing exact-string-match discipline
 * already used for `MTLS_PRODUCTION_ACTIVE` (`mtls-production-capability.ts`)
 * rather than inventing a new parsing convention.
 *
 * `vcm_primary_compare` and `vcm_only` are real members of this closed
 * type (VCM-06 §V explicitly requires a four-value enum). The separate
 * authorization gate permits the independently compared primary mode while
 * continuing to refuse `vcm_only`, without weakening this parser.
 */
export const METADATA_PROJECTION_MODES = [
  'legacy',
  'shadow_compare',
  'vcm_primary_compare',
  'vcm_only',
] as const;

export type MetadataProjectionMode = (typeof METADATA_PROJECTION_MODES)[number];

export type MetadataProjectionSurface = 'a2a' | 'mcp';

const MODE_SET = new Set<string>(METADATA_PROJECTION_MODES);

function isMetadataProjectionMode(value: string): value is MetadataProjectionMode {
  return MODE_SET.has(value);
}

/**
 * `undefined`/`''`/any string not exactly one of the four literals
 * (including a case-mismatch or a boolean-shaped typo like `"true"`) fails
 * safe to `'legacy'` and logs one structured `console.error` line naming
 * the surface and the invalid raw value -- visible in platform logs
 * without ever being able to escalate serving behavior (VCM-06 §VII).
 */
export function parseMetadataProjectionMode(
  raw: string | undefined,
  surface: MetadataProjectionSurface
): MetadataProjectionMode {
  if (raw === undefined || raw === '') return 'legacy';
  if (isMetadataProjectionMode(raw)) return raw;
  console.error(
    JSON.stringify({
      event: 'metadata_projection_mode_invalid',
      surface,
      rawValue: raw,
      resolvedTo: 'legacy',
    })
  );
  return 'legacy';
}

/**
 * `legacy`, `shadow_compare`, and `vcm_primary_compare` are authorized.
 * `vcm_only` remains structurally refused with an explicit logged fallback
 * to `legacy`; parity qualification never authorizes sole VCM serving.
 */
export function resolveAuthorizedMetadataProjectionMode(
  mode: MetadataProjectionMode,
  surface: MetadataProjectionSurface
): 'legacy' | 'shadow_compare' | 'vcm_primary_compare' {
  if (mode !== 'vcm_only') return mode;
  console.error(
    JSON.stringify({
      event: 'metadata_projection_mode_not_yet_authorized',
      surface,
      requestedMode: mode,
      resolvedTo: 'legacy',
      reason: 'VCM_ONLY_NOT_AUTHORIZED',
    })
  );
  return 'legacy';
}
