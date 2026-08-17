import { describe, expect, it } from 'vitest';
import {
  classifySchemathesisExit,
  parseServerReadyInfo,
  patchKnownRefMismatches,
} from '../../../scripts/security/run-schemathesis';

/**
 * SUN-1000 checkpoint 1I — credential-free unit tests for the
 * Schemathesis orchestrator's pure logic. No network access, no
 * Schemathesis binary invocation, no local server boot — pure function
 * tests only, matching the established pattern used for the Trivy
 * cache-dir and OSV critical-policy wrappers.
 */
describe('classifySchemathesisExit', () => {
  it('classifies exit code 0 as PASS', () => {
    expect(classifySchemathesisExit(0)).toBe('PASS');
  });

  it('classifies exit code 1 as FINDINGS', () => {
    expect(classifySchemathesisExit(1)).toBe('FINDINGS');
  });

  it('classifies any other exit code as TOOL_ERROR', () => {
    expect(classifySchemathesisExit(2)).toBe('TOOL_ERROR');
    expect(classifySchemathesisExit(127)).toBe('TOOL_ERROR');
    expect(classifySchemathesisExit(-1)).toBe('TOOL_ERROR');
  });

  it('classifies a null exit code (process killed/crashed) as TOOL_ERROR', () => {
    expect(classifySchemathesisExit(null)).toBe('TOOL_ERROR');
  });
});

describe('parseServerReadyInfo', () => {
  it('parses a well-formed ready-info payload', () => {
    const result = parseServerReadyInfo(
      JSON.stringify({ url: 'http://127.0.0.1:54321', pid: 12345 })
    );
    expect(result).toEqual({ url: 'http://127.0.0.1:54321', pid: 12345 });
  });

  it('fails closed on invalid JSON', () => {
    expect(() => parseServerReadyInfo('not json')).toThrow();
  });

  it('fails closed when url is missing', () => {
    expect(() => parseServerReadyInfo(JSON.stringify({ pid: 1 }))).toThrow(/malformed_ready_info/);
  });

  it('fails closed when pid is missing or not a number', () => {
    expect(() =>
      parseServerReadyInfo(JSON.stringify({ url: 'http://127.0.0.1:1', pid: 'x' }))
    ).toThrow(/malformed_ready_info/);
  });

  it('fails closed when url does not point at localhost (fail-safe against a misconfigured/hijacked target)', () => {
    expect(() =>
      parseServerReadyInfo(JSON.stringify({ url: 'http://evil.example.com', pid: 1 }))
    ).toThrow(/malformed_ready_info/);
  });
});

describe('patchKnownRefMismatches', () => {
  it('rewrites every known mismatched $ref name to the real registered component name', () => {
    const input = JSON.stringify({
      a: { $ref: '#/components/schemas/CompanyEvidenceGraphInput' },
      b: { $ref: '#/components/schemas/WebContextVerifiedOutput' },
    });
    const patched = patchKnownRefMismatches(input);
    const parsed = JSON.parse(patched);
    expect(parsed.a.$ref).toBe('#/components/schemas/CompanyEvidenceInput');
    expect(parsed.b.$ref).toBe('#/components/schemas/WebContextOutput');
  });

  it('leaves unrelated $refs and content completely untouched', () => {
    const input = JSON.stringify({
      c: { $ref: '#/components/schemas/StructuredError' },
      note: 'CompanyEvidenceGraphInput mentioned in prose, not a $ref, should not match',
    });
    expect(patchKnownRefMismatches(input)).toBe(input);
  });

  it('produces output that remains valid JSON with all 8 known services patched', () => {
    const refs = [
      'CompanyEvidenceGraphInput',
      'CompanyEvidenceGraphOutput',
      'WebContextVerifiedInput',
      'WebContextVerifiedOutput',
      'DocumentEvidenceJsonInput',
      'DocumentEvidenceJsonOutput',
      'VerifyAgentOutputInput',
      'VerifyAgentOutputOutput',
    ];
    const input = JSON.stringify(
      Object.fromEntries(refs.map((r, i) => [`k${i}`, { $ref: `#/components/schemas/${r}` }]))
    );
    const patched = patchKnownRefMismatches(input);
    expect(() => JSON.parse(patched)).not.toThrow();
    for (const r of refs) {
      expect(patched).not.toContain(`#/components/schemas/${r}"`);
    }
  });
});
