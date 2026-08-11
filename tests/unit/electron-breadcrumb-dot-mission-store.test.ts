import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs')

let userDataPath: string | undefined
let store: { readonly close: () => void } | undefined

afterEach(async () => {
  store?.close()
  store = undefined
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
})

describe('Electron mission-store exact breadcrumb dots', () => {
  it('serializes exact and line workers and drains exact cancellation before replacement', async () => {
    let rejectExact: (error: Error) => void = () => undefined
    const runBreadcrumbDotQueryInWorker = vi.fn().mockImplementation(
      (input: { readonly signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          input.signal.addEventListener('abort', () => {
            rejectExact = reject
          }, { once: true })
        }),
    )
    const runBreadcrumbQueryInWorker = vi.fn().mockResolvedValue({
      positions: [],
      deviceTotals: [],
      deviceSelections: [],
      droppedPositionCount: 0,
    })
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-store-'))
    const missionStore = createElectronMissionStore({
      userDataPath,
      runBreadcrumbDotQueryInWorker,
      runBreadcrumbQueryInWorker,
    })
    store = missionStore
    const dotQuery = missionStore.listExactBreadcrumbDotPage({
      missionId: 'mission-a',
      activeDeviceIds: [],
      limit: 10_000,
      direction: 'latest',
    }, '41:exact-dot:request-1')
    await vi.waitFor(() => expect(runBreadcrumbDotQueryInWorker).toHaveBeenCalledOnce())
    const lineQuery = missionStore.listBreadcrumbPositions(
      'mission-b',
      5_000,
      '42:request-1',
    )
    expect(runBreadcrumbQueryInWorker).not.toHaveBeenCalled()

    const cancellation = missionStore.cancelExactBreadcrumbDotQuery(
      '41:exact-dot:request-1',
    )
    const abortError = new Error('exact worker terminated')
    abortError.name = 'AbortError'
    rejectExact(abortError)

    await expect(cancellation).resolves.toBe(true)
    await expect(dotQuery).rejects.toMatchObject({ name: 'AbortError' })
    await expect(lineQuery).resolves.toEqual(expect.objectContaining({ positions: [] }))
    expect(runBreadcrumbQueryInWorker).toHaveBeenCalledOnce()
  })
})
