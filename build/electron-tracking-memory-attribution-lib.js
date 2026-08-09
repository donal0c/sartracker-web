/**
 * Correlates resident-memory samples with bounded storage runtime events.
 *
 * A backup remains active from its `started` event through its terminal
 * `completed` or `failed` event. Samples outside those intervals are marked
 * explicitly so missing runtime evidence cannot be mistaken for idle time.
 */
export function correlateMemorySamplesWithRuntimeOperations(samples, runtimeEvents) {
  const backupIntervals = buildBackupIntervals(runtimeEvents)
  return samples.map((sample) => {
    const observedAtMs = Date.parse(sample.observedAt)
    const activeBackup = backupIntervals.find(
      (interval) => observedAtMs >= interval.startedAtMs && observedAtMs <= interval.endedAtMs,
    )
    return {
      ...sample,
      activeBackupOperationId: activeBackup?.operationId ?? null,
      backupElapsedMs:
        activeBackup === undefined ? null : observedAtMs - activeBackup.startedAtMs,
    }
  })
}

/** Returns bounded high-water evidence for one isolated experiment phase. */
export function summarizeMemoryPhase(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      samples: 0,
      firstResidentBytes: 0,
      maximumResidentBytes: 0,
      finalResidentBytes: 0,
      residentGrowthBytes: 0,
      peakByProcessKind: {},
      maximumMainHeapUsedBytes: 0,
      maximumRendererHeapUsedBytes: 0,
    }
  }
  const peakByProcessKind = {}
  for (const sample of samples) {
    const residentByKind = {}
    for (const process of sample.processes ?? []) {
      residentByKind[process.kind] =
        (residentByKind[process.kind] ?? 0) + Number(process.residentBytes ?? 0)
    }
    for (const [kind, residentBytes] of Object.entries(residentByKind)) {
      peakByProcessKind[kind] = Math.max(peakByProcessKind[kind] ?? 0, residentBytes)
    }
  }
  const firstResidentBytes = Number(samples[0].totalResidentBytes ?? 0)
  const finalResidentBytes = Number(samples.at(-1).totalResidentBytes ?? 0)
  return {
    samples: samples.length,
    firstResidentBytes,
    maximumResidentBytes: Math.max(
      ...samples.map((sample) => Number(sample.totalResidentBytes ?? 0)),
    ),
    finalResidentBytes,
    residentGrowthBytes: finalResidentBytes - firstResidentBytes,
    peakByProcessKind,
    maximumMainHeapUsedBytes: Math.max(
      0,
      ...samples.map((sample) => Number(sample.mainHeap?.heapUsed ?? 0)),
    ),
    maximumRendererHeapUsedBytes: Math.max(
      0,
      ...samples.map((sample) => Number(sample.rendererHeap?.usedJSHeapSize ?? 0)),
    ),
  }
}

function buildBackupIntervals(runtimeEvents) {
  const active = new Map()
  const intervals = []
  for (const event of [...runtimeEvents].sort((left, right) =>
    String(left.ts).localeCompare(String(right.ts)))) {
    const operationId = String(event.operationId ?? '')
    if (operationId === '') continue
    if (event.event === 'storage_backup_started') {
      active.set(operationId, {
        operationId,
        startedAtMs: Date.parse(event.ts),
        endedAtMs: Number.POSITIVE_INFINITY,
      })
      continue
    }
    if (
      event.event !== 'storage_backup_completed' &&
      event.event !== 'storage_backup_failed'
    ) {
      continue
    }
    const interval = active.get(operationId)
    if (interval === undefined) continue
    interval.endedAtMs = Date.parse(event.ts)
    intervals.push(interval)
    active.delete(operationId)
  }
  intervals.push(...active.values())
  return intervals
}
