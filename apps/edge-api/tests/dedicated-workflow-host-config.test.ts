/**
 * SUN-1221E6R-H2BF4 — proves the public API Worker's `wrangler.toml`
 * `[[workflows]]` binding is genuinely cross-script (points at the
 * dedicated Workflow-host script, not this same Worker), and that the
 * dedicated host's own `wrangler.paid-continuation-runtime.toml` is a
 * valid, minimal, self-hosted Workflow config.
 *
 * Deliberately plain-text block extraction (this repo has no TOML parser
 * dependency, and `wrangler.toml` files elsewhere in this repo are always
 * read/reasoned about as text, never parsed structurally) rather than
 * pulling in a new dependency for one test file. `extractTableBlock`
 * below finds the `[[workflows]]` (or `[vars]`/etc.) table by its own
 * header line and returns everything up to the next top-level `[`
 * header or EOF — robust to comment lines and key ordering, not to a
 * key appearing inside a *different* table with the same name (not a
 * risk here: `wrangler.toml`'s schema allows at most one `[[workflows]]`
 * array-of-tables per file for this repo's usage, confirmed by grep).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const PUBLIC_WRANGLER_TOML = join(REPO_ROOT, 'wrangler.toml');
const HOST_WRANGLER_TOML = join(REPO_ROOT, 'wrangler.paid-continuation-runtime.toml');

const WORKFLOW_HOST_SCRIPT_NAME = 'siteborne-paid-continuation-runtime';
const WORKFLOW_RESOURCE_NAME = 'siteborne-paid-continuation';
const WORKFLOW_CLASS_NAME = 'PaidContinuationWorkflow';

/** Strips `#`-comment lines (this file's own prose freely mentions things
 * like `[[routes]]`/`script_name` for explanatory purposes -- assertions
 * about actual CONFIGURATION must never match inside a comment). */
function stripComments(tomlText: string): string {
  return tomlText
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
}

function extractTableBlock(tomlText: string, headerLine: string): string {
  const lines = tomlText.split('\n');
  const startIdx = lines.findIndex((l) => l.trim() === headerLine);
  if (startIdx === -1) {
    throw new Error(`table header ${JSON.stringify(headerLine)} not found`);
  }
  const rest = lines.slice(startIdx + 1);
  const endOffset = rest.findIndex((l) => /^\s*\[/.test(l));
  const block = endOffset === -1 ? rest : rest.slice(0, endOffset);
  return block.join('\n');
}

describe('SUN-1221E6R-H2BF4 cross-script Workflow binding (public API Worker)', () => {
  const tomlText = readFileSync(PUBLIC_WRANGLER_TOML, 'utf-8');
  const workflowsBlock = extractTableBlock(tomlText, '[[workflows]]');

  it('CROSS_SCRIPT_BINDING_GREEN: declares script_name pointing at the dedicated Workflow-host script', () => {
    // This is the exact assertion that was RED against this repository's
    // pre-H2BF4 `wrangler.toml` (verified this checkpoint by temporarily
    // reverting this file to its H2BF3 HEAD state via `git stash` and
    // re-running this suite: the same-script config has no `script_name`
    // key in this block at all, so this regex never matches — see
    // docs/reports/SUN-1221E6R-H2BF4-dedicated-workflow-host-local-
    // qualification.md §TDD for the full RED/GREEN transcript).
    const scriptNameMatch = workflowsBlock.match(/^\s*script_name\s*=\s*"([^"]+)"/m);
    expect(scriptNameMatch, `[[workflows]] block:\n${workflowsBlock}`).not.toBeNull();
    expect(scriptNameMatch?.[1]).toBe(WORKFLOW_HOST_SCRIPT_NAME);
  });

  it('preserves the existing Workflow resource name, binding, and class_name unchanged', () => {
    expect(workflowsBlock).toMatch(new RegExp(`name\\s*=\\s*"${WORKFLOW_RESOURCE_NAME}"`));
    expect(workflowsBlock).toMatch(/binding\s*=\s*"PAID_CONTINUATION_WORKFLOW"/);
    expect(workflowsBlock).toMatch(new RegExp(`class_name\\s*=\\s*"${WORKFLOW_CLASS_NAME}"`));
  });

  it('the public API Worker does not import or export PaidContinuationWorkflow from its own main entrypoint (H2BF4 §"remove ambiguous same-script ownership")', () => {
    const indexTs = readFileSync(
      join(REPO_ROOT, 'apps/edge-api/src/index.ts'),
      'utf-8'
    );
    // Doc-comment prose is allowed to reference the class name to explain
    // WHY it was removed (see the doc comment above the [[workflows]]
    // config itself) -- the actual gate is: no `import`/`export` statement
    // naming it, and no bare identifier reference outside a `//`/`/* */`
    // comment.
    expect(indexTs).not.toMatch(/\bimport\b[^\n]*PaidContinuationWorkflow/);
    expect(indexTs).not.toMatch(/\bexport\b[^\n]*PaidContinuationWorkflow/);
    const codeOnly = indexTs
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n');
    expect(codeOnly).not.toContain('PaidContinuationWorkflow');
  });
});

describe('SUN-1221E6R-H2BF4 dedicated Workflow-host wrangler config', () => {
  it('HOST_WORKFLOW_CONFIG_VALID: the host config file exists', () => {
    expect(existsSync(HOST_WRANGLER_TOML)).toBe(true);
  });

  const tomlText = readFileSync(HOST_WRANGLER_TOML, 'utf-8');

  it('declares the dedicated host script name and its own entrypoint file', () => {
    expect(tomlText).toMatch(new RegExp(`^name\\s*=\\s*"${WORKFLOW_HOST_SCRIPT_NAME}"`, 'm'));
    expect(tomlText).toMatch(/^main\s*=\s*"apps\/edge-api\/src\/workflow-host-entrypoint\.ts"/m);
    expect(existsSync(join(REPO_ROOT, 'apps/edge-api/src/workflow-host-entrypoint.ts'))).toBe(true);
  });

  it('self-hosts the Workflow (name + class_name present, no script_name -- the class lives in this same script)', () => {
    const workflowsBlock = extractTableBlock(tomlText, '[[workflows]]');
    expect(workflowsBlock).toMatch(new RegExp(`name\\s*=\\s*"${WORKFLOW_RESOURCE_NAME}"`));
    expect(workflowsBlock).toMatch(new RegExp(`class_name\\s*=\\s*"${WORKFLOW_CLASS_NAME}"`));
    expect(workflowsBlock).not.toMatch(/script_name/);
  });

  it('WORKFLOW_RUNTIME_WORKERS_DEV=DISABLED, no routes, no custom domains, no cron triggers', () => {
    const configOnly = stripComments(tomlText);
    expect(configOnly).toMatch(/^workers_dev\s*=\s*false/m);
    expect(configOnly).not.toMatch(/^\s*routes\s*=/m);
    expect(configOnly).not.toMatch(/\[\[routes\]\]/);
    expect(configOnly).not.toMatch(/\[triggers\]/);
    expect(configOnly).not.toMatch(/schedules\s*=/);
  });

  it('binds the same production D1 database as the public API Worker (no new database, no migration)', () => {
    const publicToml = readFileSync(PUBLIC_WRANGLER_TOML, 'utf-8');
    const publicDbId = publicToml.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
    const hostDbId = tomlText.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
    expect(hostDbId).toBeDefined();
    expect(hostDbId).toBe(publicDbId);
  });

  it('never declares CDP_WALLET_SECRET as a var or comment-documented secret of this script', () => {
    // H2BF4 §"CDP_WALLET_SECRET law" -- WORKFLOW_HOST_CDP_WALLET_SECRET_PRESENT=NO.
    // The name may appear only inside prose explicitly stating it must
    // NOT be provisioned here (checked below), never as an actual
    // `CDP_WALLET_SECRET = ...` assignment or an unqualified provisioning
    // instruction.
    expect(tomlText).not.toMatch(/^\s*CDP_WALLET_SECRET\s*=/m);
    if (tomlText.includes('CDP_WALLET_SECRET')) {
      expect(tomlText).toMatch(/CDP_WALLET_SECRET[^\n]*never (be )?(required|provisioned)/);
    }
  });

  // SUN-1221E6R-H2BF5-FINAL / H2BF5-C1B (evidence ae46400): dependency
  // closure proved these four ADR-0055 governance vars are required on
  // this host before `open-envelope` can be reached -- they gate
  // `resolveCdpPaymentEvidenceProvider`'s evidence-mode selection the
  // same way they gate the public API Worker's routes. Set under
  // explicit, standalone H2BF5-FINAL human authorization, scoped only to
  // this non-public dedicated host.
  it('HOST_ADR0055_VARS_EXACT: declares all four required ADR-0055 governance vars with the exact authorized values', () => {
    const required: Record<string, string> = {
      PAYMENT_ENVIRONMENT: 'production',
      PRODUCTION_ENABLED: 'true',
      HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP: 'true',
      PRODUCTION_CDP_CREDENTIALS_APPROVED: 'true',
    };
    for (const [name, expected] of Object.entries(required)) {
      const match = tomlText.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm'));
      expect(match, `expected ${name} to be present in ${HOST_WRANGLER_TOML}`).toBeDefined();
      expect(match?.[1]).toBe(expected);
    }
  });

  it('does not declare any ADR-0055 var outside the exact authorized four', () => {
    // Guards against silent scope creep: only these four names, never a
    // fifth governance var slipped in alongside them.
    const varsStart = tomlText.search(/^\[vars\]\n/m);
    expect(varsStart).toBeGreaterThanOrEqual(0);
    const afterVars = tomlText.slice(varsStart).replace(/^\[vars\]\n/, '');
    const nextSectionOffset = afterVars.search(/\n\[/);
    const varsBlock = nextSectionOffset === -1 ? afterVars : afterVars.slice(0, nextSectionOffset);
    const assignedNames = [...varsBlock.matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]);
    expect(new Set(assignedNames)).toEqual(
      new Set([
        'SELLER_WALLET_ADDRESS',
        'PAYMENT_ENVIRONMENT',
        'PRODUCTION_ENABLED',
        'HUMAN_AUTHORIZED_PRODUCTION_BOOTSTRAP',
        'PRODUCTION_CDP_CREDENTIALS_APPROVED',
      ]),
    );
  });
});
