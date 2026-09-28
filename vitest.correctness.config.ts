import { defineConfig } from 'vitest/config'
import base from './vitest.config'

console.info('Correctness mode: strict wall-clock <200 ms assertions NOT RUN here; run npm run test:responsiveness for timing.')

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    exclude: [
      ...(base.test?.exclude ?? []),
      'tests/unit/assurance/war-02b/**',
    ],
    provide: { releaseResponsivenessMode: 'correctness' },
  },
})
