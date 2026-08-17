/**
 * Statically imports SITEBORNE's frozen contract input schemas
 * (`contracts/releases/1.0.0/schemas/...`, `@siteborne/contracts`'
 * source of truth) and bundles each into a self-contained,
 * `$ref`-free JSON Schema for Bazaar discovery (directive §7, §14).
 *
 * These are ES module JSON imports (`resolveJsonModule`), resolved and
 * inlined at build/transform time by the bundler — never a runtime
 * `fs.readFileSync` (this package may run inside a Cloudflare Worker,
 * which has no filesystem). `bundleLocalRefs` (schema-bundle.ts) never
 * mutates the imported JSON; it returns new objects.
 *
 * Directive §14/§9: never a simplified/diverging schema — every bundled
 * schema is the frozen contract schema itself with only its local `$ref`s
 * inlined, proven identical-modulo-refs in frozen-inputs.test.ts.
 */
import companyEvidenceInputSchema from '../../../../contracts/releases/1.0.0/schemas/services/company-evidence-input.schema.json' with { type: 'json' };
import webContextInputSchema from '../../../../contracts/releases/1.0.0/schemas/services/web-context-input.schema.json' with { type: 'json' };
import documentEvidenceInputSchema from '../../../../contracts/releases/1.0.0/schemas/services/document-evidence-input.schema.json' with { type: 'json' };
import agentVerificationInputSchema from '../../../../contracts/releases/1.0.0/schemas/services/agent-verification-input.schema.json' with { type: 'json' };
import companyEvidenceOutputSchema from '../../../../contracts/releases/1.0.0/schemas/services/company-evidence-output.schema.json' with { type: 'json' };
import webContextOutputSchema from '../../../../contracts/releases/1.0.0/schemas/services/web-context-output.schema.json' with { type: 'json' };
import documentEvidenceOutputSchema from '../../../../contracts/releases/1.0.0/schemas/services/document-evidence-output.schema.json' with { type: 'json' };
import agentVerificationOutputSchema from '../../../../contracts/releases/1.0.0/schemas/services/agent-verification-output.schema.json' with { type: 'json' };
import moneySchema from '../../../../contracts/releases/1.0.0/schemas/common/money.schema.json' with { type: 'json' };
import authorizedArtifactReferenceSchema from '../../../../contracts/releases/1.0.0/schemas/common/authorized-artifact-reference.schema.json' with { type: 'json' };
import type { SiteborneServiceId } from '../types';
import { bundleLocalRefs } from './schema-bundle';

/** Keyed by each common schema's own `$id` — the exact string every
 * frozen input schema's `$ref` uses. */
const COMMON_SCHEMA_REF_MAP: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  [(moneySchema as { $id: string }).$id]: moneySchema as Record<string, unknown>,
  [(authorizedArtifactReferenceSchema as { $id: string }).$id]:
    authorizedArtifactReferenceSchema as Record<string, unknown>,
};

/** The frozen, unmodified schema JSON this module bundles from — exposed
 * for tests that must prove the bundled output is the source schema with
 * only `$ref`s inlined (never a diverging copy). */
export const FROZEN_SERVICE_INPUT_SCHEMAS: Readonly<Record<SiteborneServiceId, unknown>> = {
  'company_evidence_graph.v1': companyEvidenceInputSchema,
  'web_context_verified.v1': webContextInputSchema,
  'document_evidence_json.v1': documentEvidenceInputSchema,
  'verify_agent_output.v1': agentVerificationInputSchema,
  // SUN-1000 checkpoint 1M: v2 reuses the identical frozen input schema
  // objects — request semantics are unchanged by the v2 migration
  // (checkpoint 1L section 7); only the wrapping service-major identity
  // and the 400/402 error contract differ.
  'company_evidence_graph.v2': companyEvidenceInputSchema,
  'web_context_verified.v2': webContextInputSchema,
  'document_evidence_json.v2': documentEvidenceInputSchema,
  'verify_agent_output.v2': agentVerificationInputSchema,
};

/** Self-contained (`$ref`-free) input schemas ready to hand to the
 * official `declareDiscoveryExtension`'s `inputSchema` field. */
export const BUNDLED_SERVICE_INPUT_SCHEMAS: Readonly<Record<SiteborneServiceId, unknown>> =
  Object.fromEntries(
    Object.entries(FROZEN_SERVICE_INPUT_SCHEMAS).map(([serviceId, schema]) => [
      serviceId,
      bundleLocalRefs(schema, COMMON_SCHEMA_REF_MAP),
    ])
  ) as Record<SiteborneServiceId, unknown>;

/** The frozen output schemas — kept unbundled (directive §7's "output
 * example/schema where appropriate"). Each `$ref`s
 * `proof-carrying-context.schema.json`, a large, separately-owned,
 * internally-self-referencing (55 `$ref`s) contract schema; bundling it
 * into every service's Bazaar declaration is out of scope for this
 * checkpoint. Only each output schema's own frozen `examples[0]` is used
 * below — never the schema itself — so this limitation never produces an
 * unresolved `$ref` in emitted Bazaar output (docs/operations/
 * X402_BAZAAR_METADATA.md records this explicitly, per directive §13's
 * "record the limitation" instruction). */
const FROZEN_SERVICE_OUTPUT_SCHEMAS: Readonly<Record<SiteborneServiceId, unknown>> = {
  'company_evidence_graph.v1': companyEvidenceOutputSchema,
  'web_context_verified.v1': webContextOutputSchema,
  'document_evidence_json.v1': documentEvidenceOutputSchema,
  'verify_agent_output.v1': agentVerificationOutputSchema,
  // SUN-1000 checkpoint 1M: v2 reuses the identical frozen output schema
  // objects — success-response semantics are unchanged (checkpoint 1L
  // section 7).
  'company_evidence_graph.v2': companyEvidenceOutputSchema,
  'web_context_verified.v2': webContextOutputSchema,
  'document_evidence_json.v2': documentEvidenceOutputSchema,
  'verify_agent_output.v2': agentVerificationOutputSchema,
};

/** Each frozen input schema's own first `examples[]` entry — a
 * deterministic, non-sensitive, frozen-schema-valid example (directive
 * §15), never a SITEBORNE-invented one. Fails closed (throws) if a
 * service's schema has no example, rather than silently omitting one. */
export function frozenInputExample(serviceId: SiteborneServiceId): unknown {
  return firstExample(FROZEN_SERVICE_INPUT_SCHEMAS[serviceId], serviceId, 'input');
}

/** Each frozen output schema's own first `examples[]` entry — see the
 * module-level comment above for why the output *schema* itself is not
 * bundled/embedded, only this example. */
export function frozenOutputExample(serviceId: SiteborneServiceId): unknown {
  return firstExample(FROZEN_SERVICE_OUTPUT_SCHEMAS[serviceId], serviceId, 'output');
}

function firstExample(schema: unknown, serviceId: SiteborneServiceId, kind: string): unknown {
  const example = (schema as { examples?: unknown[] }).examples?.[0];
  if (example === undefined) {
    throw new Error(
      `frozen ${kind} schema for "${serviceId}" has no examples[0] — cannot derive a Bazaar discovery example`
    );
  }
  return example;
}
