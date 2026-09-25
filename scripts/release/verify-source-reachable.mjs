#!/usr/bin/env node
// Fails closed if a claimed deployed source commit is not an ancestor of a
// protected branch — i.e. it exists only as a loose/dangling object (e.g. a
// forgotten `git worktree add <commit>` + commit, never merged anywhere).
// This is the exact class of problem that let 4e1252412c66 go orphaned.
import { execFileSync } from 'node:child_process';

function usage() {
  console.error('usage: verify-source-reachable.mjs <commit-sha> [protected-branch]');
  process.exit(2);
}

const [, , commit, protectedBranch = 'metadata-vcm-qualification'] = process.argv;
if (!commit) usage();

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

let resolved;
try {
  resolved = git(['rev-parse', '--verify', `${commit}^{commit}`]);
} catch {
  console.error(JSON.stringify({ ok: false, reason: 'commit_not_found', commit }));
  process.exit(1);
}

let branchTip;
try {
  branchTip = git(['rev-parse', '--verify', `${protectedBranch}^{commit}`]);
} catch {
  console.error(JSON.stringify({ ok: false, reason: 'protected_branch_not_found', protectedBranch }));
  process.exit(1);
}

let isAncestor = true;
try {
  execFileSync('git', ['merge-base', '--is-ancestor', resolved, branchTip]);
} catch {
  isAncestor = false;
}

const result = {
  ok: isAncestor,
  reason: isAncestor ? 'reachable' : 'dangling_or_unmerged',
  commit: resolved,
  protectedBranch,
  protectedBranchTip: branchTip,
};

console.log(JSON.stringify(result));
process.exit(isAncestor ? 0 : 1);
