import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { runOwnedProcess, preparePackageRuntime } = vi.hoisted(() => ({
  runOwnedProcess: vi.fn(),
  preparePackageRuntime: vi.fn(),
}))

vi.mock('../../scripts/qualification/owned-process.mjs', () => ({ runOwnedProcess }))
vi.mock('../../scripts/qualification/package-runtime.mjs', () => ({
  preparePackageRuntime,
  observePackageProcesses: vi.fn(),
  validateRuntimeObservation: vi.fn(),
}))

import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { executePackageVariant } from '../../scripts/qualification/package-adapter.mjs'

const sourceSha = 'a'.repeat(40)
const sourceTree = 'b'.repeat(40)
const executableSha = 'c'.repeat(64)
const asarSha = 'd'.repeat(64)
const originalPlatform = process.platform
const originalArch = process.arch
let temporaryRoot: string | undefined

afterEach(async () => {
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  Object.defineProperty(process, 'arch', { value: originalArch })
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('packaged adapter custody projection', () => {
  it('retains a clean owned-process result through the actual package adapter', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-package-custody-'))
    const attemptDirectory = path.join(temporaryRoot, 'attempt')
    const workDirectory = path.join(temporaryRoot, 'work')
    await mkdir(attemptDirectory)
    await mkdir(workDirectory)

    const artifactPath = path.join(temporaryRoot, 'candidate.AppImage')
    await writeFile(artifactPath, 'synthetic candidate bytes')
    const artifact = { role: 'ci-appimage', ...(await hashCandidateFile(artifactPath)), localBuild: false }

    preparePackageRuntime.mockImplementation(async ({
      workDirectory: runtimeDirectory,
      artifact: preparedArtifact,
    }: { workDirectory: string; artifact: { sha256: string } }) => {
      await mkdir(runtimeDirectory, { recursive: true })
      return {
        proofMode: 'ci-appimage',
        launchPath: artifactPath,
        artifactSha256: preparedArtifact.sha256,
        executableSha256: executableSha,
        asarSha256: asarSha,
        environment: {},
        installedExecutablePath: null,
      }
    })
    runOwnedProcess.mockImplementation(async ({ args }: { args: string[] }) => {
      const evidenceDirectory = args.at(-1)
      if (typeof evidenceDirectory !== 'string') throw new Error('The fixed package command omitted its evidence directory.')
      const fixTime = '2026-01-01T00:00:00.000Z'
      const secondFixTime = '2026-01-01T00:20:00.000Z'
      const row = (id: number, deviceId: number, latitude: number, timestamp: string) => ({
        id,
        deviceId,
        latitude,
        longitude: -9.7,
        fixTime: timestamp,
        serverTime: new Date(Date.parse(timestamp) + 9 * 60_000).toISOString(),
        deviceTime: new Date(Date.parse(timestamp) + 7 * 60_000).toISOString(),
      })
      const source = {
        stationary: [row(101, 1, 52, fixTime), row(102, 1, 52.00001, secondFixTime)],
        stale: row(201, 2, 52.002, fixTime),
      }
      const durableRows = [
        { source_position_id: '101', device_id: '1', timestamp: fixTime, timestamp_source: 'fix', data_origin: 'live', source_kind: 'traccar', lat: 52, lon: -9.7 },
        { source_position_id: '102', device_id: '1', timestamp: secondFixTime, timestamp_source: 'fix', data_origin: 'live', source_kind: 'traccar', lat: 52.00001, lon: -9.7 },
        { source_position_id: '201', device_id: '2', timestamp: fixTime, timestamp_source: 'fix', data_origin: 'live', source_kind: 'traccar', lat: 52.002, lon: -9.7 },
      ]
      await writeFile(path.join(evidenceDirectory, 'attention-report.json'), JSON.stringify({
        schema: 'sartracker-attention-surface-v1',
        contractId: 'C06',
        qualificationExecuted: false,
        cleanup: { applicationClosed: true, serverClosed: true, profileRemoved: true },
        runtime: { executableSha256: executableSha, asarSha256: asarSha },
        facts: { source, sourcePollsBeforeAck: 1, sourcePollsAfterAck: 2, durableBeforeAck: durableRows, durableAfterAck: durableRows },
      }))
      return {
        supervisorPid: 123,
        zeroDescendantsAfterRun: true,
        observationResults: [[{
          pid: 456,
          startTicks: '789',
          launchPath: artifactPath,
          executablePath: '/owned/sartracker-web',
          executableSha256: executableSha,
          asarSha256: asarSha,
          artifactSha256: artifact.sha256,
          appImagePath: artifactPath,
          mainProcess: true,
          descendantOfRunner: true,
        }]],
        observationErrors: [],
        ownedPidsAfterExit: [],
        descendantsAfterExit: [],
        processError: null,
        stdout: '',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        outputOverflowed: false,
      }
    })

    const receipt = await executePackageVariant({
      normalized: {
        definitionDigest: 'e'.repeat(64),
        identities: {
          source: { sha: sourceSha, tree: sourceTree },
          candidate: { version: '0.1.0-beta.13', artifacts: [artifact] },
        },
        runtimeInputs: {
          config: {
            ci: {
              provenance: { sourceSha },
              installers: [artifact],
            },
          },
        },
      },
      binding: { contractId: 'C05', variantId: 'canonical-ingest-surface', proofMode: 'ci-appimage' },
      attemptDirectory,
      workDirectory,
    })

    expect(receipt.status).toBe('PASS')
    expect(receipt.validation.passed).toBe(true)
    expect(receipt.process.zeroDescendantsAfterRun).toBe(true)
    const observations = JSON.parse(await readFile(
      path.join(attemptDirectory, receipt.runtimeObservationsPath),
      'utf8',
    )) as { zeroDescendantsAfterRun?: boolean }
    expect(observations.zeroDescendantsAfterRun).toBe(true)
    expect(runOwnedProcess).toHaveBeenCalledOnce()
  })
})
