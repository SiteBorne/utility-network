import { describe, expect, it } from 'vitest';
import {
  classifySchemathesisExit,
  parseServerReadyInfo,
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
