import { defineConfig } from 'vitest/config';

// The balance suite: the bot plays whole zones and boss fights through the real input API.
// Slower than unit tests, so it runs as its own CI step.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/balance/**/*.balance.test.ts'],
    testTimeout: 240_000,
  },
});
