import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: Readonly<Record<string, unknown>>) => {
    readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
    readonly finishMission: (missionId: string) => Promise<unknown>
    readonly finalizeMission: (
      missionId: string,
      custody: typeof custody,
    ) => Promise<unknown>
    readonly latestPositions: (missionId: string) => Promise<readonly unknown[]>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}

type SweepOperation = Promise<Readonly<Record<string, unknown>>> & {
  readonly workerExited: Promise<void>
  readonly cancel: () => void
}

const custody = Object.freeze({
  passphrase: 'Four calm words 2026!',
  recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
})
const temporaryDirectories = new Set<string>()

/** Creates one controllable archive-sweep operation with separate logical and physical exit. */
function createDeferredSweep() {
  let resolveCompletion: (value: Readonly<Record<string, unknown>>) => void = () => undefined
  let rejectCompletion: (error: Error) => void = () => undefined
  let resolveExit = () => undefined
  const completion = new Promise<Readonly<Record<string, unknown>>>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  }) as SweepOperation
  const workerExited = new Promise<void>((resolve) => { resolveExit = resolve })
  const cancel = vi.fn(() => {
    const error = new Error('Archive plaintext sweep worker was cancelled.')
    error.name = 'AbortError'
    Object.assign(error, { code: 'ARCHIVE_CANCELLED' })
    rejectCompletion(error)
  })
  Object.defineProperties(completion, {
    workerExited: { value: workerExited },
    cancel: { value: cancel },
  })
  return {
    operation: completion,
    resolve: () => resolveCompletion({ status: 'clean', removedEntryCount: 0 }),
    reject: (code: string) => {
      const error = new Error('Archive plaintext sweep failed safely.')
      Object.assign(error, { code })
      rejectCompletion(error)
      resolveExit()
    },
    resolveExit,
    cancel,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

describe('mission-store archive plaintext startup sweep', () => {
  it('keeps live reads available while archive work waits for the startup sweep', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-sweep-gate-'))
    temporaryDirectories.add(userDataPath)
    mkdirSync(path.join(userDataPath, 'archives', '.verification'), { recursive: true })
    const sweep = createDeferredSweep()
    const store = createElectronMissionStore({
      userDataPath,
      startArchivePlaintextSweep: () => sweep.operation,
      archiveLifecycleFaultInjection: { afterRequestBeforeWorker: true },
    })
    const mission = await store.createMission({ name: 'Sweep gate mission' })
    await store.finishMission(mission.id)

    const readStarted = performance.now()
    await expect(store.latestPositions(mission.id)).resolves.toEqual([])
    expect(performance.now() - readStarted).toBeLessThan(200)

    let finalizationSettled = false
    const finalization = store.finalizeMission(mission.id, custody)
      .finally(() => { finalizationSettled = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(finalizationSettled).toBe(false)

    sweep.resolve()
    sweep.resolveExit()
    await expect(finalization).rejects.toMatchObject({
      code: 'ARCHIVE_SIMULATED_INTERRUPTION',
    })
    await store.prepareClose()
    store.close()
  })

  it('blocks only archive work after a failed startup sweep', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-sweep-failure-'))
    temporaryDirectories.add(userDataPath)
    mkdirSync(path.join(userDataPath, 'archives', '.verification'), { recursive: true })
    const sweep = createDeferredSweep()
    const store = createElectronMissionStore({
      userDataPath,
      startArchivePlaintextSweep: () => sweep.operation,
    })
    const mission = await store.createMission({ name: 'Sweep failure mission' })
    await store.finishMission(mission.id)
    sweep.reject('ARCHIVE_PLAINTEXT_SWEEP_ROOT_UNSAFE')

    await expect(store.latestPositions(mission.id)).resolves.toEqual([])
    await expect(store.finalizeMission(mission.id, custody)).rejects.toMatchObject({
      code: 'ARCHIVE_PLAINTEXT_SWEEP_ROOT_UNSAFE',
    })
    await store.prepareClose()
    store.close()
  })

  it('cancels and physically joins an active startup sweep before close', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-sweep-close-'))
    temporaryDirectories.add(userDataPath)
    mkdirSync(path.join(userDataPath, 'archives', '.verification'), { recursive: true })
    const sweep = createDeferredSweep()
    const store = createElectronMissionStore({
      userDataPath,
      startArchivePlaintextSweep: () => sweep.operation,
    })

    let closePrepared = false
    const prepare = store.prepareClose().then(() => { closePrepared = true })
    await Promise.resolve()
    expect(sweep.cancel).toHaveBeenCalledTimes(1)
    expect(closePrepared).toBe(false)

    sweep.resolveExit()
    await prepare
    store.close()
  })
})
