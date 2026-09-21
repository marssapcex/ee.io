import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // UI specs opt into jsdom via a per-file @vitest-environment docblock.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Adapters must never reach the network during tests; the deterministic
    // simulator is the unit under test.
    env: { EE_FORCE_SIMULATION: '1' },
  },
});
