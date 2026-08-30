import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (
    options: Readonly<Record<string, unknown>>,
  ) => ElectronMissionStore
}

type ArchiveWorkerOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

type ArchiveWorkerInput = {
  readonly signal?: AbortSignal
}

type ElectronMissionStore = {
  readonly createMission: (input: {
    readonly name: string
    readonly start_time?: string
  }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
  }) => Promise<unknown>
  readonly addPosition: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly source_position_id: string
    readonly lat: number
    readonly lon: number
    readonly timestamp: string
  }) => Promise<unknown>
  readonly latestPositions: (
    missionId: string,
  ) => Promise<readonly { readonly device_id: string; readonly lat: number }[]>
  readonly getActiveMission: () => Promise<{ readonly id: string } | null>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (
    missionId: string,
    custody: typeof CUSTODY,
    context?: ArchiveOperationContext,
  ) => Promise<unknown>
  readonly listMissionArchives: (
    missionId: string,
  ) => Promise<readonly { readonly id: string }[]>
  readonly verifyMissionArchive: (
    input: {
      readonly archiveId: string
      readonly passphrase: string
      readonly recoveryCode: string
    },
    context?: ArchiveOperationContext,
  ) => Promise<unknown>
  readonly cancelMissionArchiveOperation: (operationId: string) => Promise<boolean>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}

type ArchiveOperationContext = {
  readonly operationId: string
  readonly onProgress: (progress: Readonly<Record<string, unknown>>) => void
}

type ControlledEntry = {
  readonly kind: 'create' | 'verify'
  readonly fail: (code?: string) => void
}

const CUSTODY = Object.freeze({
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})
const temporaryDirectories = new Set<string>()

/** Creates an already-settled failed worker with an independently settled exit promise. */
function failedWorkerOperation(code: string): ArchiveWorkerOperation {
  const operation = Promise.reject(Object.assign(
    new Error('Injected archive worker failure.'),
    { code },
  )) as ArchiveWorkerOperation
  Object.defineProperties(operation, {
    workerExited: { value: Promise.resolve() },
    cancel: { value: () => undefined },
  })
  return operation
}

/** Tracks entry and physical exit for injected archive-family workers. */
function createControlledArchiveFamily() {
  const entries: ControlledEntry[] = []
  let activeWorkerCount = 0
  let maximumActiveWorkerCount = 0

  const start = (
    kind: ControlledEntry['kind'],
    input: ArchiveWorkerInput,
  ): ArchiveWorkerOperation => {
    let rejectCompletion: (error: Error) => void = () => undefined
    let resolveWorkerExit = () => undefined
    let settled = false
    const workerExited = new Promise<void>((resolve) => {
      resolveWorkerExit = resolve
    })
    const operation = new Promise<Readonly<Record<string, unknown>>>(
      (_resolve, reject) => {
        rejectCompletion = reject
      },
    ) as ArchiveWorkerOperation

    activeWorkerCount += 1
    maximumActiveWorkerCount = Math.max(maximumActiveWorkerCount, activeWorkerCount)

    const fail = (code = 'ARCHIVE_TEST_RELEASE') => {
      if (settled) return
      settled = true
      activeWorkerCount -= 1
      const error = Object.assign(new Error('Injected archive worker release.'), { code })
      if (code === 'ARCHIVE_CANCELLED') error.name = 'AbortError'
      rejectCompletion(error)
      resolveWorkerExit()
    }
    const cancel = () => fail('ARCHIVE_CANCELLED')
    input.signal?.addEventListener('abort', cancel, { once: true })
    Object.defineProperties(operation, {
      workerExited: { value: workerExited },
      cancel: { value: cancel },
    })
    entries.push({ kind, fail })
    return operation
  }

  return {
    entries,
    start,
    get maximumActiveWorkerCount() {
      return maximumActiveWorkerCount
    },
  }
}

/** Observes a promise immediately so deliberately held worker failures are never unhandled. */
function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: Error & { readonly code?: string }) => ({
      status: 'rejected' as const,
      reason,
    }),
  )
}

/** Produces a real sealed archive whose first verifier is deliberately unavailable. */
async function createSealedArchiveFixture(userDataPath: string) {
  const store = createElectronMissionStore({
    userDataPath,
    startArchiveVerifyWorker: () => failedWorkerOperation(
      'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
    ),
  })
  try {
    const mission = await store.createMission({ name: 'Archive lane source mission' })
    await store.finishMission(mission.id)
    await expect(store.finalizeMission(mission.id, CUSTODY)).rejects.toMatchObject({
      code: 'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
    })
    const archives = await store.listMissionArchives(mission.id)
    expect(archives).toHaveLength(1)
    return Object.freeze({
      archiveId: archives[0].id,
      missionId: mission.id,
    })
  } finally {
    await store.prepareClose()
    store.close()
  }
}

/** Returns the trusted renderer-operation context used by the mission store. */
function operationContext(operationId: string): ArchiveOperationContext {
  return Object.freeze({ operationId, onProgress: () => undefined })
}

/** Allows all immediately queued promise continuations to request their worker slot. */
async function allowQueueTurn() {
  await new Promise<void>((resolve) => setTimeout(resolve, 20))
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

describe('mission-store shared archive-family resource lane', () => {
  it('never enters two distinct verification retry workers concurrently', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-lane-retries-'))
    temporaryDirectories.add(userDataPath)
    const fixture = await createSealedArchiveFixture(userDataPath)
    const family = createControlledArchiveFamily()
    const startArchiveVerifyWorker = vi.fn((input: ArchiveWorkerInput) =>
      family.start('verify', input))
    const store = createElectronMissionStore({ userDataPath, startArchiveVerifyWorker })

    try {
      const first = observe(store.verifyMissionArchive({
        archiveId: fixture.archiveId,
        ...CUSTODY,
      }, operationContext('archive-verify-lane-first')))
      const second = observe(store.verifyMissionArchive({
        archiveId: fixture.archiveId,
        ...CUSTODY,
      }, operationContext('archive-verify-lane-second')))

      await vi.waitFor(() => expect(family.entries.length).toBeGreaterThanOrEqual(1))
      await allowQueueTurn()
      const workerCountBeforeFirstExit = family.entries.length
      family.entries[0].fail()
      await vi.waitFor(() => expect(family.entries.length).toBeGreaterThanOrEqual(2))
      family.entries[1].fail()
      await Promise.all([first, second])

      expect(workerCountBeforeFirstExit).toBe(1)
      expect(family.maximumActiveWorkerCount).toBe(1)
      expect(startArchiveVerifyWorker).toHaveBeenCalledTimes(2)
    } finally {
      for (const entry of family.entries) entry.fail()
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('does not enter a verification retry while encrypted create/finalize owns the lane', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-lane-create-'))
    temporaryDirectories.add(userDataPath)
    const fixture = await createSealedArchiveFixture(userDataPath)
    const family = createControlledArchiveFamily()
    const store = createElectronMissionStore({
      userDataPath,
      startMissionArchiveCreateWorker: (input: ArchiveWorkerInput) =>
        family.start('create', input),
      startArchiveVerifyWorker: (input: ArchiveWorkerInput) =>
        family.start('verify', input),
    })

    try {
      const nextMission = await store.createMission({ name: 'Archive lane create mission' })
      await store.finishMission(nextMission.id)
      const finalization = observe(store.finalizeMission(
        nextMission.id,
        CUSTODY,
        operationContext('66666666-6666-4666-8666-666666666666'),
      ))
      await vi.waitFor(() => expect(family.entries).toHaveLength(1))
      expect(family.entries[0].kind).toBe('create')

      const verification = observe(store.verifyMissionArchive({
        archiveId: fixture.archiveId,
        ...CUSTODY,
      }, operationContext('archive-verify-lane-waiter')))
      await allowQueueTurn()
      const verificationEnteredBeforeCreateExit = family.entries.some(
        (entry) => entry.kind === 'verify',
      )

      family.entries[0].fail()
      await finalization
      await vi.waitFor(() => expect(
        family.entries.some((entry) => entry.kind === 'verify'),
      ).toBe(true))
      family.entries.find((entry) => entry.kind === 'verify')?.fail()
      await verification

      expect(verificationEnteredBeforeCreateExit).toBe(false)
      expect(family.maximumActiveWorkerCount).toBe(1)
    } finally {
      for (const entry of family.entries) entry.fail()
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('cancels a queued retry before worker entry while live positions stay below 200 ms', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-lane-cancel-'))
    temporaryDirectories.add(userDataPath)
    const fixture = await createSealedArchiveFixture(userDataPath)
    const family = createControlledArchiveFamily()
    const store = createElectronMissionStore({
      userDataPath,
      startArchiveVerifyWorker: (input: ArchiveWorkerInput) =>
        family.start('verify', input),
    })

    try {
      const liveMission = await store.createMission({ name: 'Live archive lane mission' })
      await store.upsertDevice({
        mission_id: liveMission.id,
        device_id: 'team-live-1',
        name: 'Team Live One',
        color: '#00AAFF',
        status: 'online',
      })

      const owner = observe(store.verifyMissionArchive({
        archiveId: fixture.archiveId,
        ...CUSTODY,
      }, operationContext('archive-verify-lane-owner')))
      await vi.waitFor(() => expect(family.entries).toHaveLength(1))
      const queued = observe(store.verifyMissionArchive({
        archiveId: fixture.archiveId,
        ...CUSTODY,
      }, operationContext('archive-verify-lane-cancelled')))
      await allowQueueTurn()

      const writeStartedAt = performance.now()
      await store.addPosition({
        mission_id: liveMission.id,
        device_id: 'team-live-1',
        source_position_id: 'archive-lane-live-fix-1',
        lat: 52.0599,
        lon: -9.5045,
        timestamp: '2026-08-30T12:00:00.000Z',
      })
      const writeDurationMs = performance.now() - writeStartedAt

      const latestReadStartedAt = performance.now()
      const latest = await store.latestPositions(liveMission.id)
      const latestReadDurationMs = performance.now() - latestReadStartedAt
      const currentReadStartedAt = performance.now()
      const current = await store.getActiveMission()
      const currentReadDurationMs = performance.now() - currentReadStartedAt

      await expect(
        store.cancelMissionArchiveOperation('archive-verify-lane-cancelled'),
      ).resolves.toBe(true)
      const queuedResult = await queued
      const workerCountBeforeOwnerExit = family.entries.length
      family.entries[0].fail()
      await owner

      expect(queuedResult).toMatchObject({
        status: 'rejected',
        reason: { code: 'ARCHIVE_CANCELLED' },
      })
      expect(writeDurationMs).toBeLessThan(200)
      expect(latestReadDurationMs).toBeLessThan(200)
      expect(currentReadDurationMs).toBeLessThan(200)
      expect(latest).toMatchObject([
        { device_id: 'team-live-1', lat: 52.0599 },
      ])
      expect(current).toMatchObject({ id: liveMission.id })
      expect(workerCountBeforeOwnerExit).toBe(1)
      expect(family.maximumActiveWorkerCount).toBe(1)
    } finally {
      for (const entry of family.entries) entry.fail()
      await store.prepareClose()
      store.close()
    }
  }, 60_000)
})
