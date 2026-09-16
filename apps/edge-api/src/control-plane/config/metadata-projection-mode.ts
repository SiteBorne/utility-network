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
 * type (VCM-06 §V explicitly requires a four-value enum), but
 * `resolveAuthorizedMetadataProjectionMode` refuses to let either one
 * actually serve in this checkpoint (VCM-IMPL-04A §V/§XIV) -- the parser
 * recognizes the literal; the *authorization* gate is a separate, later
 * check, so a future checkpoint can lift the gate without touching the
 * parser or its four-literal type at all.
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
 * `legacy` and `shadow_compare` are the only modes this checkpoint may
 * ever exercise as *serving* behavior (VCM-IMPL-04A §V). `vcm_primary_
 * compare`/`vcm_only` are recognized upstream by the parser (the type
 * stays closed and four-valued per VCM-06) but are refused here with an
 * explicit, logged fallback to `legacy` rather than silently being treated
 * the same as an invalid string -- the distinction matters for a future
 * authorization-boundary checkpoint that only needs to change this one
 * function, not reintroduce the parser's closed enum.
 */
export function resolveAuthorizedMetadataProjectionMode(
  mode: MetadataProjectionMode,
  surface: MetadataProjectionSurface
): 'legacy' | 'shadow_compare' {
  if (mode === 'legacy' || mode === 'shadow_compare') return mode;
  console.error(
    JSON.stringify({
      event: 'metadata_projection_mode_not_yet_authorized',
      surface,
      requestedMode: mode,
      resolvedTo: 'legacy',
      reason: 'NOT_AUTHORIZED_IN_IMPL_04A',
    })
  );
  return 'legacy';
}
