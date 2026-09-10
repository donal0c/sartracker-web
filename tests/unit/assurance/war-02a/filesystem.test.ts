// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { FaultPlan } from './fault-plan'
import { createFaultFileSystem } from './fault-filesystem'

const require = createRequire(import.meta.url)
const { writeFileDurably } = require('../../../../electron/durable-file.cjs') as {
  writeFileDurably: (file: string, contents: string, options: {
    fileSystem: ReturnType<typeof createFaultFileSystem>; platform: string; createTemporarySuffix: () => string
  }) => Promise<void>
}

describe('WAR-02A real filesystem boundaries', () => {
  for (const operation of ['file.open', 'file.write', 'file.sync', 'file.rename', 'directory.sync']) {
    for (const boundary of ['before', 'after'] as const) {
      for (const code of ['EIO', 'ENOSPC', 'INTERRUPTED'] as const) {
        it(`${code} ${boundary} ${operation} preserves a whole old or new file`, async () => {
          const root = await mkdtemp(path.join(tmpdir(), 'war02a-fs-'))
          try {
            const file = path.join(root, 'health.json')
            await writeFile(file, 'old')
            const plan = new FaultPlan({ operation, boundary, occurrence: 1, code })
            await expect(writeFileDurably(file, 'new', {
              fileSystem: createFaultFileSystem(root, plan),
              platform: 'linux', createTemporarySuffix: () => 'candidate',
            })).rejects.toMatchObject({ code })
            plan.assertTriggered()
            const published = operation === 'directory.sync' || (operation === 'file.rename' && boundary === 'after')
            expect(await readFile(file, 'utf8')).toBe(published ? 'new' : 'old')
            await expect(readFile(`${file}.candidate.tmp`)).rejects.toMatchObject({ code: 'ENOENT' })
          } finally { await rm(root, { recursive: true, force: true }) }
        })
      }
    }
  }
})
