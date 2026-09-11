import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    provide: { releaseResponsivenessMode: 'release-qualification' },
    fileParallelism: false,
    passWithNoTests: false,
    include: [
      'tests/unit/breadcrumb-accumulator.test.ts',
      'tests/unit/breadcrumb-pr6-qualification-script.test.ts',
      'tests/unit/electron-archive-family-resource-lane.test.ts',
      'tests/unit/electron-archive-plaintext-sweep-integration.test.ts',
      'tests/unit/electron-archive-registry.test.ts',
      'tests/unit/electron-cleanup-live-write-contention.test.ts',
      'tests/unit/electron-coverage-ledger.test.ts',
      'tests/unit/electron-mission-evidence-versioning.test.ts',
      'tests/unit/electron-mission-review-read-query-runner.test.ts',
      'tests/unit/electron-search-operations-page.test.ts',
      'tests/unit/electron-startup-write-responsiveness.test.ts',
      'tests/unit/ingest-anomaly-outbox.test.ts',
      'tests/unit/main-event-loop-probe.test.ts',
      'tests/unit/stationary-attention-projection.test.ts',
      'tests/unit/release-responsiveness.test.ts',
    ],
  },
})
