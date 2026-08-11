import { BUNDLED_SERVICE_INPUT_SCHEMAS, type SiteborneServiceId } from '@siteborne/protocol-x402';
import companyOutput from '../../../contracts/releases/1.0.0/schemas/services/company-evidence-output.schema.json' with { type: 'json' };
import webOutput from '../../../contracts/releases/1.0.0/schemas/services/web-context-output.schema.json' with { type: 'json' };
import documentOutput from '../../../contracts/releases/1.0.0/schemas/services/document-evidence-output.schema.json' with { type: 'json' };
import agentOutput from '../../../contracts/releases/1.0.0/schemas/services/agent-verification-output.schema.json' with { type: 'json' };
import pccSchema from '../../../contracts/releases/1.0.0/schemas/proof-carrying-context.schema.json' with { type: 'json' };
import moneySchema from '../../../contracts/releases/1.0.0/schemas/common/money.schema.json' with { type: 'json' };

const PCC_SCHEMA_ID = 'https://utility.siteborne.net/schemas/proof-carrying-context.schema.json';
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
    if (key === '$ref' && value === PCC_SCHEMA_ID) {
      result[key] = '#/$defs/pcc';
    } else if (key === '$ref' && value === MONEY_SCHEMA_ID) {
      result[key] = '#/$defs/money';
    } else {
      result[key] = bundlePccReference(value);
    }
  }
  return result;
}

function selfContainedOutputSchema(schema: unknown): unknown {
  const rewrittenPcc = rewritePccInternalRefs(pccSchema) as Record<string, unknown>;
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

export const MCP_SERVICE_OUTPUT_SCHEMAS: Readonly<Record<SiteborneServiceId, unknown>> = {
  'company_evidence_graph.v1': selfContainedOutputSchema(companyOutput),
  'web_context_verified.v1': selfContainedOutputSchema(webOutput),
  'document_evidence_json.v1': selfContainedOutputSchema(documentOutput),
  'verify_agent_output.v1': selfContainedOutputSchema(agentOutput),
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
};
