/**
 * METADATA-VCM-IMPL-04A §VII/§XIV: one strict allow-list parser shared by
 * both A2A and MCP call sites. Absent or malformed config must fail toward
 * `legacy` -- never toward any VCM-serving state -- and `vcm_primary_compare`/
 * `vcm_only` must be recognized as valid enum members (closed 4-value type)
 * but structurally refused as *servable* in this checkpoint.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  METADATA_PROJECTION_MODES,
  parseMetadataProjectionMode,
  resolveAuthorizedMetadataProjectionMode,
} from './metadata-projection-mode';

describe('parseMetadataProjectionMode', () => {
  it('absent config parses safely to legacy', () => {
    expect(parseMetadataProjectionMode(undefined, 'a2a')).toBe('legacy');
  });

  it('empty string parses safely to legacy', () => {
    expect(parseMetadataProjectionMode('', 'a2a')).toBe('legacy');
  });

  it('an unrecognized value parses safely to legacy and logs once', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(parseMetadataProjectionMode('VCM_ONLY', 'mcp')).toBe('legacy');
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain('mcp');
    expect(line).toContain('VCM_ONLY');
    spy.mockRestore();
  });

  it('a boolean-shaped typo ("true") parses safely to legacy', () => {
    expect(parseMetadataProjectionMode('true', 'a2a')).toBe('legacy');
  });

  it('recognizes each of the four exact literals', () => {
    for (const mode of METADATA_PROJECTION_MODES) {
      expect(parseMetadataProjectionMode(mode, 'a2a')).toBe(mode);
    }
  });

  it('is case-sensitive (no implicit normalization)', () => {
    expect(parseMetadataProjectionMode('Shadow_Compare', 'a2a')).toBe('legacy');
  });
});

describe('resolveAuthorizedMetadataProjectionMode', () => {
  it('legacy passes through unchanged', () => {
    expect(resolveAuthorizedMetadataProjectionMode('legacy', 'a2a')).toBe('legacy');
  });

  it('shadow_compare passes through unchanged (authorized this checkpoint)', () => {
    expect(resolveAuthorizedMetadataProjectionMode('shadow_compare', 'mcp')).toBe('shadow_compare');
  });

  it('vcm_primary_compare is refused down to legacy and logs once, naming the surface', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(resolveAuthorizedMetadataProjectionMode('vcm_primary_compare', 'a2a')).toBe('legacy');
    expect(spy).toHaveBeenCalledTimes(1);
    const [line] = spy.mock.calls[0] as [string];
    expect(line).toContain('a2a');
    expect(line).toContain('vcm_primary_compare');
    expect(line).toContain('NOT_AUTHORIZED_IN_IMPL_04A');
    spy.mockRestore();
  });

  it('vcm_only is refused down to legacy and logs once', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(resolveAuthorizedMetadataProjectionMode('vcm_only', 'mcp')).toBe('legacy');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('end-to-end: a raw "vcm_only" env value never reaches a servable mode', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const parsed = parseMetadataProjectionMode('vcm_only', 'a2a');
    const authorized = resolveAuthorizedMetadataProjectionMode(parsed, 'a2a');
    expect(authorized).toBe('legacy');
    spy.mockRestore();
  });
});
