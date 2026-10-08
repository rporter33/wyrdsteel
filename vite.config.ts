import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under a GitHub Pages subpath with no config change.
  // Set unconditionally: a base set only for `build` once shipped a broken preview elsewhere.
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
