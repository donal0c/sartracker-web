import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildIndependentSoakSourceFacts,
  buildSoakExpectedBinding,
  compileSoakCommand,
  projectSoakReport,
  readBoundedSoakFile,
  SOAK_ADAPTER_DESCRIPTOR,
  SOAK_VARIANTS,
} from '../../scripts/qualification/soak-adapter.mjs'
import {
  SOAK_WORKER_PREPARATION_RETENTION_ALLOWANCE_MS,
  soakWorkerTimeoutMs,
} from '../../scripts/qualification/soak-execution-boundary.mjs'

const recordedNowMs = 1_750_000_000_000
const artifactSha = 'a'.repeat(64)
const executableSha = 'b'.repeat(64)
const asarSha = 'c'.repeat(64)

describe('qualification soak adapter', () => {
  it.each(['field-960k', 'field-2m', 'field-local-1gib'])('runs C24 %s competing operations on both package tiers', (variantId) => {
    for (const suffix of ['', '-installed']) {
      const command = compileSoakCommand({ contractId: 'C24', variantId: variantId + suffix,
        app: '/candidate', evidence: '/evidence', fieldFixture: '/fixture.sqlite' })
      expect(command.args).toContain('--operation-phases')
      expect(command.args).toContain('--priority-faults')
      expect(command.args).toContain('--field-fixture')
      expect(command.args).toContain('200')
    }
  })
  it('exposes the reviewed bounded and field-scale workload bindings', () => {
    expect(SOAK_VARIANTS.ci.contractIds).toEqual(['C04', 'C24'])
    expect(SOAK_VARIANTS['priority-100']).toMatchObject({
      contractIds: ['C04'], workloadClass: 'ci', minimumEquivalentProductionPolls: 1_080,
      minimumDeviceCount: 100,
    })
    expect(SOAK_VARIANTS.normal.contractIds).toEqual(['C25'])
    expect(SOAK_VARIANTS.extended.contractIds).toEqual(['C25'])
    expect(SOAK_VARIANTS['field-960k']).toMatchObject({
      contractIds: ['C24', 'C25'], workloadClass: 'field-scale', minimumDeviceCount: 100,
      minimumPositionRows: 960_000, expectedOutingCount: 12,
    })
    expect(SOAK_VARIANTS['field-2m']).toMatchObject({
      contractIds: ['C24', 'C25'], workloadClass: 'field-scale', minimumDeviceCount: 100,
      minimumPositionRows: 2_000_000, expectedOutingCount: 12,
    })
    expect(SOAK_VARIANTS['field-local-1gib']).toMatchObject({
      contractIds: ['C24', 'C25'], workloadClass: 'field-scale', minimumPositionRows: 960_000,
      expectedOutingCount: 12, fixturePreset: 'local', minimumFixtureBytes: 1_073_741_824,
    })
    expect(SOAK_VARIANTS['field-device-modes']).toMatchObject({
      contractIds: ['C25'], workloadClass: 'field-scale', minimumDeviceCount: 100,
      expectedOutingCount: 12, deviceModes: { moving: 80, stationary: 10, stale: 10 },
    })
    expect(SOAK_VARIANTS.ci.minimumEquivalentProductionPolls).toBe(1_080)
    expect(SOAK_VARIANTS.normal.minimumEquivalentProductionPolls).toBe(86_400)
    expect(SOAK_VARIANTS.normal.minimumArchiveCycles).toBe(2)
    expect(SOAK_VARIANTS.extended.minimumEquivalentProductionPolls).toBe(241_920)
    expect(SOAK_VARIANTS.extended.minimumArchiveCycles).toBe(2)
    expect(() => compileSoakCommand({
      contractId: 'C25', variantId: 'ci', app: '/candidate.AppImage', evidence: '/attempt/evidence',
    })).toThrow(/not reviewed/iu)
  })

  it('compiles fixed producer arguments with strict sub-200ms thresholds', () => {
    const command = compileSoakCommand({
      contractId: 'C24', variantId: 'ci', app: '/candidate.AppImage', evidence: '/attempt/evidence',
    })
    expect(command.profileName).toBe('ci')
    expect(command.report).toBe('electron-tracking-soak-report.json')
    expect(command.args).toContain('--freeze-threshold-ms')
    expect(command.args).toContain('200')
    expect(command.args).toContain('--main-stall-threshold-ms')
    expect(command.args).toContain('--priority-faults')
    expect(command.args).toContain('--operation-phases')
    expect(command.args).toContain('--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE')
    expect(command.args).not.toContain('--profile=normal')
  })

  it('binds field-scale commands to an explicit copied field fixture', () => {
    const command = compileSoakCommand({
      contractId: 'C25', variantId: 'field-960k', app: '/candidate.AppImage', evidence: '/attempt/evidence',
      fieldFixture: '/attempt/runtime/field-mission.sqlite',
    })
    expect(command.args).toContain('--field-fixture')
    expect(command.args).toContain('/attempt/runtime/field-mission.sqlite')
    expect(() => compileSoakCommand({
      contractId: 'C25', variantId: 'field-960k', app: '/candidate.AppImage', evidence: '/attempt/evidence',
    })).toThrow(/field fixture/iu)
  })

  it('recomputes source digests from the reviewed fixture clock and source helper', () => {
    const facts = buildIndependentSoakSourceFacts('ci', recordedNowMs)
    expect(facts.recordedNowMs).toBe(recordedNowMs)
    expect(facts.normalPrefixBatch).toBe(480)
    expect(facts.fullSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(facts.normalPrefixSha256).toMatch(/^[a-f0-9]{64}$/u)
    // CI has fewer than the 480-batch normal-prefix boundary, so both
    // independently computed digests intentionally cover the same rows.
    expect(facts.normalPrefixSha256).toBe(facts.fullSha256)
    expect(() => buildIndependentSoakSourceFacts('ci', 0)).toThrow(/recordedNowMs/iu)
  })

  it('projects only independently bound package/process facts into the existing receipt validator', () => {
    const binding = {
      contractId: 'C04',
      variantId: 'ci',
      proofMode: 'ci-appimage',
      source: { recordedNowMs },
      platform: { os: 'Linux 6.1.0', architecture: 'x64' },
      missionModel: { enabled: false, expectedParticipantRows: 32, expectedParticipantAddedEvents: 32 },
    }
    const runtime = {
      proofMode: 'ci-appimage',
      launchPath: '/runtime/candidate.AppImage',
      artifactSha256: artifactSha,
      executableSha256: executableSha,
      asarSha256: asarSha,
    }
    const report = { profile: { name: 'ci' }, verdict: { passed: true } }
    const projected = projectSoakReport(report, binding, runtime, 'ci')
    expect(projected.verdict).toEqual({ passed: true })
    expect(projected.package).toEqual({ tier: 'ci-appimage' })
    expect(projected.process).toEqual({
      tier: 'owned-packaged-electron-soak', executableSha256: executableSha,
    })
    expect(projected.thresholds).toEqual({ freezeThresholdMs: 200, mainStallThresholdMs: 200 })
    const expected = buildSoakExpectedBinding(projected, binding, runtime, 'ci')
    expect(expected.artifact).toEqual({
      basename: 'candidate.AppImage', sha256: artifactSha, packageTier: 'ci-appimage',
    })
    expect(expected.source.recordedNowMs).toBe(recordedNowMs)
  })

  it('reports the exact field-scale workload still missing from these producers', () => {
    expect(SOAK_ADAPTER_DESCRIPTOR.variants).toEqual([
      'ci', 'ci-installed', 'priority-100', 'priority-100-installed', 'normal', 'extended', 'field-960k', 'field-2m', 'field-local-1gib', 'field-device-modes',
      'normal-installed', 'extended-installed', 'field-960k-installed', 'field-2m-installed',
      'field-local-1gib-installed', 'field-device-modes-installed',
    ])
    expect(SOAK_ADAPTER_DESCRIPTOR.fieldVariants).toEqual([
      { id: 'field-960k', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 9_600, positionRows: 960_000 },
      { id: 'field-2m', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 20_000, positionRows: 2_000_000 },
      { id: 'field-local-1gib', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 9_600, positionRows: 960_000, fixturePreset: 'local', minimumFixtureBytes: 1_073_741_824 },
      { id: 'field-device-modes', deviceCount: 100, outingCount: 12, equivalentProductionPolls: 9_600, positionRows: 768_020, fixturePreset: 'field', moving: 80, stationary: 10, stale: 10 },
    ])
    expect(SOAK_ADAPTER_DESCRIPTOR.coverage.join('\n')).toMatch(/100-device.*12-outing/iu)
    expect(SOAK_ADAPTER_DESCRIPTOR.coverage.join('\n')).toMatch(/stationary.*stale/iu)
    expect(SOAK_ADAPTER_DESCRIPTOR.coverage.join('\n')).toMatch(/archive.*failure.*recovery/iu)
    expect(SOAK_ADAPTER_DESCRIPTOR.fixtureGenerators).toEqual({
      local: { command: 'scripts/seed-mission-store.mjs', preset: 'local' },
      field: { command: 'scripts/seed-mission-store.mjs', preset: 'field' },
    })
    expect(SOAK_ADAPTER_DESCRIPTOR.uncoveredAxes.join('\n')).toMatch(/local-1GiB.*3\.7GB/iu)
    expect(SOAK_ADAPTER_DESCRIPTOR.nextExtensionProposal).toEqual(expect.objectContaining({
      maximumResidentBytes: 2_147_483_648,
      databaseBytes: 3_700_000_000,
    }))
  })

  it('reads retained evidence through a bounded descriptor-backed read', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-bounded-read-'))
    const filename = path.join(directory, 'report.json')
    try {
      await writeFile(filename, '{"status":"observed"}')
      await expect(readBoundedSoakFile(filename, 21)).resolves.toEqual(Buffer.from('{"status":"observed"}'))
      await expect(readBoundedSoakFile(filename, 20)).rejects.toThrow(/limit|changed|size/iu)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses one fixed worker deadline with an explicit preparation and retention allowance', () => {
    expect(soakWorkerTimeoutMs(SOAK_VARIANTS.ci)).toBe(
      SOAK_VARIANTS.ci.timeoutMs + SOAK_WORKER_PREPARATION_RETENTION_ALLOWANCE_MS + 30_000,
    )
    expect(soakWorkerTimeoutMs(SOAK_VARIANTS['field-960k'])).toBe(
      SOAK_VARIANTS['field-960k'].timeoutMs + SOAK_WORKER_PREPARATION_RETENTION_ALLOWANCE_MS + 30_000,
    )
  })
})
