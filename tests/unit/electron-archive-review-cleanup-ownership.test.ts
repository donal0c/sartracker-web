import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const RESTORE_BOUNDARY_FILES = [
  'archive-restore.cjs',
  'archive-restore-runner.cjs',
  'archive-restore-worker.cjs',
  'legacy-archive-restore.cjs',
  'legacy-archive-restore-runner.cjs',
  'legacy-archive-restore-worker.cjs',
] as const

describe('archive review plaintext cleanup ownership [DON-253]', () => {
  it('leaves failed restore residue to the main-isolate identity-pinned session sweeper', async () => {
    const sources = await Promise.all(RESTORE_BOUNDARY_FILES.map(async (fileName) => ({
      fileName,
      source: await readFile(path.resolve('electron', fileName), 'utf8'),
    })))

    for (const { fileName, source } of sources) {
      expect(source, `${fileName} must not recursively remove a path after an attacker can rebind it`)
        .not.toMatch(/\brm(?:Sync)?\s*\([^\n]{0,300}recursive\s*:\s*true/u)
    }

    const managerSource = await readFile(
      path.resolve('electron/archive-review-sessions.cjs'),
      'utf8',
    )
    expect(managerSource).toContain('removeOwnedSessionDirectory')
    expect(managerSource).toContain('await Promise.resolve(opening.operation.workerExited')
    expect(managerSource).toContain('await sweepOpening(opening)')
  })
})
