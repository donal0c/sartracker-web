import os from 'node:os'
import path from 'node:path'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  TEMPORARY_PROFILE_PREFIX,
  checkProfileWritable,
  describeUnwritableProfile,
  removeStaleTemporaryProfiles,
} = require('../../electron/profile-writability.cjs')

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'sartracker-profile-probe-')) })
afterEach(() => {
  chmodSync(root, 0o755)
  rmSync(root, { recursive: true, force: true })
})

describe('profile writability [DON-285]', () => {
  it('accepts a writable profile and leaves no probe file behind', () => {
    expect(checkProfileWritable(root)).toEqual({ writable: true })
    expect(readdirSync(root)).toEqual([])
  })

  it('is not fooled by a probe file left behind by an earlier killed launch', () => {
    writeFileSync(path.join(root, `.sartracker-write-probe-${process.pid}`), '')
    expect(checkProfileWritable(root)).toEqual({ writable: true })
  })

  it('removes its own probe even when closing it fails', () => {
    const unlinkSync = vi.fn()
    const fsImpl = {
      mkdirSync: vi.fn(),
      openSync: vi.fn(() => 7),
      closeSync: vi.fn(() => { throw Object.assign(new Error('io'), { code: 'EIO' }) }),
      unlinkSync,
    }
    expect(checkProfileWritable(root, fsImpl)).toEqual({ writable: false, code: 'EIO' })
    expect(unlinkSync).toHaveBeenCalledOnce()
  })

  it('creates a missing profile folder like a first launch', () => {
    const profile = path.join(root, 'new-profile')
    expect(checkProfileWritable(profile)).toEqual({ writable: true })
  })

  it.skipIf(process.getuid?.() === 0)('reports a read-only profile with its error code', () => {
    chmodSync(root, 0o555)
    expect(checkProfileWritable(root)).toEqual({ writable: false, code: 'EACCES' })
  })

  it('reports a failure it cannot classify instead of passing it', () => {
    const fsImpl = {
      mkdirSync: vi.fn(),
      openSync: vi.fn(() => { throw Object.assign(new Error('no space'), { code: 'ENOSPC' }) }),
      closeSync: vi.fn(),
      unlinkSync: vi.fn(),
    }
    expect(checkProfileWritable(root, fsImpl)).toEqual({ writable: false, code: 'ENOSPC' })
  })

  it('tells the operator what to do, by cause', () => {
    const denied = describeUnwritableProfile('/home/team/.config/SAR Tracker', 'EACCES')
    expect(denied.title).toBe('SAR Tracker cannot start')
    expect(denied.message).toContain('cannot write to its data folder')
    expect(denied.message).toContain('/home/team/.config/SAR Tracker')
    expect(denied.message).toMatch(/permission/iu)
    expect(describeUnwritableProfile('/p', 'ENOSPC').message).toMatch(/disk is full/iu)
    expect(describeUnwritableProfile('/p', 'EROFS').message).toMatch(/read-only/iu)
  })

  it('removes only stale temporary profiles from earlier failed launches', () => {
    const old = new Date(Date.now() - 2 * 60 * 60_000)
    const stale = path.join(root, `${TEMPORARY_PROFILE_PREFIX}stale`)
    const fresh = path.join(root, `${TEMPORARY_PROFILE_PREFIX}fresh`)
    const unrelated = path.join(root, 'unrelated-folder')
    const target = path.join(root, 'link-target')
    for (const folder of [stale, fresh, unrelated, target]) mkdirSync(folder)
    const link = path.join(root, `${TEMPORARY_PROFILE_PREFIX}link`)
    symlinkSync(target, link)
    for (const folder of [stale, unrelated, target]) utimesSync(folder, old, old)

    removeStaleTemporaryProfiles(root, Date.now())

    expect(readdirSync(root).sort()).toEqual([
      'link-target',
      `${TEMPORARY_PROFILE_PREFIX}fresh`,
      `${TEMPORARY_PROFILE_PREFIX}link`,
      'unrelated-folder',
    ])
  })
})
