import { describe, expect, it } from 'vitest'

import {
  COVERAGE_BENCH_SCHEMA_VERSION,
  aggregateCoverageBenchRuns,
  buildCoverageBenchManifest,
  evaluateCoverageBenchRun,
  parseCoverageBenchCandidates,
  renderCoverageBenchVerdictTable,
  summarizeCoverageBenchSamples,
  validateCoverageBenchManifest,
} from '../../build/coverage-bench-lib.js'

const GIB = 1024 ** 3

describe('coverage benchmark matrix selection [DON-273]', () => {
  it('defaults to the full comparative matrix and permits an explicit affected-row subset', () => {
    expect(parseCoverageBenchCandidates(undefined)).toEqual(['A', 'B', 'C'])
    expect(parseCoverageBenchCandidates('B')).toEqual(['B'])
    expect(parseCoverageBenchCandidates('C,A')).toEqual(['C', 'A'])
  })

  it('rejects unknown, empty, and duplicate candidate selections', () => {
    expect(() => parseCoverageBenchCandidates('')).toThrow(/candidate/iu)
    expect(() => parseCoverageBenchCandidates('D')).toThrow(/candidate/iu)
    expect(() => parseCoverageBenchCandidates('B,B')).toThrow(/duplicate/iu)
  })
})

function passingManifest(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof buildCoverageBenchManifest> {
  return buildCoverageBenchManifest({
    appSha: '7021fc1ef33e6da5c91c96cd86e836fc3754f48f',
    candidate: 'A',
    fixture: {
      preset: 'bcp-960k',
      digest: 'a'.repeat(64),
      generatorVersion: 4,
      positionCount: 960_000,
    },
    machine: {
      hostname: 'reference-x11',
      platform: 'linux',
      arch: 'x64',
      kernel: '6.17.0',
      cpu: 'fixture cpu',
      gpu: 'fixture gpu',
      sessionType: 'wayland',
      windowSystem: 'x11',
    },
    run: {
      repetition: 2,
      thermalState: 'warm',
      startedAt: '2026-08-24T12:00:00.000Z',
      completedAt: '2026-08-24T12:00:20.000Z',
      flags: [
        '--ozone-platform=x11',
        '--no-sandbox',
        '--ignore-gpu-blocklist',
        '--use-gl=angle',
        '--use-angle=gl',
      ],
    },
    timings: {
      firstUsefulMs: 1_000,
      completeMs: 20_000,
      filterToggleMs: 250,
      filterDeviceMs: 200,
      filterGroupMs: 225,
      filterOutingMs: 250,
      appendRerenderMs: 700,
    },
    phases: {
      queryMs: 4_000,
      segmentationMs: 3_000,
      encodeServeMs: 0,
      sourceUpdateMs: 7_000,
      renderSettleMs: 6_000,
    },
    responsiveness: {
      mainGapMs: [8, 12, 40],
      rendererFrameMs: [16, 17, 25],
    },
    memory: {
      rendererRssPeakBytes: 1.2 * GIB,
      rendererRssSettledBytes: 1.1 * GIB,
    },
    correctness: {
      currentFixWithinPollCycle: true,
      killResumeHonest: true,
      renderedAttestationExact: true,
      exactDotsEqual: true,
      staleTileGuarded: true,
      unrelatedRevisionStable: true,
    },
    attestation: {
      seed: 'g2-serpentine-v1',
      panes: [{
        index: 0,
        zoom: 11,
        bounds: [-10, 51, -6, 55],
        expectedSegmentCount: 8,
        renderedSegmentCount: 8,
        expectedDigest: 'c'.repeat(64),
        renderedDigest: 'c'.repeat(64),
        exact: true,
      }],
    },
    ...overrides,
  })
}

describe('coverage benchmark manifest [DON-273]', () => {
  it('builds and validates a decision-grade manifest with all binding facts', () => {
    const manifest = passingManifest()

    expect(manifest.schemaVersion).toBe(COVERAGE_BENCH_SCHEMA_VERSION)
    expect(validateCoverageBenchManifest(manifest)).toEqual(manifest)
    expect(manifest.machine).toMatchObject({
      sessionType: 'wayland',
      windowSystem: 'x11',
    })
    expect(manifest.phases).toEqual({
      queryMs: 4_000,
      segmentationMs: 3_000,
      encodeServeMs: 0,
      sourceUpdateMs: 7_000,
      renderSettleMs: 6_000,
    })
    expect(manifest.attestation.panes[0].exact).toBe(true)
  })

  it('rejects incomplete, non-X11, and malformed fixture bindings', () => {
    const missingGpu = structuredClone(passingManifest())
    missingGpu.machine.gpu = ''
    expect(() => validateCoverageBenchManifest(missingGpu)).toThrow('machine.gpu')

    const wrongWindowSystem = structuredClone(passingManifest())
    wrongWindowSystem.machine.windowSystem = 'wayland'
    expect(() => validateCoverageBenchManifest(wrongWindowSystem)).toThrow('windowSystem')

    const badDigest = structuredClone(passingManifest())
    badDigest.fixture.digest = 'not-a-sha256'
    expect(() => validateCoverageBenchManifest(badDigest)).toThrow('fixture.digest')

    const falsePane = structuredClone(passingManifest())
    falsePane.attestation.panes[0].exact = false
    expect(() => validateCoverageBenchManifest(falsePane)).toThrow('attestation.panes[0]')
  })

  it('rejects evidence outside the reference Linux x64/X11 launch contract', () => {
    const mac = structuredClone(passingManifest())
    mac.machine.platform = 'darwin'
    mac.machine.arch = 'arm64'
    expect(() => validateCoverageBenchManifest(mac)).toThrow('linux')

    const missingOzoneFlag = structuredClone(passingManifest())
    missingOzoneFlag.run.flags = []
    expect(() => validateCoverageBenchManifest(missingOzoneFlag)).toThrow('--ozone-platform=x11')

    const missingSandboxFlag = structuredClone(passingManifest())
    missingSandboxFlag.run.flags = ['--ozone-platform=x11']
    expect(() => validateCoverageBenchManifest(missingSandboxFlag)).toThrow('--no-sandbox')

    const missingGraphicsFlags = structuredClone(passingManifest())
    missingGraphicsFlags.run.flags = ['--ozone-platform=x11', '--no-sandbox']
    expect(() => validateCoverageBenchManifest(missingGraphicsFlags)).toThrow('--ignore-gpu-blocklist')

    const warmFirstRun = structuredClone(passingManifest())
    warmFirstRun.run.repetition = 1
    warmFirstRun.run.thermalState = 'warm'
    expect(() => validateCoverageBenchManifest(warmFirstRun)).toThrow('repetition 1')
  })
})

describe('coverage benchmark statistics and budgets [DON-273]', () => {
  it('computes min, median, p95, and max without interpolating away a stall', () => {
    expect(summarizeCoverageBenchSamples([40, 10, 20, 30, 2_000])).toEqual({
      count: 5,
      min: 10,
      median: 30,
      p95: 2_000,
      max: 2_000,
    })
  })

  it('passes a healthy 960k run and reports renderer frame time as a target', () => {
    const verdict = evaluateCoverageBenchRun(passingManifest())

    expect(verdict.decision).toBe('pass')
    expect(verdict.gates).toMatchObject({
      firstUseful: { pass: true },
      complete960k: { pass: true },
      filterToggle: { pass: true },
      mainStall: { pass: true },
      memory: { pass: true },
      correctness: { pass: true },
    })
    expect(verdict.targets.rendererFrameP95.pass).toBe(true)
  })

  it('rejects the exact safety and scale budget breaches without averaging them away', () => {
    const manifest = passingManifest({
      timings: {
        firstUsefulMs: 5_001,
        completeMs: 30_001,
        filterToggleMs: 501,
        filterDeviceMs: 501,
        filterGroupMs: 480,
        filterOutingMs: 450,
        appendRerenderMs: 700,
      },
      responsiveness: {
        mainGapMs: [8, 201],
        rendererFrameMs: [16, 17],
      },
      memory: {
        rendererRssPeakBytes: 1.6 * GIB,
        rendererRssSettledBytes: 1.51 * GIB,
      },
    })
    const verdict = evaluateCoverageBenchRun(manifest)

    expect(verdict.decision).toBe('reject')
    expect(verdict.rejections.map((item) => item.id)).toEqual([
      'firstUseful',
      'complete960k',
      'filterToggle',
      'mainStall',
      'memory',
    ])
  })

  it('applies the 2M peak-memory headroom gate without inventing a complete-time budget', () => {
    const fixture2m = {
      preset: 'bcp-2m',
      digest: 'b'.repeat(64),
      generatorVersion: 4,
      positionCount: 2_000_000,
    }
    const manifest = passingManifest({
      fixture: fixture2m,
      timings: {
        firstUsefulMs: 4_000,
        completeMs: 80_000,
        filterToggleMs: 400,
        filterDeviceMs: 300,
        filterGroupMs: 350,
        filterOutingMs: 400,
        appendRerenderMs: 1_000,
      },
      memory: {
        rendererRssPeakBytes: 2.51 * GIB,
        rendererRssSettledBytes: 2.0 * GIB,
      },
    })
    const verdict = evaluateCoverageBenchRun(manifest)

    expect(verdict.gates.complete960k).toBeNull()
    expect(verdict.gates.memory?.pass).toBe(false)
    expect(verdict.decision).toBe('reject')
  })
})

describe('coverage benchmark aggregation and memo table [DON-273]', () => {
  it('judges a candidate on the worst warm run, retains cold results, and reports phase splits', () => {
    const cold = passingManifest({
      run: {
        repetition: 1,
        thermalState: 'cold',
        startedAt: '2026-08-24T11:00:00.000Z',
        completedAt: '2026-08-24T11:00:25.000Z',
        flags: ['--ozone-platform=x11', '--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'],
      },
    })
    const warmPass = passingManifest()
    const warmFail = passingManifest({
      run: {
        repetition: 3,
        thermalState: 'warm',
        startedAt: '2026-08-24T13:00:00.000Z',
        completedAt: '2026-08-24T13:00:25.000Z',
        flags: ['--ozone-platform=x11', '--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl'],
      },
      timings: {
        firstUsefulMs: 1_500,
        completeMs: 20_000,
        filterToggleMs: 600,
        filterDeviceMs: 600,
        filterGroupMs: 550,
        filterOutingMs: 500,
        appendRerenderMs: 700,
      },
    })

    const aggregate = aggregateCoverageBenchRuns([cold, warmPass, warmFail])

    expect(aggregate.groups).toHaveLength(1)
    expect(aggregate.groups[0]).toMatchObject({
      candidate: 'A',
      fixture: 'bcp-960k',
      decision: 'reject',
      coldRunCount: 1,
      warmRunCount: 2,
    })
    expect(aggregate.groups[0].phaseMs.query).toEqual({
      count: 3,
      min: 4_000,
      median: 4_000,
      p95: 4_000,
      max: 4_000,
    })

    const table = renderCoverageBenchVerdictTable(aggregate)
    expect(table).toContain('| A | bcp-960k | REJECT |')
    expect(table).toContain('query / segment / encode / source / settle')
    expect(table).toContain('4000 / 3000 / 0 / 7000 / 6000')
  })
})
