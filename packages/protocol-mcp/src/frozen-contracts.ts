import { BUNDLED_SERVICE_INPUT_SCHEMAS, type SiteborneServiceId } from '@siteborne/protocol-x402';
// SUN-1222C-MCP-PAYMENT-DESIGN-CORRECTION §17: sourced from the accepted
// 2.0.0 release, not 1.0.0. Real production v2 executors already emit
// results under contractRelease '2.0.0' (see e.g.
// company-evidence-graph-v2-production-executor.ts). 2.0.0's only
// difference from 1.0.0 is that `contract.service_id` /
// `contract.service_version` are widened from a `const` fixed to the v1
// value to an `enum` covering both v1 and v2 — every other constraint is
// byte-identical. Sourcing v2 entries from 1.0.0 made every genuine v2
// result schema-invalid (a v2 identity value can never satisfy a v1-only
// `const`), which is exactly the defect this fixes; v1 entries are
// unaffected (1.0.0 and 2.0.0 validate v1-identified results identically).
import companyOutput from '../../../contracts/releases/2.0.0/schemas/services/company-evidence-output.schema.json' with { type: 'json' };
import webOutput from '../../../contracts/releases/2.0.0/schemas/services/web-context-output.schema.json' with { type: 'json' };
import documentOutput from '../../../contracts/releases/2.0.0/schemas/services/document-evidence-output.schema.json' with { type: 'json' };
import agentOutput from '../../../contracts/releases/2.0.0/schemas/services/agent-verification-output.schema.json' with { type: 'json' };
import pccSchema from '../../../contracts/releases/2.0.0/schemas/proof-carrying-context.schema.json' with { type: 'json' };
import companyOutputV3 from '../../../contracts/releases/3.0.0/schemas/services/company-evidence-output.schema.json' with { type: 'json' };
import webOutputV3 from '../../../contracts/releases/3.0.0/schemas/services/web-context-output.schema.json' with { type: 'json' };
import documentOutputV3 from '../../../contracts/releases/3.0.0/schemas/services/document-evidence-output.schema.json' with { type: 'json' };
import agentOutputV3 from '../../../contracts/releases/3.0.0/schemas/services/agent-verification-output.schema.json' with { type: 'json' };
import pccSchemaV3 from '../../../contracts/releases/3.0.0/schemas/proof-carrying-context.schema.json' with { type: 'json' };
import moneySchema from '../../../contracts/releases/1.0.0/schemas/common/money.schema.json' with { type: 'json' };

const PCC_SCHEMA_IDS = new Set([
  'https://utility.siteborne.net/schemas/proof-carrying-context.schema.json',
  'https://utility.siteborne.net/contracts/3.0.0/schemas/proof-carrying-context.schema.json',
]);
const MONEY_SCHEMA_ID = 'https://siteborne.net/schemas/common/money.schema.json';

function rewritePccInternalRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewritePccInternalRefs);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] =
      key === '$ref' && typeof child === 'string' && child.startsWith('#/')
        ? `#/$defs/pcc/${child.slice(2)}`
        : rewritePccInternalRefs(child);
  }
  return result;
}

function bundlePccReference(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(bundlePccReference);
  if (schema === null || typeof schema !== 'object') return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string' && PCC_SCHEMA_IDS.has(value)) {
      result[key] = '#/$defs/pcc';
    } else if (key === '$ref' && value === MONEY_SCHEMA_ID) {
      result[key] = '#/$defs/money';
    } else {
      result[key] = bundlePccReference(value);
    }
  }
  return result;
}

function selfContainedOutputSchema(schema: unknown, pcc: unknown = pccSchema): unknown {
  const rewrittenPcc = rewritePccInternalRefs(pcc) as Record<string, unknown>;
  const { $id: _pccId, $schema: _pccDialect, ...embeddedPcc } = rewrittenPcc;
  const { $id: _moneyId, $schema: _moneyDialect, ...embeddedMoney } = moneySchema;
  void _pccId;
  void _pccDialect;
  void _moneyId;
  void _moneyDialect;
  return {
    ...(bundlePccReference(schema) as Record<string, unknown>),
    $defs: { pcc: embeddedPcc, money: embeddedMoney },
  };
}

export const MCP_SERVICE_INPUT_SCHEMAS = BUNDLED_SERVICE_INPUT_SCHEMAS;

// SUN-1000 checkpoint 1M: v2 entries reuse the identical frozen output
// schema object — output semantics are unchanged (checkpoint 1L section 7).
// The schema object itself is the 2.0.0 release (see the import comment
// above), which is the one that actually accepts a v2-identified result.
export const MCP_SERVICE_OUTPUT_SCHEMAS: Readonly<Record<SiteborneServiceId, unknown>> = {
  'company_evidence_graph.v1': selfContainedOutputSchema(companyOutput),
  'web_context_verified.v1': selfContainedOutputSchema(webOutput),
  'document_evidence_json.v1': selfContainedOutputSchema(documentOutput),
  'verify_agent_output.v1': selfContainedOutputSchema(agentOutput),
  'company_evidence_graph.v2': selfContainedOutputSchema(companyOutput),
  'web_context_verified.v2': selfContainedOutputSchema(webOutput),
  'document_evidence_json.v2': selfContainedOutputSchema(documentOutput),
  'verify_agent_output.v2': selfContainedOutputSchema(agentOutput),
  'company_evidence_graph.v3': selfContainedOutputSchema(companyOutputV3, pccSchemaV3),
  'web_context_verified.v3': selfContainedOutputSchema(webOutputV3, pccSchemaV3),
  'document_evidence_json.v3': selfContainedOutputSchema(documentOutputV3, pccSchemaV3),
  'verify_agent_output.v3': selfContainedOutputSchema(agentOutputV3, pccSchemaV3),
};

export const MCP_SERVICE_SCHEMA_METADATA: Readonly<
  Record<SiteborneServiceId, { input_uri: string; output_uri: string }>
> = {
  'company_evidence_graph.v1': {
    input_uri: 'https://siteborne.net/schemas/services/company-evidence-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/company-evidence-output.schema.json',
  },
  'web_context_verified.v1': {
    input_uri: 'https://siteborne.net/schemas/services/web-context-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/web-context-output.schema.json',
  },
  'document_evidence_json.v1': {
    input_uri: 'https://siteborne.net/schemas/services/document-evidence-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/document-evidence-output.schema.json',
  },
  'verify_agent_output.v1': {
    input_uri: 'https://siteborne.net/schemas/services/agent-verification-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/agent-verification-output.schema.json',
  },
  'company_evidence_graph.v2': {
    input_uri: 'https://siteborne.net/schemas/services/company-evidence-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/company-evidence-output.schema.json',
  },
  'web_context_verified.v2': {
    input_uri: 'https://siteborne.net/schemas/services/web-context-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/web-context-output.schema.json',
  },
  'document_evidence_json.v2': {
    input_uri: 'https://siteborne.net/schemas/services/document-evidence-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/document-evidence-output.schema.json',
  },
  'verify_agent_output.v2': {
    input_uri: 'https://siteborne.net/schemas/services/agent-verification-input.schema.json',
    output_uri: 'https://siteborne.net/schemas/services/agent-verification-output.schema.json',
  },
  'company_evidence_graph.v3': {
    input_uri: 'https://siteborne.net/schemas/services/company-evidence-input.schema.json',
    output_uri:
      'https://utility.siteborne.net/contracts/3.0.0/schemas/services/company-evidence-output.schema.json',
  },
  'web_context_verified.v3': {
    input_uri: 'https://siteborne.net/schemas/services/web-context-input.schema.json',
    output_uri:
      'https://utility.siteborne.net/contracts/3.0.0/schemas/services/web-context-output.schema.json',
  },
  'document_evidence_json.v3': {
    input_uri: 'https://siteborne.net/schemas/services/document-evidence-input.schema.json',
    output_uri:
      'https://utility.siteborne.net/contracts/3.0.0/schemas/services/document-evidence-output.schema.json',
  },
  'verify_agent_output.v3': {
    input_uri: 'https://siteborne.net/schemas/services/agent-verification-input.schema.json',
    output_uri:
      'https://utility.siteborne.net/contracts/3.0.0/schemas/services/agent-verification-output.schema.json',
  },
};
