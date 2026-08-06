#!/usr/bin/env node
// Generate OpenAPI 3.1 components and service contract document from canonical schemas

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
} from 'fs';
import { resolve, dirname, basename } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SCHEMAS_DIR = resolve(ROOT, 'schemas');
// Use environment variable for output directory, defaulting to committed path
const OPENAPI_OUTPUT_DIR = resolve(
  process.env.OPENAPI_OUTPUT_DIR || resolve(ROOT, 'packages/contracts/generated/openapi')
);

const COMMON_SCHEMAS = [
  'money.schema.json',
  'request-envelope.schema.json',
  'quote-request.schema.json',
  'quote-response.schema.json',
  'structured-error.schema.json',
  'service-metadata.schema.json',
  'async-job.schema.json',
  'pagination.schema.json',
  'authorized-artifact-reference.schema.json',
];

const SERVICE_SCHEMAS = [
  'company-evidence-input.schema.json',
  'company-evidence-output.schema.json',
  'web-context-input.schema.json',
  'web-context-output.schema.json',
  'document-evidence-input.schema.json',
  'document-evidence-output.schema.json',
  'agent-verification-input.schema.json',
  'agent-verification-output.schema.json',
];

const SERVICE_IDS = {
  'company-evidence-output': 'company_evidence_graph.v1',
  'web-context-output': 'web_context_verified.v1',
  'document-evidence-output': 'document_evidence_json.v1',
  'agent-verification-output': 'verify_agent_output.v1',
};

const SERVICE_TITLES = {
  'company-evidence-output': 'Company Evidence Graph',
  'web-context-output': 'Verified Web Context',
  'document-evidence-output': 'Document Evidence JSON',
  'agent-verification-output': 'Agent Output Verification',
};

const SERVICE_PATHS = {
  'company_evidence_graph.v1': '/v1/company/evidence-graph',
  'web_context_verified.v1': '/v1/web/context',
  'document_evidence_json.v1': '/v1/document/evidence-json',
  'verify_agent_output.v1': '/v1/verify/agent-output',
};

const SERVICE_OPERATIONS = {
  'company_evidence_graph.v1': 'companyEvidenceGraph',
  'web_context_verified.v1': 'webContextVerified',
  'document_evidence_json.v1': 'documentEvidenceJson',
  'verify_agent_output.v1': 'verifyAgentOutput',
};

function run(cmd: string, args: string[], cwd: string = ROOT): string {
  try {
    const quotedCmd = cmd.includes(' ') ? `"${cmd}"` : cmd;
    const quotedArgs = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg));
    const shellCmd = [quotedCmd, ...quotedArgs].join(' ');
    const result = execSync(shellCmd, { cwd, encoding: 'utf-8', stdio: 'pipe', shell: true });
    return result.toString().trim();
  } catch (e) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    throw e;
  }
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath: string, content: any): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(content, null, 2));
}

function sanitizeSchemaForOpenAPI(schema: any): any {
  const sanitized = JSON.parse(JSON.stringify(schema));

  // Remove $schema and $id as they're not valid in OpenAPI
  delete sanitized.$schema;
  delete sanitized.$id;
  delete sanitized.examples;

  // Recursively process definitions
  if (sanitized.definitions) {
    for (const key of Object.keys(sanitized.definitions)) {
      sanitized.definitions[key] = sanitizeSchemaForOpenAPI(sanitized.definitions[key]);
    }
  }

  // Process properties
  if (sanitized.properties) {
    for (const key of Object.keys(sanitized.properties)) {
      sanitized.properties[key] = sanitizeSchemaForOpenAPI(sanitized.properties[key]);
    }
  }

  // Process items
  if (sanitized.items) {
    sanitized.items = sanitizeSchemaForOpenAPI(sanitized.items);
  }

  // Process allOf, anyOf, oneOf
  for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
    if (sanitized[combinator]) {
      sanitized[combinator] = sanitized[combinator].map(sanitizeSchemaForOpenAPI);
    }
  }

  // Convert $ref from full URLs to local OpenAPI component references
  function convertRefs(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;

    if (obj.$ref && typeof obj.$ref === 'string') {
      const ref = obj.$ref;
      if (
        ref.startsWith('https://utility.siteborne.net/schemas/proof-carrying-context.schema.json')
      ) {
        return { $ref: '#/components/schemas/PCCDocument' };
      }
      if (ref.startsWith('https://siteborne.net/schemas/common/')) {
        const name = ref
          .replace('https://siteborne.net/schemas/common/', '')
          .replace('.schema.json', '');
        return { $ref: `#/components/schemas/${toPascalCase(name)}` };
      }
      if (ref.startsWith('https://siteborne.net/schemas/services/')) {
        const name = ref
          .replace('https://siteborne.net/schemas/services/', '')
          .replace('.schema.json', '');
        return { $ref: `#/components/schemas/${toPascalCase(name)}` };
      }
      if (ref.startsWith('https://utility.siteborne.net/schemas/')) {
        const name = ref
          .replace('https://utility.siteborne.net/schemas/', '')
          .replace('.schema.json', '');
        return { $ref: `#/components/schemas/${toPascalCase(name)}` };
      }
    }

    for (const key of Object.keys(obj)) {
      obj[key] = convertRefs(obj[key]);
    }
    return obj;
  }

  return convertRefs(sanitized);
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function generateCommonComponents(): any {
  const components: any = { schemas: {} };

  // Load and sanitize each common schema
  for (const schemaFile of COMMON_SCHEMAS) {
    const schemaPath = resolve(SCHEMAS_DIR, 'common', schemaFile);
    const schema = readJson(schemaPath);
    const name = toPascalCase(schemaFile.replace('.schema.json', ''));
    components.schemas[name] = sanitizeSchemaForOpenAPI(schema);
  }

  // Add PCC schema
  const pccPath = resolve(SCHEMAS_DIR, 'proof-carrying-context.schema.json');
  const pccSchema = readJson(pccPath);
  components.schemas.PCCDocument = sanitizeSchemaForOpenAPI(pccSchema);

  return components;
}

function generateServiceComponents(): any {
  const components: any = { schemas: {} };

  for (const schemaFile of SERVICE_SCHEMAS) {
    const schemaPath = resolve(SCHEMAS_DIR, 'services', schemaFile);
    const schema = readJson(schemaPath);
    const name = toPascalCase(schemaFile.replace('.schema.json', ''));
    components.schemas[name] = sanitizeSchemaForOpenAPI(schema);
  }

  return components;
}

function generateServiceContractsOpenAPI(): any {
  const openapi = {
    openapi: '3.1.0',
    info: {
      title: 'SITEBORNE Utility Network Service Contracts',
      version: '1.0.0-preproduction',
      description:
        'Preproduction OpenAPI document for SITEBORNE Utility Network service contracts. No routes are currently enabled. All operations marked as not implemented.',
    },
    servers: [
      {
        url: 'https://utility.siteborne.net',
        description: 'Preproduction server (not currently deployed)',
      },
    ],
    paths: {},
    components: {
      schemas: {},
    },
  };

  // Add common and service schemas to components
  const commonComponents = generateCommonComponents();
  const serviceComponents = generateServiceComponents();

  openapi.components.schemas = {
    ...commonComponents.schemas,
    ...serviceComponents.schemas,
  };

  // Add quote request/response schemas
  openapi.components.schemas.QuoteRequest = openapi.components.schemas.QuoteRequest;
  openapi.components.schemas.QuoteResponse = openapi.components.schemas.QuoteResponse;
  openapi.components.schemas.StructuredError = openapi.components.schemas.StructuredError;

  // Generate paths for each service
  for (const [serviceId, path] of Object.entries(SERVICE_PATHS)) {
    const operationId = SERVICE_OPERATIONS[serviceId];
    const outputSchemaName = toPascalCase(serviceId.replace('.v1', '-output'));
    const inputSchemaName = toPascalCase(serviceId.replace('.v1', '-input'));

    openapi.paths[path] = {
      post: {
        operationId: `post${operationId}`,
        summary: `Execute ${SERVICE_TITLES[outputSchemaName.toLowerCase()]} service`,
        description: `Service contract for ${serviceId}. Not currently implemented - preproduction contract only.`,
        'x-service-id': serviceId,
        'x-production-enabled': false,
        'x-implementation-status': 'not_implemented',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/${inputSchemaName}`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${outputSchemaName}`,
                },
              },
            },
          },
          '400': {
            description: 'Invalid input',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StructuredError' },
              },
            },
          },
          '402': {
            description: 'Payment required',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StructuredError' },
              },
            },
          },
          '500': {
            description: 'Internal server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StructuredError' },
              },
            },
          },
        },
      },
    };
  }

  // Add quote endpoint
  openapi.paths['/quotes/{service_id}'] = {
    post: {
      operationId: 'postQuote',
      summary: 'Request a quote for a service',
      description:
        'Returns a quote for the specified service. Not currently implemented - preproduction contract only.',
      'x-production-enabled': false,
      'x-implementation-status': 'not_implemented',
      parameters: [
        {
          name: 'service_id',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            enum: Object.keys(SERVICE_PATHS),
          },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/QuoteRequest' },
          },
        },
      },
      responses: {
        '200': {
          description: 'Quote response',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/QuoteResponse' },
            },
          },
        },
        '400': {
          description: 'Invalid input',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StructuredError' },
            },
          },
        },
        '404': {
          description: 'Service not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StructuredError' },
            },
          },
        },
      },
    },
  };

  return openapi;
}

function main() {
  console.log('=== OpenAPI Generation ===\n');

  // Clean output directory
  if (existsSync(OPENAPI_OUTPUT_DIR)) {
    rmSync(OPENAPI_OUTPUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OPENAPI_OUTPUT_DIR, { recursive: true });

  // Generate common components
  console.log('Generating common components...');
  const commonComponents = generateCommonComponents();
  writeJson(resolve(OPENAPI_OUTPUT_DIR, 'common-components.json'), commonComponents);
  console.log(`  Generated: ${OPENAPI_OUTPUT_DIR}/common-components.json`);

  // Generate service components
  console.log('Generating service components...');
  const serviceComponents = generateServiceComponents();
  writeJson(resolve(OPENAPI_OUTPUT_DIR, 'service-components.json'), serviceComponents);
  console.log(`  Generated: ${OPENAPI_OUTPUT_DIR}/service-components.json`);

  // Generate combined service contracts OpenAPI document
  console.log('Generating combined service contracts OpenAPI...');
  const serviceContracts = generateServiceContractsOpenAPI();
  writeJson(resolve(OPENAPI_OUTPUT_DIR, 'service-contracts.openapi.json'), serviceContracts);
  console.log(`  Generated: ${OPENAPI_OUTPUT_DIR}/service-contracts.openapi.json`);

  console.log('\n✓ OpenAPI generation complete');
}

main();
