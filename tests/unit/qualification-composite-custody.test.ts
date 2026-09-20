import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { retainCompositeReferences, rebindCompositeReferences } from '../../scripts/qualification/composite-custody.mjs'

let root: string
afterEach(async () => { if (root) await rm(root, {recursive:true,force:true}) })

it('retains composite bytes beyond runtime deletion without rewriting observed profile identity', async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'composite-custody-')))
  const work = path.join(root,'work'), attempt = path.join(root,'attempt')
  await mkdir(work); await mkdir(attempt)
  const asar = Buffer.from('fixed packaged bytes'), output = Buffer.from('synthetic negative output'), manifest = Buffer.from('fixed manifest')
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  await writeFile(path.join(work,'retained.asar'),asar)
  await writeFile(path.join(work,'output.txt'),output)
  await writeFile(path.join(work,'manifest.txt'),manifest)
  const report = { app:{retainedPackagedAppPath:path.join(work,'retained.asar'),retainedPackagedAppSha256:digest(asar)},
    profile:{path:path.join(work,'.profile-composite')}, phases:{sanitizedDiagnostics:{
      retainedOutputPath:path.join(work,'output.txt'),outputSha256:digest(output),outputByteLength:output.length,
      retainedCanaryManifestPath:path.join(work,'manifest.txt'),canaryManifestSha256:digest(manifest),
    }} }
  const original = JSON.stringify(report)
  const references = await retainCompositeReferences({report,evidenceDirectory:work,attemptDirectory:attempt})
  await rm(work,{recursive:true})
  const rebound = await rebindCompositeReferences({report,references,attemptDirectory:attempt})
  expect(rebound.profile.path).toBe(report.profile.path)
  expect(JSON.stringify(report)).toBe(original)
  expect(await readFile(rebound.app.retainedPackagedAppPath)).toEqual(asar)
  expect(await readFile(rebound.phases.sanitizedDiagnostics.retainedOutputPath)).toEqual(output)
  await writeFile(rebound.app.retainedPackagedAppPath,'tampered')
  await expect(rebindCompositeReferences({report,references,attemptDirectory:attempt})).rejects.toThrow(/identity/u)
})
