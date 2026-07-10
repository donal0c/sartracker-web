import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

import {
  generateMissionStoreFixture,
  restartCheckpointDayForPoll,
} from '../../build/seed-mission-store-runtime.js'
import { createFixturePlan } from '../../build/seed-mission-store-lib.js'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly readAdminRoster: () => Promise<readonly string[]>
  }) => {
    readonly close: () => void
    readonly getActiveMission: () => Promise<{ readonly id: string; readonly name: string } | null>
    readonly listDevices: (missionId: string) => Promise<readonly unknown[]>
    readonly countPositions: (missionId: string) => Promise<number>
  }
}

const tempPaths: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })))
})

describe('generateMissionStoreFixture [DON-242]', () => {
  it('atomically generates a reusable synthetic store that opens through the real adapter', async () => {
    const tempRoot = await makeTempRoot()
    const outputPath = path.join(tempRoot, 'cache', 'mission-store.sqlite')
    const copyToPath = path.join(tempRoot, 'run', 'user-data', 'mission-store.sqlite')

    const generated = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      copyToPath,
      force: false,
      progress: () => undefined,
    })

    expect(generated.reused).toBe(false)
    expect(generated.manifest.syntheticDataOnly).toBe(true)
    expect(generated.manifest.preset).toBe('small')
    expect(generated.manifest.database.bytes).toBeGreaterThanOrEqual(8 * 1024 * 1024)
    expect(generated.manifest.rows.byTable.devices).toBe(32)
    expect(generated.manifest.rows.byTable.positions).toBeGreaterThan(0)
    expect(generated.manifest.rows.byEventType.device_updated).toBeGreaterThan(0)
    expect(generated.manifest.bytes.byTable.positions).toBeGreaterThan(0)
    expect(generated.manifest.bytes.byTable.mission_events).toBeGreaterThan(0)
    await expect(sha256File(outputPath)).resolves.toBe(generated.manifest.database.sha256)
    await expect(sha256File(copyToPath)).resolves.toBe(generated.manifest.database.sha256)

    const copiedUserDataPath = path.dirname(copyToPath)
    const store = createElectronMissionStore({
      userDataPath: copiedUserDataPath,
      readAdminRoster: async () => [],
    })
    try {
      const activeMission = await store.getActiveMission()
      expect(activeMission?.name).toBe('SYNTHETIC FIELD-SCALE VALIDATION MISSION')
      expect(await store.listDevices(activeMission!.id)).toHaveLength(32)
      expect(await store.countPositions(activeMission!.id)).toBe(
        generated.manifest.rows.byTable.positions,
      )
    } finally {
      store.close()
    }

    const originalStat = await stat(outputPath)
    const reused = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })
    expect(reused.reused).toBe(true)
    expect((await stat(outputPath)).mtimeMs).toBe(originalStat.mtimeMs)
  }, 30_000)

  it('preserves an existing known-good fixture when forced regeneration is interrupted', async () => {
    const tempRoot = await makeTempRoot()
    const outputPath = path.join(tempRoot, 'cache', 'mission-store.sqlite')
    const first = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })

    await expect(
      generateMissionStoreFixture({
        preset: 'small',
        outputPath,
        force: true,
        progress: () => undefined,
        faultInjection: { afterPollBatches: 1 },
      }),
    ).rejects.toThrow(/Injected fixture generation interruption/u)

    await expect(sha256File(outputPath)).resolves.toBe(first.manifest.database.sha256)
    const manifest = JSON.parse(
      await readFile(`${outputPath}.manifest.json`, 'utf8'),
    ) as typeof first.manifest
    expect(manifest.database.sha256).toBe(first.manifest.database.sha256)

    await expect(
      generateMissionStoreFixture({
        preset: 'small',
        outputPath,
        force: true,
        progress: () => undefined,
        faultInjection: { afterDatabaseSwap: true },
      }),
    ).rejects.toThrow(/Injected fixture replacement interruption/u)

    const recovered = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })
    expect(recovered.reused).toBe(true)
    expect(recovered.manifest.database.sha256).toBe(first.manifest.database.sha256)
    await expect(sha256File(outputPath)).resolves.toBe(first.manifest.database.sha256)
  }, 30_000)
})

describe('restartCheckpointDayForPoll [DON-242]', () => {
  it('marks exact accumulated day boundaries without resetting the mission', () => {
    const plan = createFixturePlan('mission-5d')

    expect(restartCheckpointDayForPoll(plan, 17_279)).toBeNull()
    expect(restartCheckpointDayForPoll(plan, 17_280)).toBe(1)
    expect(restartCheckpointDayForPoll(plan, 34_560)).toBe(2)
    expect(restartCheckpointDayForPoll(plan, 69_120)).toBe(4)
    expect(restartCheckpointDayForPoll(plan, 86_400)).toBeNull()
  })

  it('keeps the field-scale checkpoint schedule through day fourteen', () => {
    const plan = createFixturePlan('field')

    expect(restartCheckpointDayForPoll(plan, 172_800)).toBe(10)
    expect(restartCheckpointDayForPoll(plan, 241_920)).toBe(14)
  })
})

async function makeTempRoot(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-seed-store-'))
  tempPaths.push(tempRoot)
  return tempRoot
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}
