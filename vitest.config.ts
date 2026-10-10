import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  },
  resolve: {
    // The obsidian package is types only, so a run-time lookup of its UI classes has nothing to
    // resolve to here. Production builds keep treating obsidian as external.
    alias: { obsidian: resolve('tests/helpers/obsidianStub.ts') }
  }
});
