import { describe, expect, it } from 'vitest';
import { classifySourceRef, githubSlug, protectedFromApi, type Run } from './source-ref-tiers.mts';

const C = 'a'.repeat(40);
const mk = (branchOut: string, api: Record<string, string | Error>): Run => (cmd, args) => {
  if (cmd === 'git') return branchOut;
  const b = decodeURIComponent(args[args.length - 1].split('/branches/')[1]);
  const r = api[b];
  if (r === undefined || r instanceof Error) throw r ?? new Error('nope');
  return r;
};

describe('R3-57A source-ref tiers are independent', () => {
  it('remote reachability alone never implies protection', () => {
    const run = mk('  origin/feature-x\n', { 'feature-x': '{"protected":false}' });
    const t = classifySourceRef(C, '/nonexistent', 'git@github.com:o/r.git', run);
    expect(t).toEqual({ remote_reachable: true, approved_release_ref: null, protected_ref: false });
  });
  it('protected only when the API says so', () => {
    const run = mk('  origin/main\n  origin/x\n', { main: '{"protected":true}', x: '{"protected":false}' });
    expect(protectedFromApi('o/r', ['x', 'main'], run)).toBe(true);
  });
  it('unreadable protection source is unknown, not false and not true', () => {
    const run = mk('  origin/main\n', { main: new Error('401') });
    expect(protectedFromApi('o/r', ['main'], run)).toBeNull();
    expect(protectedFromApi(null, ['main'], run)).toBeNull();
  });
  it('unpushed commit: not remote reachable, protected false', () => {
    const t = classifySourceRef(C, '/nonexistent', 'git@github.com:o/r.git', mk('', {}));
    expect(t.remote_reachable).toBe(false);
    expect(t.protected_ref).toBe(false);
  });
  it('parses github slugs', () => {
    expect(githubSlug('git@github.com:o/r.git')).toBe('o/r');
    expect(githubSlug('https://github.com/o/r')).toBe('o/r');
    expect(githubSlug('https://example.com/o/r')).toBeNull();
  });
});
