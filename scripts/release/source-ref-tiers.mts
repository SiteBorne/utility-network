/**
 * R3-57A Phase 10: source-ref governance tiers, kept strictly separate.
 *
 *   remote_reachable      the commit is an ancestor of some remote-tracking ref
 *                         (`git branch -r --contains`). Says nothing about
 *                         protection.
 *   approved_release_ref  the commit is an ancestor of a ref listed in the
 *                         versioned policy file governance/RELEASE_REFS.json
 *                         (null when no policy file exists).
 *   protected_ref         an authoritative repository source (GitHub branch
 *                         protection or rulesets API via `gh`) says a branch
 *                         containing the commit is protected. null when that
 *                         source cannot be read. NEVER derived from ref
 *                         existence.
 *
 * Read-only: git plus GET-only `gh api`. Mutating nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SourceRefTiers {
  readonly remote_reachable: boolean;
  readonly approved_release_ref: boolean | null;
  readonly protected_ref: boolean | null;
}

export type Run = (cmd: string, args: string[]) => string;

const defaultRun: Run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Remote branch names (without `origin/`) whose history contains the commit. */
export function remoteBranchesContaining(commit: string, run: Run = defaultRun): string[] {
  let out = '';
  try {
    out = run('git', ['branch', '-r', '--contains', commit]);
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('->'))
    .map((l) => l.replace(/^origin\//, ''));
}

export function approvedReleaseRefs(root: string): string[] | null {
  const p = join(root, 'governance/RELEASE_REFS.json');
  if (!existsSync(p)) return null;
  const parsed = JSON.parse(readFileSync(p, 'utf8')) as { approved_release_refs?: unknown };
  return Array.isArray(parsed.approved_release_refs)
    ? parsed.approved_release_refs.filter((x): x is string => typeof x === 'string')
    : null;
}

/** GitHub `owner/repo` from a remote URL, or null. */
export function githubSlug(remote: string): string | null {
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote.trim());
  return m ? m[1] : null;
}

/**
 * protected=true only when the authoritative API confirms one of `branches`
 * is protected. false when the API answered for every branch and none is.
 * null when the API could not be read.
 */
export function protectedFromApi(
  slug: string | null,
  branches: string[],
  run: Run = defaultRun
): boolean | null {
  if (!slug) return null;
  if (branches.length === 0) return false;
  let answered = 0;
  for (const b of branches) {
    try {
      const out = run('gh', ['api', '-X', 'GET', `repos/${slug}/branches/${encodeURIComponent(b)}`]);
      const j = JSON.parse(out) as { protected?: unknown };
      if (typeof j.protected !== 'boolean') continue;
      answered += 1;
      if (j.protected) return true;
    } catch {
      /* unreadable for this branch */
    }
  }
  return answered === branches.length ? false : null;
}

export function classifySourceRef(
  commit: string,
  root: string,
  remoteUrl: string,
  run: Run = defaultRun
): SourceRefTiers {
  const branches = remoteBranchesContaining(commit, run);
  const approved = approvedReleaseRefs(root);
  return {
    remote_reachable: branches.length > 0,
    approved_release_ref: approved === null ? null : branches.some((b) => approved.includes(b)),
    protected_ref: protectedFromApi(githubSlug(remoteUrl), branches, run),
  };
}
