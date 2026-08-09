import { describe, expect, it } from 'vitest'

import {
  correlateMemorySamplesWithRuntimeOperations,
  summarizeMemoryPhase,
} from '../../build/electron-tracking-memory-attribution-lib.js'

describe('Electron tracking memory attribution', () => {
  it('correlates each memory sample with the active backup operation', () => {
    const runtimeEvents = [
      {
        ts: '2026-08-09T22:22:52.381Z',
        event: 'storage_backup_started',
        operationId: 'backup-1',
      },
      {
        ts: '2026-08-09T22:23:17.550Z',
        event: 'storage_backup_completed',
        operationId: 'backup-1',
      },
    ]
    const samples = [
      { observedAt: '2026-08-09T22:22:50.000Z', totalResidentBytes: 100 },
      { observedAt: '2026-08-09T22:23:11.524Z', totalResidentBytes: 250 },
      { observedAt: '2026-08-09T22:23:18.000Z', totalResidentBytes: 120 },
    ]

    expect(correlateMemorySamplesWithRuntimeOperations(samples, runtimeEvents)).toEqual([
      expect.objectContaining({ activeBackupOperationId: null }),
      expect.objectContaining({
        activeBackupOperationId: 'backup-1',
        backupElapsedMs: 19_143,
      }),
      expect.objectContaining({ activeBackupOperationId: null }),
    ])
  })

  it('summarizes RSS and JavaScript heap high-water by process kind', () => {
    const summary = summarizeMemoryPhase([
      {
        observedAt: '2026-08-09T22:00:00.000Z',
        totalResidentBytes: 1_000,
        processes: [
          { kind: 'main', residentBytes: 600 },
          { kind: 'renderer', residentBytes: 400 },
        ],
        mainHeap: { heapUsed: 100 },
        rendererHeap: { usedJSHeapSize: 80 },
      },
      {
        observedAt: '2026-08-09T22:00:01.000Z',
        totalResidentBytes: 1_500,
        processes: [
          { kind: 'main', residentBytes: 950 },
          { kind: 'renderer', residentBytes: 550 },
        ],
        mainHeap: { heapUsed: 125 },
        rendererHeap: { usedJSHeapSize: 95 },
      },
    ])

    expect(summary).toEqual({
      samples: 2,
      firstResidentBytes: 1_000,
      maximumResidentBytes: 1_500,
      finalResidentBytes: 1_500,
      residentGrowthBytes: 500,
      peakByProcessKind: { main: 950, renderer: 550 },
      maximumMainHeapUsedBytes: 125,
      maximumRendererHeapUsedBytes: 95,
    })
  })
})
