/**
 * Runtime (Worker-safe) bootstrap for the VCM effective view
 * (METADATA-VCM-IMPL-04A). `legacyRegistryToVCM()` is a pure function of an
 * already-parsed `LegacyRegistryServiceFile[]` -- it does no I/O itself.
 * Everywhere else this repository needs registry/governance content inside
 * a Cloudflare Worker (no `node:fs`), it either reads via `node:fs` in a
 * Node-only context (this package's own registry-parity tests) or keeps a
 * hand-maintained embedded literal mirror validated in CI (`@siteborne/
 * pricing`'s `EMBEDDED_PRICING`). A hand-maintained mirror of eight full
 * registry documents would itself become a ninth, drift-prone copy of the
 * exact content this whole effort exists to stop duplicating.
 *
 * A static ES module JSON import has neither problem: `resolveJsonModule`
 * (tsconfig.base.json) plus every bundler in this repo's pipeline (Vite/
 * Vitest for tests, esbuild via Wrangler for the deployed Worker) inlines
 * the referenced file's real bytes at build time. There is no runtime `fs`
 * call, no fallback path to keep in sync, and no second copy to drift --
 * the compiled artifact's registry content IS the file at
 * `registry/services/*.json`, not a mirror of it.
 *
 * The resulting `CanonicalStaticModel`/`EffectiveMetadataView` is pure,
 * env-independent, and memoized once per isolate (module-level, exactly
 * like `routes/a2a.ts`'s own `cachedA2aAppPromise`) -- steady-state cost
 * after the first call in a given isolate is zero.
 */
import companyEvidenceGraphV1 from '../../../registry/services/company_evidence_graph.v1.json';
import companyEvidenceGraphV2 from '../../../registry/services/company_evidence_graph.v2.json';
import companyEvidenceGraphV3 from '../../../registry/services/company_evidence_graph.v3.json';
import documentEvidenceJsonV1 from '../../../registry/services/document_evidence_json.v1.json';
import documentEvidenceJsonV2 from '../../../registry/services/document_evidence_json.v2.json';
import documentEvidenceJsonV3 from '../../../registry/services/document_evidence_json.v3.json';
import verifyAgentOutputV1 from '../../../registry/services/verify_agent_output.v1.json';
import verifyAgentOutputV2 from '../../../registry/services/verify_agent_output.v2.json';
import verifyAgentOutputV3 from '../../../registry/services/verify_agent_output.v3.json';
import webContextVerifiedV1 from '../../../registry/services/web_context_verified.v1.json';
import webContextVerifiedV2 from '../../../registry/services/web_context_verified.v2.json';
import webContextVerifiedV3 from '../../../registry/services/web_context_verified.v3.json';
import { legacyRegistryToVCM } from './legacy/import-registry';
import type { LegacyRegistryServiceFile } from './legacy/types';
import { project, type EffectiveMetadataView } from './effective-view';
import { emptyOverlay } from './runtime-overlay';

/** Sorted the same way the registry-parity test suite sorts its own
 * filesystem read (`readdirSync(...).sort()`), so a runtime-model digest
 * is comparable against a filesystem-derived one built from the same
 * commit -- not required for correctness (the importer itself re-sorts by
 * service id), but keeps the two loading paths visibly equivalent. */
const RUNTIME_REGISTRY_FILES: readonly LegacyRegistryServiceFile[] = [
  companyEvidenceGraphV1,
  companyEvidenceGraphV2,
  companyEvidenceGraphV3,
  documentEvidenceJsonV1,
  documentEvidenceJsonV2,
  documentEvidenceJsonV3,
  verifyAgentOutputV1,
  verifyAgentOutputV2,
  verifyAgentOutputV3,
  webContextVerifiedV1,
  webContextVerifiedV2,
  webContextVerifiedV3,
] as unknown as readonly LegacyRegistryServiceFile[];

export const VCM_SCHEMA_VERSION = '0.3.0';
/** SemVer fed to `legacyRegistryToVCM` -- distinct from the human-readable
 * `VCM_RELEASE_VERSION` label below, which documents that no qualified
 * candidate has ever been released (METADATA-VCM-IMPL-01 §"shadow
 * implementation"), not a parseable version number. */
const VCM_RELEASE_SEMVER = '0.1.0';
export const VCM_RELEASE_VERSION = 'intentionally-unreleased';

let cachedEffectiveView: Promise<EffectiveMetadataView> | undefined;
let cachedForRuntimeSourceCommit: string | undefined;

/**
 * Builds (once per isolate, per distinct `runtimeSourceCommit`) the
 * static-only `EffectiveMetadataView` -- an `emptyOverlay` narrows every
 * runtime-dependent fact to disabled/`UNKNOWN`, which is correct here: the
 * only domain METADATA-VCM-IMPL-03B proved parity for, and the only one
 * this checkpoint's shadow comparison uses, is `STATIC_SEMANTIC_CONTENT`
 * (Master Reference / METADATA-VCM-06 §X). Callers needing
 * `EFFECTIVE_RUNTIME_CONTENT` facts (e.g. whether mTLS is truthfully
 * declarable) supply those separately via each projection's own context
 * object, exactly as the real A2A/MCP builders already receive them as
 * plain parameters rather than reading them from a shared model.
 */
export function getRuntimeEffectiveView(
  runtimeSourceCommit: string
): Promise<EffectiveMetadataView> {
  if (cachedEffectiveView && cachedForRuntimeSourceCommit === runtimeSourceCommit) {
    return cachedEffectiveView;
  }
  cachedForRuntimeSourceCommit = runtimeSourceCommit;
  cachedEffectiveView = (async () => {
    const compiledAt = new Date().toISOString();
    const model = await legacyRegistryToVCM(RUNTIME_REGISTRY_FILES, {
      runtimeSourceCommit,
      compiledAt,
      vcmSchemaVersion: VCM_SCHEMA_VERSION,
      vcmReleaseVersion: VCM_RELEASE_SEMVER,
    });
    return project(model, emptyOverlay(compiledAt as never), { generatedAt: compiledAt as never });
  })();
  return cachedEffectiveView;
}

/** Test-only: forces the next `getRuntimeEffectiveView` call to rebuild
 * rather than reuse the isolate-scoped cache. Production code never calls
 * this -- a real isolate is torn down and replaced by the platform, never
 * asked to forget its own cache. */
export function resetRuntimeEffectiveViewCacheForTests(): void {
  cachedEffectiveView = undefined;
  cachedForRuntimeSourceCommit = undefined;
}
