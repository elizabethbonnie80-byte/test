import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests for pure TS helpers (lib/csv, lib/status-styles, lib/enums). These are deterministic and
// have no DB/DOM dependency — the RPC/RLS behaviour is covered by the `scripts/smoke-*.mjs` suite.
export default defineConfig({
  resolve: {
    // Mirror the tsconfig "@/*" path alias so imports like `@/lib/csv` resolve.
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
