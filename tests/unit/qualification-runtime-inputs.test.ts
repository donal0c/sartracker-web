import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { compileRuntimeInputs } from '../../scripts/qualification/runtime-inputs.mjs'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { hashLiveConfigDirectory } from '../../scripts/qualification/live-config-identity.mjs'

let root: string | undefined
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined })

/** Write synthetic data only; this fixture is never CI provenance. */
async function inputs() {
  root = await mkdtemp(path.join(os.tmpdir(), 'qualification-runtime-inputs-'))
  const files = await Promise.all(['archive.zip', 'candidate.AppImage', 'candidate.deb'].map(async (name) => {
    const filename = path.join(root!, name)
    await writeFile(filename, name)
    return hashCandidateFile(filename)
  }))
  const filename = path.join(root, 'inputs.json')
  await writeFile(filename, JSON.stringify({ schema: 'sartracker-candidate-runtime-inputs-v1',
    ci: { schema: 'sartracker-candidate-ci-artifacts-v1', version: '0.1.0-beta.13',
      provenance: { sourceSha: 'a'.repeat(40), runId: 1, runAttempt: 1, artifactId: 2 },
      archive: files[0], installers: [{ ...files[1], role: 'ci-appimage' }, { ...files[2], role: 'ci-deb' }] },
    installedExecutablePath: '/opt/SAR/sartracker-web', fixtures: {},
  }))
  return filename
}

describe('data-only exact-candidate runtime handoff', () => {
  it('binds an optional canonical existing fault-volume path without claiming it is a usable bounded mount', async () => {
    const filename = await inputs()
    const config = JSON.parse(await readFile(filename, 'utf8'))
    config.enospcMount = await realpath(root!)
    await writeFile(filename, JSON.stringify(config))
    const compiled = await compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.13')
    expect(compiled.config.enospcMount).toBe(config.enospcMount)
    for (const invalid of ['relative-path', filename, path.join(root!, 'absent')]) {
      await writeFile(filename, JSON.stringify({ ...config, enospcMount: invalid }))
      await expect(compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.13')).rejects.toThrow()
    }
  })
  it('binds the private live directory by digest without retaining credential values', async () => {
    const filename = await inputs()
    const directory = path.join(root!, 'private-live')
    await mkdir(directory)
    await writeFile(path.join(directory, 'settings.json'), '{"url":"synthetic"}')
    await writeFile(path.join(directory, 'credentials.json'), '{"secret":"NEVER-RETAIN-THIS"}')
    const { path: configPath, bytes, sha256 } = await hashLiveConfigDirectory(directory)
    const config = JSON.parse(await readFile(filename, 'utf8'))
    config.fixtures['live-config'] = { path: configPath, bytes, sha256 }
    await writeFile(filename, JSON.stringify(config))
    const compiled = await compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.13')
    expect(compiled.identities.some((entry) => entry.kind === 'live-config-directory')).toBe(true)
    expect(JSON.stringify(compiled)).not.toContain('NEVER-RETAIN-THIS')
    await writeFile(path.join(directory, 'extra.json'), '{}')
    await expect(compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.13')).rejects.toThrow()
  })
  it('binds every supplied byte without treating configuration as proven CI or installation', async () => {
    const result = await compileRuntimeInputs(await inputs(), { sha: 'a'.repeat(40) }, '0.1.0-beta.13')
    expect(result.liveVerificationRequired).toBe(true)
    expect(result.installationVerified).toBe(false)
    expect(result.identities.length).toBe(4)
  })
  it('rejects command substitution, wrong source/version and changed input bytes', async () => {
    const filename = await inputs()
    const config = JSON.parse(await readFile(filename, 'utf8'))
    await expect(compileRuntimeInputs(filename, { sha: 'b'.repeat(40) }, '0.1.0-beta.13')).rejects.toThrow()
    await expect(compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.14')).rejects.toThrow()
    await writeFile(filename, JSON.stringify({ ...config, command: ['arbitrary'] }))
    await expect(compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.13')).rejects.toThrow()
    await writeFile(filename, JSON.stringify(config))
    await writeFile(config.ci.installers[0].path, 'changed')
    await expect(compileRuntimeInputs(filename, { sha: 'a'.repeat(40) }, '0.1.0-beta.13')).rejects.toThrow()
  })
})
