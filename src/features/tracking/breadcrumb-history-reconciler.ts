import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from './tracking-types'
import { compareStringsByCodeUnit } from '../../lib/deterministic-string-order'

const DEFAULT_CHUNK_MS = 2 * 60 * 60 * 1000
const DEFAULT_MAX_CONCURRENCY = 8
const DEFAULT_RETRY_BASE_MS = 1_000
const DEFAULT_MAX_RETRY_MS = 30_000
const DEFAULT_ANTI_ENTROPY_INTERVAL_MS = 5 * 60 * 1000

type BreadcrumbHistoryReconcilerLogger = {
  readonly warn: (message: string, context: Record<string, unknown>) => void
}

type BreadcrumbHistoryReconcilerOptions = {
  readonly fetchBreadcrumbs: (
    deviceId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly NormalizedTrackingPosition[]>
  readonly onChunk: (chunk: BreadcrumbHistoryChunk) => void | Promise<void>
  readonly onChunks?: (
    chunks: readonly BreadcrumbHistoryChunk[],
  ) => void | Promise<void>
  readonly onProgress: (progress: BreadcrumbHistoryProgress) => void
  readonly shouldContinue: () => boolean
  readonly logger: BreadcrumbHistoryReconcilerLogger
  readonly chunkMs?: number
  readonly maxConcurrency?: number
  readonly retryBaseMs?: number
  readonly maxRetryMs?: number
  readonly antiEntropyIntervalMs?: number
  readonly setTimeout?: typeof window.setTimeout
  readonly clearTimeout?: typeof window.clearTimeout
}

export type BreadcrumbHistoryChunk = {
  readonly phase: 'initial' | 'anti_entropy'
  readonly deviceId: string
  readonly deviceName: string
  readonly historyFrom: Date
  readonly from: Date
  readonly to: Date
  readonly positions: readonly NormalizedTrackingPosition[]
}

export type BreadcrumbHistoryProgress = {
  readonly phase: 'initial' | 'anti_entropy'
  readonly targetFrom: string | null
  readonly targetTo: string | null
  readonly totalDeviceCount: number
  readonly completedDeviceCount: number
  readonly totalChunkCount: number
  readonly completedChunkCount: number
  readonly pendingDeviceCount: number
  readonly failedDeviceCount: number
  readonly elapsedMs: number
  readonly pendingDeviceNames: readonly string[]
  readonly failedDeviceNames: readonly string[]
  readonly complete: boolean
}

export type BreadcrumbHistoryReconciliationRequest = {
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly from: Date | null
  readonly until: Date
  readonly checkpointsByDevice?: Readonly<Record<string, {
    readonly historyFrom: string
    readonly reconciledUntil: string
  }>>
}

type BreadcrumbHistoryReconciler = {
  readonly reconcile: (request: BreadcrumbHistoryReconciliationRequest) => void
  readonly getProgress: () => BreadcrumbHistoryProgress
  readonly suspend: () => void
  readonly reset: () => void
}

type DeviceReconciliationJob = {
  readonly deviceId: string
  readonly deviceName: string
  readonly targetMs: number
  readonly missionStartMs: number
  readonly initialTargetMs: number
  readonly latestAvailableTargetMs: number
  cursorMs: number
  failureCount: number
  retryAtMs: number
}

type CompletedDeviceReconciliation = {
  readonly deviceId: string
  readonly deviceName: string
  readonly missionStartMs: number
  readonly initialTargetMs: number
  antiEntropyCursorMs: number
  antiEntropyTargetMs: number
  latestAvailableTargetMs: number
}

/**
 * Drains bounded mission-history windows independently of the live polling
 * interval. Each device has at most one request in flight and the scheduler
 * round-robins devices so a large team cannot starve behind one long trail.
 */
export function createBreadcrumbHistoryReconciler(
  options: BreadcrumbHistoryReconcilerOptions,
): BreadcrumbHistoryReconciler {
  const chunkMs = normalizePositiveInteger(options.chunkMs, DEFAULT_CHUNK_MS)
  const maxConcurrency = normalizePositiveInteger(
    options.maxConcurrency,
    DEFAULT_MAX_CONCURRENCY,
  )
  const retryBaseMs = normalizePositiveInteger(
    options.retryBaseMs,
    DEFAULT_RETRY_BASE_MS,
  )
  const maxRetryMs = normalizePositiveInteger(
    options.maxRetryMs,
    DEFAULT_MAX_RETRY_MS,
  )
  const antiEntropyIntervalMs = normalizePositiveInteger(
    options.antiEntropyIntervalMs,
    DEFAULT_ANTI_ENTROPY_INTERVAL_MS,
  )
  const scheduleTimeout = options.setTimeout ?? window.setTimeout.bind(window)
  const clearScheduledTimeout =
    options.clearTimeout ?? window.clearTimeout.bind(window)

  const jobsByDeviceId = new Map<string, DeviceReconciliationJob>()
  const completedDevicesById = new Map<string, CompletedDeviceReconciliation>()
  const failedDeviceIds = new Set<string>()
  const antiEntropyFailedDeviceIds = new Set<string>()
  const activeInitialJobs = new Set<DeviceReconciliationJob>()
  const deviceQueue: string[] = []
  let generation = 0
  let draining = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let antiEntropyTimer: ReturnType<typeof setTimeout> | null = null
  let antiEntropyBatchInFlight = false
  let antiEntropyNextDeviceIndex = 0
  let initialStartedAtMs: number | null = null
  let antiEntropyStartedAtMs: number | null = null

  const buildProgress = (
    phase: BreadcrumbHistoryProgress['phase'],
  ): BreadcrumbHistoryProgress => {
    const pendingJobs = [...jobsByDeviceId.values()].sort((left, right) =>
      compareStringsByCodeUnit(left.deviceId, right.deviceId),
    )
    const completedDevices = [...completedDevicesById.values()]
    const targetStarts = [
      ...pendingJobs.map((job) => job.missionStartMs),
      ...completedDevices.map((device) => device.missionStartMs),
    ]
    const targetEnds = phase === 'initial'
      ? [
          ...pendingJobs.map((job) => job.initialTargetMs),
          ...completedDevices.map((device) => device.initialTargetMs),
        ]
      : completedDevices.map((device) => device.antiEntropyTargetMs)
    const initialTotalChunkCount = [
      ...pendingJobs.map((job) =>
        countChunks(job.missionStartMs, job.initialTargetMs, chunkMs),
      ),
      ...completedDevices.map((device) =>
        countChunks(device.missionStartMs, device.initialTargetMs, chunkMs),
      ),
    ].reduce((total, count) => total + count, 0)
    const initialCompletedChunkCount = [
      ...pendingJobs.map((job) => countChunks(job.missionStartMs, job.cursorMs, chunkMs)),
      ...completedDevices.map((device) =>
        countChunks(device.missionStartMs, device.initialTargetMs, chunkMs),
      ),
    ].reduce((total, count) => total + count, 0)
    const antiEntropyTotalChunkCount = completedDevices.reduce(
      (total, device) =>
        total + countChunks(device.missionStartMs, device.antiEntropyTargetMs, chunkMs),
      0,
    )
    const antiEntropyCompletedChunkCount = completedDevices.reduce(
      (total, device) =>
        total + countChunks(device.missionStartMs, device.antiEntropyCursorMs, chunkMs),
      0,
    )
    const failedIds = phase === 'initial' ? failedDeviceIds : antiEntropyFailedDeviceIds
    const failedNames = phase === 'initial'
      ? pendingJobs
          .filter((job) => failedIds.has(job.deviceId))
          .map((job) => job.deviceName)
      : completedDevices
          .filter((device) => failedIds.has(device.deviceId))
          .map((device) => device.deviceName)
    const totalDeviceCount = pendingJobs.length + completedDevices.length
    const completedDeviceCount = phase === 'initial'
      ? completedDevices.length
      : completedDevices.filter(
          (device) => device.antiEntropyCursorMs >= device.antiEntropyTargetMs,
        ).length
    const startedAtMs = phase === 'initial' ? initialStartedAtMs : antiEntropyStartedAtMs
    return {
      phase,
      targetFrom:
        targetStarts.length === 0
          ? null
          : new Date(Math.min(...targetStarts)).toISOString(),
      targetTo:
        targetEnds.length === 0
          ? null
          : new Date(Math.max(...targetEnds)).toISOString(),
      totalDeviceCount,
      completedDeviceCount,
      totalChunkCount:
        phase === 'initial' ? initialTotalChunkCount : antiEntropyTotalChunkCount,
      completedChunkCount:
        phase === 'initial'
          ? initialCompletedChunkCount
          : antiEntropyCompletedChunkCount,
      pendingDeviceCount: Math.max(0, totalDeviceCount - completedDeviceCount),
      failedDeviceCount: failedNames.length,
      elapsedMs: startedAtMs === null ? 0 : Math.max(0, Date.now() - startedAtMs),
      pendingDeviceNames: pendingJobs.map((job) => job.deviceName),
      failedDeviceNames: failedNames,
      complete:
        phase === 'initial'
          ? pendingJobs.length === 0
          : completedDeviceCount === totalDeviceCount,
    }
  }

  const getProgress = (): BreadcrumbHistoryProgress =>
    buildProgress(antiEntropyStartedAtMs === null ? 'initial' : 'anti_entropy')

  const publishProgress = (
    phase: BreadcrumbHistoryProgress['phase'] = 'initial',
  ): void => {
    if (options.shouldContinue()) {
      options.onProgress(buildProgress(phase))
    }
  }

  const completeInitialJob = (job: DeviceReconciliationJob): void => {
    jobsByDeviceId.delete(job.deviceId)
    failedDeviceIds.delete(job.deviceId)
    completedDevicesById.set(job.deviceId, {
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      missionStartMs: job.missionStartMs,
      initialTargetMs: job.initialTargetMs,
      antiEntropyCursorMs: job.missionStartMs,
      antiEntropyTargetMs: job.latestAvailableTargetMs,
      latestAvailableTargetMs: job.latestAvailableTargetMs,
    })
  }

  const scheduleDrain = (delayMs: number): void => {
    if (retryTimer !== null || !options.shouldContinue()) {
      return
    }
    const scheduledGeneration = generation
    retryTimer = scheduleTimeout(() => {
      retryTimer = null
      if (scheduledGeneration === generation) {
        startDrain()
      }
    }, delayMs)
  }

  const processJob = async (
    job: DeviceReconciliationJob,
    drainGeneration: number,
  ): Promise<void> => {
    const fromMs = job.cursorMs
    const toMs = Math.min(fromMs + chunkMs, job.targetMs)
    if (toMs <= fromMs) {
      completeInitialJob(job)
      return
    }

    try {
      const positions = await options.fetchBreadcrumbs(
        job.deviceId,
        new Date(fromMs),
        new Date(toMs),
      )
      if (
        drainGeneration !== generation ||
        !options.shouldContinue() ||
        jobsByDeviceId.get(job.deviceId) !== job
      ) {
        if (
          jobsByDeviceId.get(job.deviceId) === job &&
          !deviceQueue.includes(job.deviceId)
        ) {
          deviceQueue.push(job.deviceId)
          scheduleDrain(0)
        }
        return
      }

      await options.onChunk({
        phase: 'initial',
        deviceId: job.deviceId,
        deviceName: job.deviceName,
        historyFrom: new Date(job.missionStartMs),
        from: new Date(fromMs),
        to: new Date(toMs),
        positions,
      })
      if (
        drainGeneration !== generation ||
        !options.shouldContinue() ||
        jobsByDeviceId.get(job.deviceId) !== job
      ) {
        return
      }
      job.cursorMs = toMs
      job.failureCount = 0
      job.retryAtMs = 0
      failedDeviceIds.delete(job.deviceId)
      if (job.cursorMs >= job.targetMs) {
        completeInitialJob(job)
      } else {
        deviceQueue.push(job.deviceId)
      }
    } catch (error) {
      if (
        drainGeneration !== generation ||
        !options.shouldContinue() ||
        jobsByDeviceId.get(job.deviceId) !== job
      ) {
        return
      }

      job.failureCount += 1
      const retryDelayMs = Math.min(
        retryBaseMs * 2 ** (job.failureCount - 1),
        maxRetryMs,
      )
      job.retryAtMs = Date.now() + retryDelayMs
      failedDeviceIds.add(job.deviceId)
      deviceQueue.push(job.deviceId)
      options.logger.warn('Tracking breadcrumb reconciliation failed for device.', {
        deviceId: job.deviceId,
        deviceName: job.deviceName,
        retryDelayMs,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const isCurrentJob = (
    job: DeviceReconciliationJob,
    drainGeneration: number,
  ): boolean =>
    drainGeneration === generation &&
    options.shouldContinue() &&
    jobsByDeviceId.get(job.deviceId) === job

  const markJobFailed = (
    job: DeviceReconciliationJob,
    drainGeneration: number,
    error: unknown,
  ): void => {
    if (!isCurrentJob(job, drainGeneration)) {
      return
    }
    job.failureCount += 1
    const retryDelayMs = Math.min(
      retryBaseMs * 2 ** (job.failureCount - 1),
      maxRetryMs,
    )
    job.retryAtMs = Date.now() + retryDelayMs
    failedDeviceIds.add(job.deviceId)
    deviceQueue.push(job.deviceId)
    options.logger.warn('Tracking breadcrumb reconciliation failed for device.', {
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      retryDelayMs,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const createInitialChunk = async (
    job: DeviceReconciliationJob,
    drainGeneration: number,
  ): Promise<BreadcrumbHistoryChunk | null> => {
    const fromMs = job.cursorMs
    const toMs = Math.min(fromMs + chunkMs, job.targetMs)
    if (toMs <= fromMs) {
      completeInitialJob(job)
      return null
    }
    try {
      const positions = await options.fetchBreadcrumbs(
        job.deviceId,
        new Date(fromMs),
        new Date(toMs),
      )
      if (!isCurrentJob(job, drainGeneration)) {
        return null
      }
      return {
        phase: 'initial',
        deviceId: job.deviceId,
        deviceName: job.deviceName,
        historyFrom: new Date(job.missionStartMs),
        from: new Date(fromMs),
        to: new Date(toMs),
        positions,
      }
    } catch (error) {
      markJobFailed(job, drainGeneration, error)
      return null
    }
  }

  const advanceAcknowledgedChunk = (
    job: DeviceReconciliationJob,
    chunk: BreadcrumbHistoryChunk,
    drainGeneration: number,
  ): void => {
    if (!isCurrentJob(job, drainGeneration)) {
      return
    }
    job.cursorMs = chunk.to.getTime()
    job.failureCount = 0
    job.retryAtMs = 0
    failedDeviceIds.delete(job.deviceId)
    if (job.cursorMs >= job.targetMs) {
      completeInitialJob(job)
    } else {
      deviceQueue.push(job.deviceId)
    }
  }

  const processJobBatch = async (
    jobs: readonly DeviceReconciliationJob[],
    drainGeneration: number,
  ): Promise<void> => {
    const fetched = await Promise.all(
      jobs.map(async (job) => ({
        job,
        chunk: await createInitialChunk(job, drainGeneration),
      })),
    )
    const accepted = fetched.filter(
      (entry): entry is {
        readonly job: DeviceReconciliationJob
        readonly chunk: BreadcrumbHistoryChunk
      } => entry.chunk !== null && isCurrentJob(entry.job, drainGeneration),
    )
    if (accepted.length === 0 || options.onChunks === undefined) {
      return
    }
    try {
      await options.onChunks(accepted.map((entry) => entry.chunk))
    } catch {
      const currentAccepted = accepted.filter((entry) =>
        isCurrentJob(entry.job, drainGeneration),
      )
      const fallbackResults = await Promise.allSettled(
        currentAccepted.map((entry) => options.onChunk(entry.chunk)),
      )
      for (const [index, entry] of currentAccepted.entries()) {
        const result = fallbackResults[index]
        if (result?.status === 'fulfilled') {
          advanceAcknowledgedChunk(entry.job, entry.chunk, drainGeneration)
        } else {
          markJobFailed(
            entry.job,
            drainGeneration,
            result?.reason ?? new Error('Tracking history chunk persistence failed.'),
          )
        }
      }
      return
    }
    for (const entry of accepted) {
      advanceAcknowledgedChunk(entry.job, entry.chunk, drainGeneration)
    }
  }

  const drain = async (drainGeneration: number): Promise<void> => {
    while (
      drainGeneration === generation &&
      options.shouldContinue() &&
      jobsByDeviceId.size > 0
    ) {
      const queuePassLength = deviceQueue.length
      const eligibleJobs: DeviceReconciliationJob[] = []
      const availableConcurrency = Math.max(
        0,
        maxConcurrency - activeInitialJobs.size,
      )
      let earliestRetryAtMs = Number.POSITIVE_INFINITY
      for (
        let index = 0;
        index < queuePassLength && eligibleJobs.length < availableConcurrency;
        index += 1
      ) {
        const deviceId = deviceQueue.shift()
        if (deviceId === undefined) {
          break
        }
        const job = jobsByDeviceId.get(deviceId)
        if (job === undefined) {
          continue
        }
        if (job.retryAtMs > Date.now()) {
          earliestRetryAtMs = Math.min(earliestRetryAtMs, job.retryAtMs)
          deviceQueue.push(deviceId)
          continue
        }
        if (activeInitialJobs.has(job)) {
          continue
        }
        activeInitialJobs.add(job)
        eligibleJobs.push(job)
      }

      if (eligibleJobs.length === 0) {
        if (Number.isFinite(earliestRetryAtMs)) {
          scheduleDrain(Math.max(0, earliestRetryAtMs - Date.now()))
        }
        break
      }

      if (options.onChunks === undefined) {
        await Promise.all(
          eligibleJobs.map((job) => processJob(job, drainGeneration)),
        )
      } else {
        await processJobBatch(eligibleJobs, drainGeneration)
      }
      for (const job of eligibleJobs) {
        activeInitialJobs.delete(job)
      }
      if (drainGeneration !== generation || !options.shouldContinue()) {
        break
      }
      publishProgress()
    }
  }

  function startDrain(): void {
    if (draining || jobsByDeviceId.size === 0 || !options.shouldContinue()) {
      return
    }
    draining = true
    const drainGeneration = generation
    void drain(drainGeneration).finally(() => {
      if (drainGeneration === generation) {
        draining = false
        scheduleAntiEntropy()
      }
    })
  }

  function scheduleAntiEntropy(): void {
    if (
      antiEntropyTimer !== null ||
      antiEntropyBatchInFlight ||
      completedDevicesById.size === 0 ||
      !options.shouldContinue()
    ) {
      return
    }
    const scheduledGeneration = generation
    antiEntropyTimer = scheduleTimeout(() => {
      antiEntropyTimer = null
      if (scheduledGeneration === generation) {
        void runAntiEntropyBatch(scheduledGeneration)
      }
    }, antiEntropyIntervalMs)
  }

  async function runAntiEntropyBatch(batchGeneration: number): Promise<void> {
    if (
      batchGeneration !== generation ||
      !options.shouldContinue() ||
      jobsByDeviceId.size > 0 ||
      draining
    ) {
      scheduleAntiEntropy()
      return
    }
    antiEntropyStartedAtMs ??= Date.now()
    antiEntropyBatchInFlight = true

    const devices = [...completedDevicesById.values()].sort((left, right) =>
      compareStringsByCodeUnit(left.deviceId, right.deviceId),
    )
    const selectedCount = Math.min(maxConcurrency, devices.length)
    const selected: CompletedDeviceReconciliation[] = []
    for (let offset = 0; offset < selectedCount; offset += 1) {
      const index = (antiEntropyNextDeviceIndex + offset) % devices.length
      const device = devices[index]
      if (device !== undefined) {
        selected.push(device)
      }
    }
    antiEntropyNextDeviceIndex =
      devices.length === 0
        ? 0
        : (antiEntropyNextDeviceIndex + selectedCount) % devices.length

    await Promise.all(
      selected.map(async (device) => {
        if (device.antiEntropyCursorMs >= device.antiEntropyTargetMs) {
          device.antiEntropyCursorMs = device.missionStartMs
          device.antiEntropyTargetMs = device.latestAvailableTargetMs
        }
        const fromMs = device.antiEntropyCursorMs
        const toMs = Math.min(fromMs + chunkMs, device.antiEntropyTargetMs)
        if (toMs <= fromMs) {
          return
        }
        try {
          const positions = await options.fetchBreadcrumbs(
            device.deviceId,
            new Date(fromMs),
            new Date(toMs),
          )
          if (
            batchGeneration !== generation ||
            !options.shouldContinue() ||
            completedDevicesById.get(device.deviceId) !== device
          ) {
            return
          }
          await options.onChunk({
            phase: 'anti_entropy',
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            historyFrom: new Date(device.missionStartMs),
            from: new Date(fromMs),
            to: new Date(toMs),
            positions,
          })
          if (
            batchGeneration !== generation ||
            !options.shouldContinue() ||
            completedDevicesById.get(device.deviceId) !== device
          ) {
            return
          }
          device.antiEntropyCursorMs = toMs
          antiEntropyFailedDeviceIds.delete(device.deviceId)
        } catch (error) {
          if (
            batchGeneration !== generation ||
            !options.shouldContinue() ||
            completedDevicesById.get(device.deviceId) !== device
          ) {
            return
          }
          options.logger.warn('Tracking breadcrumb anti-entropy check failed for device.', {
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            retryDelayMs: antiEntropyIntervalMs,
            error: error instanceof Error ? error.message : String(error),
          })
          antiEntropyFailedDeviceIds.add(device.deviceId)
        }
      }),
    )
    antiEntropyBatchInFlight = false
    if (batchGeneration === generation) {
      const progress = buildProgress('anti_entropy')
      publishProgress('anti_entropy')
      if (progress.complete) {
        antiEntropyStartedAtMs = null
      }
      scheduleAntiEntropy()
    }
  }

  function suspend(): void {
    generation += 1
    draining = false
    for (const job of jobsByDeviceId.values()) {
      if (!deviceQueue.includes(job.deviceId)) {
        deviceQueue.push(job.deviceId)
      }
    }
    if (retryTimer !== null) {
      clearScheduledTimeout(retryTimer)
      retryTimer = null
    }
    if (antiEntropyTimer !== null) {
      clearScheduledTimeout(antiEntropyTimer)
      antiEntropyTimer = null
    }
  }

  return {
    reconcile: ({ devices, from, until, checkpointsByDevice = {} }) => {
      if (from === null) {
        return
      }

      const selectedDeviceIds = new Set(devices.map((device) => device.device_id))
      for (const deviceId of jobsByDeviceId.keys()) {
        if (!selectedDeviceIds.has(deviceId)) {
          jobsByDeviceId.delete(deviceId)
          failedDeviceIds.delete(deviceId)
        }
      }
      for (const deviceId of completedDevicesById.keys()) {
        if (!selectedDeviceIds.has(deviceId)) {
          completedDevicesById.delete(deviceId)
          antiEntropyFailedDeviceIds.delete(deviceId)
        }
      }
      for (let index = deviceQueue.length - 1; index >= 0; index -= 1) {
        const deviceId = deviceQueue[index]
        if (deviceId !== undefined && !selectedDeviceIds.has(deviceId)) {
          deviceQueue.splice(index, 1)
        }
      }

      const missionStartMs = Math.min(from.getTime(), until.getTime())
      const targetMs = until.getTime()
      const orderedDevices = [...devices].sort((left, right) =>
        compareStringsByCodeUnit(left.device_id, right.device_id),
      )
      for (const device of orderedDevices) {
        const initialRange = resolveInitialHistoryRange(
          checkpointsByDevice[device.device_id],
          missionStartMs,
          targetMs,
        )
        const completedDevice = completedDevicesById.get(device.device_id)
        if (completedDevice !== undefined) {
          if (initialRange.historyFromMs < completedDevice.missionStartMs) {
            completedDevicesById.delete(device.device_id)
            initialStartedAtMs ??= Date.now()
            const expansionJob: DeviceReconciliationJob = {
              deviceId: device.device_id,
              deviceName: device.name,
              cursorMs: Math.min(
                initialRange.cursorMs,
                completedDevice.missionStartMs,
              ),
              targetMs: completedDevice.missionStartMs,
              missionStartMs: initialRange.historyFromMs,
              initialTargetMs: Math.max(completedDevice.initialTargetMs, targetMs),
              latestAvailableTargetMs: Math.max(
                completedDevice.latestAvailableTargetMs,
                targetMs,
              ),
              failureCount: 0,
              retryAtMs: 0,
            }
            jobsByDeviceId.set(device.device_id, expansionJob)
            deviceQueue.push(device.device_id)
            continue
          }
          completedDevice.latestAvailableTargetMs = Math.max(
            completedDevice.latestAvailableTargetMs,
            targetMs,
          )
          continue
        }
        const pendingJob = jobsByDeviceId.get(device.device_id)
        if (pendingJob !== undefined) {
          if (initialRange.historyFromMs < pendingJob.missionStartMs) {
            const expansionJob: DeviceReconciliationJob = {
              deviceId: device.device_id,
              deviceName: device.name,
              cursorMs: Math.min(initialRange.cursorMs, pendingJob.missionStartMs),
              targetMs: Math.max(pendingJob.targetMs, targetMs),
              missionStartMs: initialRange.historyFromMs,
              initialTargetMs: Math.max(pendingJob.initialTargetMs, targetMs),
              latestAvailableTargetMs: Math.max(
                pendingJob.latestAvailableTargetMs,
                targetMs,
              ),
              failureCount: 0,
              retryAtMs: 0,
            }
            jobsByDeviceId.set(device.device_id, expansionJob)
            failedDeviceIds.delete(device.device_id)
            if (!deviceQueue.includes(device.device_id)) {
              deviceQueue.push(device.device_id)
            }
          }
          continue
        }
        if (targetMs <= missionStartMs) {
          completedDevicesById.set(device.device_id, {
            deviceId: device.device_id,
            deviceName: device.name,
            missionStartMs,
            initialTargetMs: targetMs,
            antiEntropyCursorMs: missionStartMs,
            antiEntropyTargetMs: targetMs,
            latestAvailableTargetMs: targetMs,
          })
          continue
        }
        initialStartedAtMs ??= Date.now()
        const job = {
          deviceId: device.device_id,
          deviceName: device.name,
          cursorMs: initialRange.cursorMs,
          targetMs,
          missionStartMs: initialRange.historyFromMs,
          initialTargetMs: targetMs,
          latestAvailableTargetMs: targetMs,
          failureCount: 0,
          retryAtMs: 0,
        }
        if (initialRange.cursorMs >= targetMs) {
          completeInitialJob(job)
        } else {
          jobsByDeviceId.set(device.device_id, job)
          deviceQueue.push(device.device_id)
        }
      }
      for (const deviceId of jobsByDeviceId.keys()) {
        const job = jobsByDeviceId.get(deviceId)
        if (
          job !== undefined &&
          !activeInitialJobs.has(job) &&
          !deviceQueue.includes(deviceId)
        ) {
          deviceQueue.push(deviceId)
        }
      }

      publishProgress()
      startDrain()
      scheduleAntiEntropy()
    },
    getProgress,
    suspend,
    reset: () => {
      suspend()
      // A reset is a hard mission boundary. Requests from the previous mission
      // may still be unresolved, but their concurrency slots must not prevent
      // the new mission from starting. `processJob`'s generation check still
      // discards any late result from those requests. Ordinary `suspend()`
      // deliberately retains this set so resuming the same mission cannot
      // duplicate an in-flight history window.
      activeInitialJobs.clear()
      jobsByDeviceId.clear()
      completedDevicesById.clear()
      failedDeviceIds.clear()
      antiEntropyFailedDeviceIds.clear()
      deviceQueue.length = 0
      antiEntropyNextDeviceIndex = 0
      initialStartedAtMs = null
      antiEntropyStartedAtMs = null
    },
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 1
    ? Math.round(Number(value))
    : fallback
}

function countChunks(fromMs: number, toMs: number, chunkMs: number): number {
  return Math.max(0, Math.ceil(Math.max(0, toMs - fromMs) / chunkMs))
}

function resolveInitialHistoryRange(
  checkpoint: {
    readonly historyFrom: string
    readonly reconciledUntil: string
  } | undefined,
  missionStartMs: number,
  targetMs: number,
): { readonly historyFromMs: number; readonly cursorMs: number } {
  if (checkpoint === undefined) {
    return { historyFromMs: missionStartMs, cursorMs: missionStartMs }
  }
  const checkpointStartMs = Date.parse(checkpoint.historyFrom)
  const checkpointCursorMs = Date.parse(checkpoint.reconciledUntil)
  if (
    !Number.isFinite(checkpointStartMs) ||
    !Number.isFinite(checkpointCursorMs) ||
    checkpointStartMs < missionStartMs ||
    checkpointStartMs > targetMs ||
    checkpointCursorMs < checkpointStartMs ||
    checkpointCursorMs > targetMs
  ) {
    return { historyFromMs: missionStartMs, cursorMs: missionStartMs }
  }
  return { historyFromMs: checkpointStartMs, cursorMs: checkpointCursorMs }
}
