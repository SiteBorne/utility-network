import base from './vitest.config';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['src/**/*.property.test.ts'],
    },
  })
);
