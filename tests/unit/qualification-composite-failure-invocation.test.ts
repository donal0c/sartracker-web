import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPhaseFailureVariant } from '../../scripts/qualification/composite-probe.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('C28 intended failure operation invocation', () => {
  it.each([
    ['failure-settings-bootstrap', 'saveAppSettings'],
    ['failure-mission-outing', 'createOuting'],
    ['failure-gpx', 'importGpxEvidencePaths'],
    ['failure-marker-search', 'upsertMarker'],
    ['failure-coverage-replay', 'readMissionReplay'],
    ['failure-pause-restart', 'pauseMission'],
    ['failure-finish-finalize-archive', 'finalizeMission'],
    ['failure-archive-review-restore', 'open'],
    ['failure-sanitized-diagnostics', 'exportDiagnosticsReport'],
  ])('actually invokes the application bridge for %s', async (variant, method) => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-c28-invocation-'))
    const rejection = new Error('Synthetic domain rejection for invocation control')
    const target = vi.fn().mockRejectedValue(rejection)
    if (method === 'pauseMission') target.mockResolvedValueOnce(undefined)
    const resume = vi.fn().mockResolvedValue(undefined)
    const store = { getMission: async () => ({ id: 'mission', status: 'active' }),
      countPositions: async () => 2, resumeMission: resume, [method]: target }
    vi.stubGlobal('window', { sartrackerElectron: { missionStore: store,
      archiveReview: { open: target }, saveAppSettings: target, exportDiagnosticsReport: target } })
    const page = { evaluate: async (operation: (input: unknown) => unknown, input?: unknown) => operation(input) }
    try {
      const facts = await runPhaseFailureVariant(page, root, 'mission', variant, 'archive')
      expect(target).toHaveBeenCalledTimes(method === 'pauseMission' ? 2 : 1)
      expect(facts.errorMessage).toBe(rejection.message)
      expect(facts.errorName).toBe('Error')
      if (method === 'upsertMarker') expect(target).toHaveBeenCalledWith(expect.objectContaining({
        lat: 91, irish_grid_e: 450000, irish_grid_n: 580000, display_order: 0,
      }))
      if (method === 'exportDiagnosticsReport') expect(target).toHaveBeenCalledWith({
        fileName: '', contents: 'C28 invalid filename',
      })
      if (method === 'pauseMission') expect(resume).toHaveBeenCalledWith('mission')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
