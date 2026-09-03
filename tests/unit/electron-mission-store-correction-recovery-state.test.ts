import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: Readonly<Record<string, unknown>>) => {
    readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly getMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('startup correction custody renderer state', () => {
  it('does not project a live mission while attachment recovery is pending', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-recovery-state-'))
    roots.push(root)
    await mkdir(path.join(root, 'correction-attachment-journals'))
    let release!: (value: Readonly<Record<string, unknown>>) => void
    const operation = Object.assign(new Promise((resolve) => { release = resolve }), {
      workerExited: Promise.resolve(),
    })
    const store = createElectronMissionStore({
      userDataPath: root,
      startArchiveCorrectionAttachmentRecovery: () => operation,
    })
    try {
      const mission = await store.createMission({ name: 'Recovery-gated mission' })
      const projected = await store.getMission(mission.id)
      expect(projected).toMatchObject({
        status: 'active',
        storage_state: 'recovery_required',
      })
    } finally {
      release({ recovered: 0 })
      await operation
      await store.prepareClose()
      store.close()
    }
  })
})
