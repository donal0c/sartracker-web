// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hashCandidateFile, inspectCiCandidateArchive } from '../../scripts/qualification/candidate-artifacts.mjs'

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const execFile = (...args: unknown[]) => {
    if (args[0] === 'gh') {
      const callback = args.at(-1) as (error: Error) => void
      callback(new Error('GitHub CLI authentication is deliberately unavailable in this test.'))
      return
    }
    return Reflect.apply(original.execFile, original, args)
  }
  Object.defineProperty(execFile, promisify.custom, { value: (...args: unknown[]) => new Promise((resolve, reject) => {
    execFile(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }))
  }) })
  return { ...original, execFile }
})

let root: string | undefined
afterEach(async () => { vi.unstubAllGlobals(); if (root) await rm(root, { recursive: true, force: true }); root = undefined })

/** Build a tiny real archive; remote metadata is synthetic and never claimed as CI evidence. */
async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), 'qualification-public-ci-'))
  const version = '0.1.0-beta.13.3'
  const names = [`sartracker-electron-validation_${version}_linux_x86_64.AppImage`, `sartracker-electron-validation_${version}_linux_amd64.deb`]
  for (const name of names) await writeFile(path.join(root, name), `synthetic ${name}`)
  const archivePath = path.join(root, 'archive.zip')
  execFileSync('zip', ['-q', archivePath, ...names], { cwd: root })
  const archive = await hashCandidateFile(archivePath)
  const sourceSha = 'a'.repeat(40)
  const run = { id: 123, run_attempt: 1, head_sha: sourceSha, head_branch: `electron-v${version}`, event: 'push',
    status: 'completed', conclusion: 'success', path: '.github/workflows/electron-release.yml',
    repository: { full_name: 'donal0c/sartracker-web' }, head_repository: { full_name: 'donal0c/sartracker-web' } }
  const artifact = { id: 456, name: 'electron-linux-artifacts', expired: false, digest: `sha256:${archive.sha256}`,
    workflow_run: { id: 123, head_sha: sourceSha }, size_in_bytes: archive.bytes }
  const fetcher = vi.fn().mockImplementation(async (url: string) => Response.json(url.endsWith('/runs/123') ? run : artifact))
  vi.stubGlobal('fetch', fetcher)
  return { run, artifact, fetcher, archivePath, outputDirectory: path.join(root, 'inspected'), version, sourceSha, runId: 123, runAttempt: 1, artifactId: 456 }
}

describe('public metadata and real archive verification integration', () => {
  it('extracts and hashes the exact two members without using authenticated gh', async () => {
    const input = await fixture()
    const result = await inspectCiCandidateArchive(input)
    expect(result.installers.map(entry => entry.role)).toEqual(['ci-appimage', 'ci-deb'])
    expect(result.ciMetadata.run).toEqual(input.run)
    expect(input.fetcher).toHaveBeenCalledTimes(2)
    for (const installer of result.installers) expect(await hashCandidateFile(installer.path)).toEqual({ path: installer.path, bytes: installer.bytes, sha256: installer.sha256 })
  })

  it.each(['source', 'attempt', 'failure', 'expired', 'digest', 'bytes'])('still rejects mismatched %s provenance', async (change) => {
    const input = await fixture()
    if (change === 'source') input.run.head_sha = 'c'.repeat(40)
    if (change === 'attempt') input.run.run_attempt = 2
    if (change === 'failure') input.run.conclusion = 'failure'
    if (change === 'expired') input.artifact.expired = true
    if (change === 'digest') input.artifact.digest = `sha256:${'b'.repeat(64)}`
    if (change === 'bytes') input.artifact.size_in_bytes += 1
    await expect(inspectCiCandidateArchive(input)).rejects.toThrow(/Candidate|Downloaded/)
    expect(input.fetcher).toHaveBeenCalledTimes(2)
  })
})
