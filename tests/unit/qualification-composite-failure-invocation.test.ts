import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPhaseFailureVariant } from '../../scripts/qualification/composite-probe.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('C28 intended failure operation invocation', () => {
  it.each([
    ['failure-settings-bootstrap', 'saveAppSettings'],
    ['failure-mission-outing', 'createOuting'],
    ['failure-marker-search', 'upsertMarker'],
    ['failure-coverage-replay', 'readMissionReplay'],
    ['failure-pause-restart', 'resumeMission'],
    ['failure-finish-finalize-archive', 'finalizeMission'],
    ['failure-archive-review-restore', 'open'],
    ['failure-sanitized-diagnostics', 'exportDiagnosticsReport'],
  ])('actually invokes the application bridge for %s', async (variant, method) => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-c28-invocation-'))
    const rejection = new Error('Synthetic domain rejection for invocation control')
    const target = vi.fn().mockRejectedValue(rejection)
    let status = 'active'
    const finish = vi.fn().mockImplementation(async () => { status = 'finished'; return { status } })
    const issuance = { operationId: '35877db9-8335-46ed-bc2b-de40c444c0f1', recoveryCode: Array(8).fill('01234').join('-') }
    const store = { getMission: async () => ({ id: 'mission', status }),
      countPositions: async () => 2, finishMission: finish,
      listOutings: async () => [{ id: 'outing', label: 'C28 routine outing', started_at: '2026-09-26T12:00:00.000Z', ended_at: null }],
      issueMissionArchiveRecoveryCode: async () => issuance, [method]: target }
    vi.stubGlobal('window', { sartrackerElectron: { missionStore: store,
      archiveReview: { open: target }, saveAppSettings: target, exportDiagnosticsReport: target } })
    const page = { evaluate: async (operation: (input: unknown) => unknown, input?: unknown) => operation(input) }
    try {
      const facts = await runPhaseFailureVariant(page, root, 'mission', variant, 'archive', 'C28-Test-Passphrase!9')
      expect(target).toHaveBeenCalledTimes(1)
      expect(facts.errorMessage).toBe(rejection.message)
      expect(facts.errorName).toBe('Error')
      if (method === 'upsertMarker') expect(target).toHaveBeenCalledWith(expect.objectContaining({
        lat: 91, irish_grid_e: 450000, irish_grid_n: 580000, display_order: 0,
      }))
      if (method === 'exportDiagnosticsReport') expect(target).toHaveBeenCalledWith({
        fileName: '', contents: 'C28 invalid filename',
      })
      if (method === 'resumeMission' || method === 'finalizeMission') {
        expect(finish).toHaveBeenCalledTimes(1)
        expect(JSON.parse(facts.beforeState).mission.status).toBe('finished')
        expect(facts.beforeState).toBe(facts.afterState)
      }
      if (method === 'resumeMission') expect(target).toHaveBeenCalledWith('mission')
      if (method === 'createOuting') expect(target).toHaveBeenCalledWith(expect.objectContaining({ started_at: '2026-09-26T12:00:00.000Z' }))
      if (method === 'finalizeMission') {
        const input = target.mock.calls[0][1]
        expect(input.operationId).toBe(issuance.operationId)
        expect(input.passphrase).toBe('C28-Test-Passphrase!9')
        expect(input.recoveryCode).toMatch(/^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u)
        expect(input.recoveryCode).not.toBe(issuance.recoveryCode)
      }
      if (method === 'open') expect(target).toHaveBeenCalledWith(expect.objectContaining({
        operationId: expect.stringMatching(/^[a-f0-9-]{36}$/u), secret: 'C28-Test-Passphrase!9-wrong',
      }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains a resolved malformed-file result and its independently read failure custody', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-c28-gpx-'))
    const sourcePath = path.join(root, 'malformed-c28.gpx')
    const reason = 'GPX file could not be parsed: malformed-c28.gpx'
    const issue = { id: 'failure:1', batch_id: 'batch', batch_status: 'completed_with_failures',
      file_name: 'malformed-c28.gpx', source_retained: true, rejection_count: 0, reason,
      content_sha256: createHash('sha256').update('<gpx><trk><trkseg><trkpt lat="not-a-coordinate" /></trkseg>').digest('hex') }
    const issues = vi.fn().mockResolvedValueOnce({ entries: [], nextCursor: null })
      .mockResolvedValueOnce({ entries: [issue], nextCursor: null })
    const importGpxEvidencePaths = vi.fn().mockResolvedValue({ imports: [], failures: [{ sourcePath, reason }] })
    vi.stubGlobal('window', { sartrackerElectron: { missionStore: {
      getMission: async () => ({ id: 'mission', status: 'active' }), countPositions: async () => 2,
      importGpxEvidencePaths, listGpxImportIssues: issues,
    } } })
    const page = { evaluate: async (operation: (input: unknown) => unknown, input?: unknown) => operation(input) }
    try {
      const facts = await runPhaseFailureVariant(page, root, 'mission', 'failure-gpx', null)
      expect(importGpxEvidencePaths).toHaveBeenCalledWith({ missionId: 'mission', paths: [sourcePath] })
      expect(facts.outcome).toBe('reported-file-failure')
      expect(facts).not.toHaveProperty('errorName')
      expect(facts.failureIssuesAfter.entries).toEqual([issue])
      expect(facts.beforeState).toBe(facts.afterState)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
