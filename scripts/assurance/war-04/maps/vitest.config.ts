import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/assurance/war-04/maps/**/*.test.ts'],
  },
})
