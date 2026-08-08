import { defineConfig } from 'vitest/config';

/**
 * Isolated Vitest config for the fast-check property-test suite. Kept
 * separate from the main suite (`pnpm test`) so property-based tests can be
 * run and reported on independently (e.g. with a different timeout budget)
 * via `pnpm test:property`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/fast-check.test.ts'],
  },
});
