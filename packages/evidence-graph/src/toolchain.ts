/**
 * Build toolchain provenance (R3-A4-55 Phase 8).
 *
 * A BuildRecord's toolchain is either the toolchain that produced the
 * release (captured at build time, forward-looking only) or a later rebuild
 * toolchain used to re-derive an old artifact. The two must never be
 * confused: a rebuild's node/wrangler versions are not evidence of what the
 * original release used.
 */

export const TOOLCHAIN_PROVENANCE = ['ORIGINAL_RELEASE_TOOLCHAIN', 'REBUILD_TOOLCHAIN'] as const;
export type ToolchainProvenance = (typeof TOOLCHAIN_PROVENANCE)[number];

/** `pnpm@9.1.0` style identity parsed from the `packageManager` field. */
export function packageManagerIdentity(
  packageJsonText: string,
  runningPnpmVersion: string
): string {
  const declared = (JSON.parse(packageJsonText) as { packageManager?: unknown }).packageManager;
  const running = `pnpm@${runningPnpmVersion}`;
  if (typeof declared === 'string' && declared.split('+')[0] !== running) {
    throw new Error(`packageManager ${declared} does not match running ${running}`);
  }
  return running;
}

/**
 * Build command identity: the exact argv, joined, with the machine-specific
 * output directory replaced so equal invocations compare equal.
 */
export function buildCommandIdentity(argv: readonly string[], outdir: string): string {
  return argv.map((a) => (a === outdir ? '<outdir>' : a)).join(' ');
}
