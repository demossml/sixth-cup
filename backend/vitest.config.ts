import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Изоляция БД: без этого часть тестов открывала backend/data и оставляла там мусор.
    setupFiles: ['./vitest.setup.ts'],
  },
})
