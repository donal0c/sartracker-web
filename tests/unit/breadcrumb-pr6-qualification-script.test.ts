import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertFieldScaleFixture,
  deriveLivenessEvidence,
  parseTerminalCleanupJournal,
  scanEvidenceRoots,
  stageClosedFixture,
  writeQualificationEvidence,
} from '../../scripts/breadcrumb-pr6-qualification.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
})

describe('Breadcrumb PR6 scale-qualification coordinator [DON-252 / BCP-15]', () => {
  it('pins, hashes and streams a closed regular fixture into a mode-0600 copy', async () => {
    const root = await createTemporaryRoot()
    const fixturePath = path.join(root, 'field.sqlite')
    const destinationPath = path.join(root, 'profile', 'mission-store.sqlite')
    const bytes = Buffer.alloc(128 * 1024 + 31, 0x5a)
    await writeFile(fixturePath, bytes, { mode: 0o600 })

    const staged = await stageClosedFixture({ fixturePath, destinationPath })

    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(staged).toMatchObject({
      copiedBeforeOpen: true,
      sourceWasRegularFile: true,
      sourceWasSymlink: false,
      sourceWalBytes: 0,
      sourceShmBytes: 0,
      sourceSha256Before: digest,
      copiedSha256: digest,
      sourceBytes: bytes.byteLength,
      copiedBytes: bytes.byteLength,
    })
    expect(await readFile(destinationPath)).toEqual(bytes)
    expect((await lstat(destinationPath)).mode & 0o777).toBe(0o600)
  })

  it('fails closed for a symlink fixture or non-empty SQLite sidecar', async () => {
    const root = await createTemporaryRoot()
    const fixturePath = path.join(root, 'field.sqlite')
    const realPath = path.join(root, 'real.sqlite')
    const destinationPath = path.join(root, 'profile', 'mission-store.sqlite')
    await writeFile(realPath, 'sqlite', { mode: 0o600 })
    await symlink(realPath, fixturePath)

    await expect(stageClosedFixture({ fixturePath, destinationPath })).rejects.toThrow(
      'closed regular file',
    )

    await rm(fixturePath)
    await writeFile(fixturePath, 'sqlite', { mode: 0o600 })
    await writeFile(`${fixturePath}-wal`, 'uncheckpointed', { mode: 0o600 })
    await expect(stageClosedFixture({ fixturePath, destinationPath })).rejects.toThrow(
      'sidecar',
    )
  })

  it('rejects a copied database fixture that is not itself greater than 2 GiB', () => {
    expect(() => assertFieldScaleFixture({
      sourceBytes: 2 * 1024 * 1024 * 1024,
      copiedBytes: 2 * 1024 * 1024 * 1024,
    })).toThrow(/2 GiB|field scale/iu)
    expect(assertFieldScaleFixture({
      sourceBytes: 2 * 1024 * 1024 * 1024 + 1,
      copiedBytes: 2 * 1024 * 1024 * 1024 + 1,
    })).toBe(true)
  })

  it('accepts only a terminal, exhaustive cleanup journal table cursor', () => {
    const row = {
      archive_id: 'archive-a',
      state: 'completed',
      progress_json: JSON.stringify({
        version: 1,
        archiveId: 'archive-a',
        ciphertextSha256: 'a'.repeat(64),
        sizeBytes: 2_147_483_649,
        finalizationEpoch: 44,
        verificationProofSha256: 'b'.repeat(64),
        tables: ['positions', 'devices'],
        tableIndex: 2,
        tableBatch: 0,
        deletedRows: 100,
      }),
    }

    expect(parseTerminalCleanupJournal(row, 'archive-a', ['positions', 'devices'])).toEqual({
      tables: ['positions', 'devices'],
      deletedRows: 100,
    })
    expect(() => parseTerminalCleanupJournal(
      { ...row, state: 'in_progress' },
      'archive-a',
      ['positions', 'devices'],
    ))
      .toThrow('terminal')
    expect(() => parseTerminalCleanupJournal({
      ...row,
      progress_json: row.progress_json.replace('"tableIndex":2', '"tableIndex":1'),
    }, 'archive-a', ['positions', 'devices'])).toThrow('exhaust')
    expect(() => parseTerminalCleanupJournal(
      row,
      'archive-a',
      ['positions', 'devices', 'markers'],
    )).toThrow(/complete|table plan/iu)
  })

  it('derives exact per-phase maxima and fails at the immutable 200 ms gate', () => {
    const measurements = Object.fromEntries(
      ['create', 'verify', 'restore', 'cleanup'].map((phase, index) => [phase, {
        heartbeatGapsMs: [50 + index, 80 + index],
        currentCadencesMs: [70 + index, 90 + index],
        currentWrites: 2,
        visibleWrites: 2,
      }]),
    )

    expect(deriveLivenessEvidence(measurements)).toEqual({
      heartbeatMaxGapMs: 83,
      currentPositionMaxCadenceMs: 93,
      currentPositionsIndependent: true,
      byPhase: {
        create: phaseEvidence(80, 90),
        verify: phaseEvidence(81, 91),
        restore: phaseEvidence(82, 92),
        cleanup: phaseEvidence(83, 93),
      },
    })

    measurements.cleanup.heartbeatGapsMs.push(200)
    expect(() => deriveLivenessEvidence(measurements)).toThrow('200 ms')
  })

  it('scans exact secrets and privacy canaries across stream chunk boundaries without paths', async () => {
    const root = await createTemporaryRoot()
    const reviewRoot = path.join(root, 'review')
    const sessionRoot = path.join(reviewRoot, 'session')
    await mkdir(sessionRoot, { recursive: true, mode: 0o700 })
    const secret = 'exact-ephemeral-secret'
    const canary = 'fixture-mission-000000000001'
    await writeFile(
      path.join(sessionRoot, 'mission-store.sqlite'),
      Buffer.concat([Buffer.alloc(64 * 1024 - 7, 0x78), Buffer.from(`${secret}:${canary}`)]),
      { mode: 0o600 },
    )

    const scan = await scanEvidenceRoots({
      roots: [{ label: 'archive-review-sessions', rootPath: reviewRoot }],
      secrets: [secret],
      privacyCanary: canary,
    })

    expect(scan.filesScanned).toBe(1)
    expect(scan.appAddressablePlaintextFiles).toEqual([
      'archive-review-sessions/session/mission-store.sqlite',
    ])
    expect(scan.secretMatches).toEqual([
      'archive-review-sessions/session/mission-store.sqlite',
    ])
    expect(scan.privacyMatches).toEqual([
      'archive-review-sessions/session/mission-store.sqlite',
    ])
    expect(JSON.stringify(scan)).not.toContain(root)
  })

  it('atomically writes new mode-0600 evidence and never overwrites prior proof', async () => {
    const root = await createTemporaryRoot()
    const evidencePath = path.join(root, 'evidence', 'qualification.json')
    const evidence = { schema: 'test', passed: true }

    await writeQualificationEvidence(evidencePath, evidence)

    expect(JSON.parse(await readFile(evidencePath, 'utf8'))).toEqual(evidence)
    expect((await lstat(evidencePath)).mode & 0o777).toBe(0o600)
    await expect(writeQualificationEvidence(evidencePath, { replaced: true }))
      .rejects.toThrow('already exists')
  })
})

/** Creates one isolated unit-test directory. */
async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'breadcrumb-pr6-qualification-test-'))
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  return root
}

/** Builds one expected phase liveness projection. */
function phaseEvidence(heartbeatMaxGapMs: number, currentPositionMaxCadenceMs: number) {
  return {
    heartbeatMaxGapMs,
    currentPositionMaxCadenceMs,
    currentWrites: 2,
    visibleWrites: 2,
  }
}
