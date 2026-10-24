import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Runs before every test module, so config/db read a throwaway database
    // instead of backend/data/sixth-cup.db.
    setupFiles: ['./src/__tests__/setup-isolated-db.ts'],
  },
})
