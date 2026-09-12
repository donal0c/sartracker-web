import { defineConfig } from 'vitest/config'
import base from './vitest.config'

console.info('Correctness CI: strict wall-clock responsiveness qualification NOT RUN. Release remains on HOLD pending dedicated qualification.')

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
