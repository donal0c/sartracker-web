import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (databasePath: string) => TestDatabase
const {
  CORRECTION_ATTACHMENT_CUSTODY_KEY,
  clearCorrectionAttachmentCustody,
  createCorrectionAttachmentCustodyPlan,
  readCorrectionAttachmentCustody,
  writeCorrectionAttachmentCustody,
} = require('../../electron/archive-correction-custody.cjs') as CustodyModule

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
    readonly run: (...parameters: readonly unknown[]) => unknown
  }
  readonly close: () => void
  readonly transaction: <T>(callback: () => T) => (() => T)
}

type CustodyModule = {
  readonly CORRECTION_ATTACHMENT_CUSTODY_KEY: string
  readonly createCorrectionAttachmentCustodyPlan: (input: Readonly<Record<string, unknown>>) => {
    readonly operationId: string
    readonly entries: readonly {
      readonly sourceRelativePath: string
      readonly targetName: string
      readonly peerName: string
    }[]
  }
  readonly writeCorrectionAttachmentCustody: (db: TestDatabase, plan: unknown) => void
  readonly readCorrectionAttachmentCustody: (db: TestDatabase) => unknown
  readonly clearCorrectionAttachmentCustody: (db: TestDatabase, operationId: string) => void
}

const MISSION_ID = '11111111-1111-4111-8111-111111111111'
const ARCHIVE_ID = '22222222-2222-4222-8222-222222222222'
const OPERATION_ID = '33333333-3333-4333-8333-333333333333'
const roots = new Set<string>()

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })))
  roots.clear()
})

describe('archive correction directory capability', () => {
  it('stores one bounded correction plan in SQLite and clears only the matching operation', () => {
    const root = require('node:fs').mkdtempSync(path.join(tmpdir(), 'sartracker-correction-plan-')) as string
    roots.add(root)
    const db = new Database(path.join(root, 'mission-store.sqlite'))
    db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const plan = createPlan()

    writeCorrectionAttachmentCustody(db, plan)
    expect(readCorrectionAttachmentCustody(db)).toEqual(plan)
    expect(() => clearCorrectionAttachmentCustody(db, 'different-operation')).toThrow(/operation/iu)
    expect(readCorrectionAttachmentCustody(db)).toEqual(plan)

    db.transaction(() => clearCorrectionAttachmentCustody(db, OPERATION_ID))()
    expect(readCorrectionAttachmentCustody(db)).toBeNull()
    expect(CORRECTION_ATTACHMENT_CUSTODY_KEY).toMatch(/^archive_correction_/u)
    db.close()
  })

  it('derives bounded operation-owned target and retained-peer names', () => {
    const plan = createPlan()
    expect(plan.entries).toHaveLength(1)
    const [entry] = plan.entries
    expect(entry.sourceRelativePath).toBe('field photo.jpg')
    expect(entry.targetName).toMatch(/^correction-[a-f0-9-]+-field-photo-[a-f0-9]+\.jpg$/u)
    expect(entry.peerName).toBe(`.${entry.targetName}.custody`)
    expect(Buffer.byteLength(entry.peerName, 'utf8')).toBeLessThanOrEqual(180)
    expect(path.basename(entry.targetName)).toBe(entry.targetName)
    expect(path.basename(entry.peerName)).toBe(entry.peerName)
  })

  it('publishes only inside the cwd-pinned original after its pathname is rebound', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-capability-'))
    roots.add(root)
    const namedRoot = path.join(root, 'attachments')
    const heldRoot = path.join(root, 'attachments-held')
    const replacement = path.join(root, 'replacement')
    const sourcePath = path.join(root, 'source.bin')
    await Promise.all([
      mkdir(namedRoot),
      mkdir(replacement),
      writeFile(sourcePath, 'verified correction bytes', { mode: 0o600 }),
    ])
    await writeFile(path.join(replacement, 'victim.txt'), 'outside custody', { mode: 0o600 })
    const childPath = path.join(
      process.cwd(),
      'tests/fixtures/archive-correction-capability-child.cjs',
    )
    const child = fork(childPath, [], { cwd: namedRoot, silent: true })
    const ready = await nextMessage(child) as { readonly type: string }
    expect(ready.type).toBe('ready')
    await rename(namedRoot, heldRoot)
    await rename(replacement, namedRoot)
    const bytes = Buffer.from('verified correction bytes')
    const targetName = 'correction-aaaaaaaaaaaaaaaa-0000-field-bbbbbbbbbbbbbbbb.bin'
    const peerName = `.${targetName}.custody`
    child.send({
      sourcePath,
      targetName,
      peerName,
      expected: {
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    })
    const complete = await nextMessage(child) as { readonly type: string }
    expect(complete.type).toBe('complete')
    await onceExit(child)

    await expect(readFile(path.join(namedRoot, 'victim.txt'), 'utf8'))
      .resolves.toBe('outside custody')
    await expect(readFile(path.join(namedRoot, targetName))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(heldRoot, targetName), 'utf8'))
      .resolves.toBe('verified correction bytes')
    const [targetStat, peerStat] = await Promise.all([
      stat(path.join(heldRoot, targetName)),
      stat(path.join(heldRoot, peerName)),
    ])
    expect(targetStat.ino).toBe(peerStat.ino)
    expect(targetStat.nlink).toBe(2)
    expect((await lstat(path.join(heldRoot, targetName))).isSymbolicLink()).toBe(false)
  })
})

function createPlan() {
  return createCorrectionAttachmentCustodyPlan({
    missionId: MISSION_ID,
    archiveId: ARCHIVE_ID,
    operationId: OPERATION_ID,
    finalizedEpoch: 42,
    targetIdentity: { dev: '1', ino: '2' },
    mappings: [{
      entryName: 'attachments/field-photo.jpg',
      sourceRelativePath: 'field photo.jpg',
      sha256: 'a'.repeat(64),
      sizeBytes: 24,
      references: [],
    }],
  })
}

function nextMessage(child: ReturnType<typeof fork>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`Capability child exited ${code}.`))
    })
  })
}

function onceExit(child: ReturnType<typeof fork>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      if (child.exitCode === 0) resolve()
      else reject(new Error(`Capability child exited ${child.exitCode}.`))
      return
    }
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Capability child exited ${code}.`))
    })
    child.once('error', reject)
  })
}
