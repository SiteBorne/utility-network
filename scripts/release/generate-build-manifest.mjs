#!/usr/bin/env node
// Binds a Worker build artifact to the exact source commit it was built
// from, so "what commit is actually running in production" is answerable
// from a manifest instead of operator memory. Run after building, before
// `wrangler versions upload`; attach the resulting JSON as the version's
// message/tag or store alongside deployment records.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

function usage() {
  console.error('usage: generate-build-manifest.mjs <path-to-built-bundle.js>');
  process.exit(2);
}

const [, , bundlePath] = process.argv;
if (!bundlePath || !existsSync(bundlePath)) usage();

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const commit = git(['rev-parse', 'HEAD']);
const branch = (() => {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return 'DETACHED';
  }
})();
const dirty = git(['status', '--porcelain']).length > 0;
const bundleBytes = readFileSync(bundlePath);
const bundleSha256 = createHash('sha256').update(bundleBytes).digest('hex');

const manifest = {
  version: 1,
  source_commit: commit,
  source_branch: branch,
  source_dirty: dirty,
  bundle_path: bundlePath,
  bundle_sha256: bundleSha256,
  bundle_size: bundleBytes.length,
  generated_at: new Date().toISOString(),
};

if (dirty) {
  console.error(
    JSON.stringify({ warning: 'source_dirty', message: 'Working tree has uncommitted changes; manifest reflects HEAD but built bytes may not match a clean checkout of that commit.' })
  );
}

console.log(JSON.stringify(manifest, null, 2));
