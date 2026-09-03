// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createBrowserArchiveReviewHarness,
} from '../../src/features/browser-validation/browser-archive-review-harness'
import { getBrowserHarnessLayerCatalogStore } from '../../src/features/browser-validation/browser-harness-layer-catalog-store'
import {
  getBrowserHarnessStore,
  resetBrowserHarnessStore,
} from '../../src/features/browser-validation/browser-harness-store'

const PASSPHRASE = 'Harness archive passphrase 2026'
const OPERATION_ID = '728a915d-1ff9-48ee-9aaf-650f1b8ce6ab'
const SESSION_ID = 'f050f11c-83e5-491a-bdd8-f819894b743b'

describe('browser-validation archive review harness [DON-253 / BCP-16]', () => {
  beforeEach(() => {
    resetBrowserHarnessStore()
    window.sessionStorage.clear()
  })

  it('opens one verified synthetic archive behind its actual credential and a path-free session', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Archive Review Harness' })
    await store.finishMission(mission.id)
    const issuance = await store.issueMissionArchiveRecoveryCode(mission.id)
    const { archive } = await store.finalizeMission(mission.id, {
      operationId: issuance.operationId,
      passphrase: PASSPHRASE,
      recoveryCode: issuance.recoveryCode,
    })
    const harness = createBrowserArchiveReviewHarness({
      missionStore: store,
      layerCatalogStore: getBrowserHarnessLayerCatalogStore(),
      randomUUID: () => SESSION_ID,
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    })

    await expect(harness.archiveReview.open({
      operationId: OPERATION_ID,
      archiveId: archive.id,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: 'Wrong harness passphrase 2026!',
    })).rejects.toThrow(/failed safely|credential/iu)

    const opened = await harness.archiveReview.open({
      operationId: OPERATION_ID,
      archiveId: archive.id,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    })

    expect(opened).toEqual({
      operationId: OPERATION_ID,
      sessionId: SESSION_ID,
      archiveId: archive.id,
      missionId: mission.id,
      containerVersion: 2,
      encrypted: true,
      verified: true,
      immutable: true,
      ciphertextSha256: archive.ciphertext_sha256,
      previousArchiveId: null,
      openedAt: '2026-08-30T10:00:00.000Z',
      plaintextResidual: 'permission_restricted_session_open',
    })
    expect(JSON.stringify(opened)).not.toContain(archive.archive_path)
    expect(JSON.stringify(opened)).not.toContain(PASSPHRASE)

    await expect(harness.archiveReview.open({
      operationId: '754fc3fc-0032-403f-bdc4-fcc896722144',
      archiveId: archive.id,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    })).rejects.toThrow(/already open/iu)
  })

  it('reopens a persisted synthetic archive with either credential after a browser reload', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Reloaded Archive Review Harness' })
    await store.finishMission(mission.id)
    const issuance = await store.issueMissionArchiveRecoveryCode(mission.id)
    const { archive } = await store.finalizeMission(mission.id, {
      operationId: issuance.operationId,
      passphrase: PASSPHRASE,
      recoveryCode: issuance.recoveryCode,
    })
    const persisted = window.sessionStorage.getItem('sartracker:browser-harness') ?? ''
    expect(persisted).not.toContain(PASSPHRASE)
    expect(persisted).not.toContain(issuance.recoveryCode)

    resetBrowserHarnessStore(false)
    const reloadedStore = getBrowserHarnessStore()
    await expect(reloadedStore.validateMissionArchiveReviewCredential({
      archiveId: archive.id,
      slotType: 'recovery',
      secret: issuance.recoveryCode,
    })).resolves.toMatchObject({ id: archive.id })
    const harness = createBrowserArchiveReviewHarness({
      missionStore: reloadedStore,
      layerCatalogStore: getBrowserHarnessLayerCatalogStore(),
      randomUUID: () => SESSION_ID,
    })
    await expect(harness.archiveReview.open({
      operationId: OPERATION_ID,
      archiveId: archive.id,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    })).resolves.toMatchObject({ archiveId: archive.id, missionId: mission.id })
  })

  it('exposes only a fixed read facade and invalidates it after plaintext-session close', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Fixed Archive Source' })
    await store.finishMission(mission.id)
    const issuance = await store.issueMissionArchiveRecoveryCode(mission.id)
    const { archive } = await store.finalizeMission(mission.id, {
      operationId: issuance.operationId,
      passphrase: PASSPHRASE,
      recoveryCode: issuance.recoveryCode,
    })
    const harness = createBrowserArchiveReviewHarness({
      missionStore: store,
      layerCatalogStore: getBrowserHarnessLayerCatalogStore(),
      randomUUID: () => SESSION_ID,
      now: () => new Date('2026-08-30T10:00:00.000Z'),
    })
    const opened = await harness.archiveReview.open({
      operationId: OPERATION_ID,
      archiveId: archive.id,
      containerVersion: 2,
      slotType: 'recovery',
      secret: issuance.recoveryCode,
    })
    const source = harness.createSource(opened)

    await expect(source.listMissions()).resolves.toEqual([
      expect.objectContaining({ id: mission.id, status: 'finalized' }),
    ])
    await expect(source.info()).resolves.toEqual({
      schema_version: 13,
      database_path: 'Archive review session (path hidden)',
      backup_path: 'Archive review session (read-only)',
    })
    await expect(source.listMarkers('foreign-mission')).rejects.toThrow(/fixed/iu)
    expect('upsertMarker' in source).toBe(false)
    expect('upsertSearchPass' in source).toBe(false)
    expect('finalizeMission' in source).toBe(false)

    await expect(harness.archiveReview.close({ sessionId: SESSION_ID })).resolves.toBe(true)
    await expect(source.listMissions()).rejects.toThrow(/closed/iu)
    await expect(harness.archiveReview.close({ sessionId: SESSION_ID })).resolves.toBe(false)
  })

  it('reads the selected sealed revision rather than later mutable browser state', async () => {
    window.localStorage.setItem(
      'sartracker:browser-settings',
      JSON.stringify({ missionDefaults: { adminRoster: ['Duty Admin'] } }),
    )
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Revision-bound archive review' })
    await store.finishMission(mission.id)
    const firstIssuance = await store.issueMissionArchiveRecoveryCode(mission.id)
    const first = await store.finalizeMission(mission.id, {
      operationId: firstIssuance.operationId,
      passphrase: PASSPHRASE,
      recoveryCode: firstIssuance.recoveryCode,
    })
    await store.unlockFinalizedMission({
      mission_id: mission.id,
      admin_name: 'Duty Admin',
      reason: 'Create a second synthetic archive revision.',
    })
    const secondIssuance = await store.issueMissionArchiveRecoveryCode(mission.id)
    const second = await store.finalizeMission(mission.id, {
      operationId: secondIssuance.operationId,
      passphrase: PASSPHRASE,
      recoveryCode: secondIssuance.recoveryCode,
    })
    expect(second.archive.previous_archive_id).toBe(first.archive.id)

    const harness = createBrowserArchiveReviewHarness({
      missionStore: store,
      layerCatalogStore: getBrowserHarnessLayerCatalogStore(),
      randomUUID: () => SESSION_ID,
    })
    const opened = await harness.archiveReview.open({
      operationId: OPERATION_ID,
      archiveId: first.archive.id,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: PASSPHRASE,
    })
    const review = await harness.createSource(opened).readMissionReview({
      missionId: mission.id,
      includeTelemetry: true,
      auditLimit: 5_000,
    })
    expect(review.auditEvents.some((event) =>
      event.event_type === 'mission_archive_verified_v2'
      && JSON.parse(event.details_json ?? '{}').archive_id === second.archive.id,
    )).toBe(false)
    await harness.archiveReview.close({ sessionId: SESSION_ID })
  })
})
