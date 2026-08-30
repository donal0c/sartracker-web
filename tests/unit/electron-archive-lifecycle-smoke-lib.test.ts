import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  archiveLifecycleSmokeBatchInsertedEveryRow,
  assertArchiveLifecycleSmokeEvidenceOmitsSecrets,
  buildArchiveLifecycleSmokeCiEnvironment,
  buildArchiveLifecycleSmokeCiRunnerArgs,
  parseArchiveLifecycleSmokeArgs,
  projectArchiveLifecycleSmokeClosedReviewSemantic,
  renderedVersionContainsExactHead,
  resolvePackagedApplicationArchivePath,
  validateArchiveLifecycleSmokeEvidence,
} from '../../build/electron-archive-lifecycle-smoke-lib.js'

const HEAD = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const SHA256 = 'c'.repeat(64)
const REPLAY_SELECTED_TIME = '2026-08-29T08:10:00.000Z'
const REPLAY_EXPECTED = Object.freeze({
  missionId: 'mission-1',
  selectedTime: REPLAY_SELECTED_TIME,
  expectedBreadcrumbCount: 5,
  expectedObjectCount: 2,
  expectedOutingFilterCount: 2,
})

/** Returns one deterministic exact Replay track row. */
function replayTrack(index: number): Readonly<Record<string, unknown>> {
  const effectiveAt = new Date(Date.parse('2026-08-29T08:00:00.000Z') + index * 2).toISOString()
  const recordedAt = new Date(Date.parse(effectiveAt) + 1).toISOString()
  return {
    evidence_id: `position-${index}`,
    source_type: 'traccar_fix',
    track_id: 'device-1',
    effective_at: effectiveAt,
    recorded_at: recordedAt,
    lat: 52 + index / 1_000,
    lon: -9 - index / 1_000,
  }
}

/** Returns one deterministic reconstructed mission object. */
function replayObject(type: string, id: string): Readonly<Record<string, unknown>> {
  return {
    object_type: type,
    object_id: id,
    version_sequence: 2,
    operation: 'upsert',
    state: { id, revision: 2 },
  }
}

/** Returns one complete closed Review payload with stable mission semantics. */
function closedReviewContent(workerThreadId = 5): Readonly<Record<string, unknown>> {
  const query = {
    missionId: REPLAY_EXPECTED.missionId,
    selectedTime: REPLAY_EXPECTED.selectedTime,
    timezone: 'Europe/Dublin',
    trackLimit: 2,
    objectLimit: 1,
  }
  return {
    missions: [{ id: 'mission-1', revision: 3, storage_state: 'live' }],
    review: {
      workerThreadId,
      auditEvents: [
        { rowid: 1, revision: 1, type: 'mission_created' },
        { rowid: 2, revision: 2, type: 'position_added' },
      ],
      breadcrumbCount: 2,
    },
    replay: {
      query,
      initial: {
        missionId: query.missionId,
        selectedTime: query.selectedTime,
        timezone: query.timezone,
        replayGeneration: 4,
        tracks: [replayTrack(1), replayTrack(2)],
        totalTrackCount: 5,
        trackCursor: '0',
        previousCursor: null,
        nextCursor: 'track-after-2',
        objects: [replayObject('clue', 'object-1')],
        totalObjectCount: 2,
        objectCursor: '0',
        nextObjectCursor: 'object-after-1',
        availableOutingIds: ['outing-a'],
        availableOutingTotalCount: 2,
        availableOutingNextCursor: 'outing-after-a',
        replayStableState: { revision: 8 },
      },
      trackPages: [
        {
          request: { ...query, cursor: 'track-after-2' },
          result: {
            missionId: query.missionId,
            selectedTime: query.selectedTime,
            tracks: [replayTrack(3), replayTrack(4)],
            trackCursor: '2',
            previousCursor: 'track-before-2',
            totalTrackCount: 5,
            nextCursor: 'track-after-4',
            progress: 0.8,
          },
        },
        {
          request: { ...query, cursor: 'track-after-4' },
          result: {
            missionId: query.missionId,
            selectedTime: query.selectedTime,
            tracks: [replayTrack(5)],
            trackCursor: '4',
            previousCursor: 'track-before-4',
            totalTrackCount: 5,
            nextCursor: null,
            progress: 1,
          },
        },
      ],
      objectPages: [
        {
          request: {
            ...query,
            objectCursor: 'object-after-1',
            replayGeneration: 4,
          },
          result: {
            missionId: query.missionId,
            selectedTime: query.selectedTime,
            replayGeneration: 4,
            objects: [replayObject('hazard', 'object-2')],
            totalObjectCount: 2,
            objectCursor: '1',
            nextObjectCursor: null,
            progress: 1,
            summarizedObjectCount: 0,
          },
        },
      ],
      outingFilterPages: [
        {
          request: {
            ...query,
            filterKind: 'outing',
            filterCursor: 'outing-after-a',
            filterLimit: 100,
            filterSearch: '',
          },
          result: {
            filterKind: 'outing',
            search: '',
            entries: ['outing-b'],
            totalCount: 2,
            nextCursor: null,
          },
        },
      ],
    },
  }
}

/** Expands the closed fixture into a real four-page, 4,096-row track inventory. */
function closedReviewContentWithTrackCount(
  trackCount: number,
  pageSize: number,
): Readonly<Record<string, unknown>> {
  const content = structuredClone(closedReviewContent()) as Record<string, unknown>
  const review = content.review as Record<string, unknown>
  const replay = content.replay as Record<string, unknown>
  const query = replay.query as Record<string, unknown>
  const initial = replay.initial as Record<string, unknown>
  query.trackLimit = pageSize
  review.breadcrumbCount = trackCount
  const rows = Array.from({ length: trackCount }, (_unused, index) => replayTrack(index + 1))
  initial.tracks = rows.slice(0, pageSize)
  initial.totalTrackCount = trackCount
  initial.nextCursor = trackCount > pageSize ? `track-after-${pageSize}` : null
  for (const lane of ['objectPages', 'outingFilterPages']) {
    const replayPages = replay[lane] as Array<Record<string, unknown>>
    for (const page of replayPages) {
      const request = page.request as Record<string, unknown>
      request.trackLimit = pageSize
    }
  }
  const pages: Array<Record<string, unknown>> = []
  for (let offset = pageSize; offset < trackCount; offset += pageSize) {
    const nextOffset = Math.min(trackCount, offset + pageSize)
    pages.push({
      request: { ...query, cursor: `track-after-${offset}` },
      result: {
        missionId: query.missionId,
        selectedTime: query.selectedTime,
        tracks: rows.slice(offset, nextOffset),
        trackCursor: String(offset),
        previousCursor: `track-before-${offset}`,
        totalTrackCount: trackCount,
        nextCursor: nextOffset < trackCount ? `track-after-${nextOffset}` : null,
        progress: nextOffset / trackCount,
      },
    })
  }
  replay.trackPages = pages
  return content
}

/** Returns one complete exact-head packaged archive-lifecycle proof. */
function completeEvidence(): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    proofKind: 'packaged-electron-archive-lifecycle-v1',
    source: {
      expectedHead: HEAD,
      headBefore: HEAD,
      headAfter: HEAD,
      treeBefore: TREE,
      treeAfter: TREE,
      worktreeCleanBefore: true,
      worktreeCleanAfter: true,
      packagedExecutableSha256: SHA256,
      packagedApplicationArchiveSha256: SHA256,
      packagedBuildHeadMatched: true,
    },
    run: {
      startedAt: '2026-08-30T08:00:00.000Z',
      finishedAt: '2026-08-30T08:02:00.000Z',
      durationMs: 120_000,
      platform: 'linux',
      architecture: 'x64',
      nodeVersion: 'v22.18.0',
      launchCount: 2,
      observedLaunchExitCount: 2,
    },
    mission: {
      missionId: 'mission-packaged-proof',
      missionNameSha256: SHA256,
      createdStatus: 'active',
      finishedStatus: 'finished',
      finalizedStatus: 'finalized',
      seededPositionRows: 4_096,
      seededReplayObjectRows: 202,
      seededOutingChoices: 101,
    },
    archive: {
      archiveId: 'archive-packaged-proof',
      containerVersion: 2,
      statusAfterFinalize: 'verified',
      statusAfterIndependentVerify: 'verified',
      availability: 'present',
      ciphertextSha256: SHA256,
      sizeBytes: 9_001,
      createProgressPhases: ['encrypt', 'publish', 'seal', 'snapshot', 'staged'],
      verifyProgressPhases: [
        'decrypt',
        'inventory',
        'plaintext_cleanup',
        'replay',
        'verified',
      ],
    },
    reviewBeforeCleanup: {
      opened: true,
      immutable: true,
      verified: true,
      plaintextResidual: 'permission_restricted_session_open',
      contentSha256: SHA256,
      archiveIdMatched: true,
      readMissionIdMatched: true,
      breadcrumbCount: 4_096,
      replayObjectCount: 202,
      replayOutingFilterCount: 101,
      replayTrackCount: 4_096,
      openResidualFileCount: 1,
      openDirectoriesOwnerOnly: true,
      openFilesOwnerOnly: true,
      openPrivacyCanaryDetected: true,
      mutationAttempt: 'upsertMarker',
      mutationBoundary: 'preload_read_only',
      mutationDenied: true,
      denialAudited: true,
      closed: true,
      residualEntriesAfterClose: 0,
    },
    interruptedRestore: {
      supported: true,
      progressTriggered: true,
      triggerPhase: 'decrypt',
      killSignalRequested: 'SIGKILL',
      exitSignal: 'SIGKILL',
      residualEntriesBeforeRestart: 2,
      plaintextFileObservedBeforeRestart: true,
      privacyCanaryDetectedBeforeRestart: true,
      restartSweepCompleted: true,
      residualEntriesAfterRestart: 0,
    },
    cleanup: {
      eligibilityChecked: true,
      eligibleBeforeCredential: false,
      freshCredentialOnlyBlocker: true,
      completed: true,
      storageState: 'archived',
      movedRows: 4_100,
      remainingBreadcrumbRows: 0,
    },
    reviewAfterCleanup: {
      opened: true,
      immutable: true,
      verified: true,
      plaintextResidual: 'permission_restricted_session_open',
      contentSha256: SHA256,
      archiveIdMatched: true,
      readMissionIdMatched: true,
      breadcrumbCount: 4_096,
      replayObjectCount: 202,
      replayOutingFilterCount: 101,
      replayTrackCount: 4_096,
      openResidualFileCount: 1,
      openDirectoriesOwnerOnly: true,
      openFilesOwnerOnly: true,
      openPrivacyCanaryDetected: true,
      mutationAttempt: 'upsertMarker',
      mutationBoundary: 'preload_read_only',
      mutationDenied: true,
      denialAudited: true,
      closed: true,
      residualEntriesAfterClose: 0,
    },
    privacy: {
      secretsProvidedOnlyViaPreload: true,
      secretsAbsentFromProcessArguments: true,
      secretsAbsentFromEvidence: true,
      exactSecretScanFiles: 8,
      exactSecretMatches: 0,
      plaintextResidueEntriesAtEnd: 0,
    },
    verdict: { passed: true, failureReasons: [] },
  }
}

describe('packaged Electron archive-lifecycle smoke helpers [DON-248/DON-252/DON-253]', () => {
  it('excludes exactly the proven worker-session path from closed Review semantics', () => {
    const beforeContent = closedReviewContent(5)
    const before = projectArchiveLifecycleSmokeClosedReviewSemantic(
      beforeContent,
      REPLAY_EXPECTED,
    )
    const after = projectArchiveLifecycleSmokeClosedReviewSemantic(
      closedReviewContent(7),
      REPLAY_EXPECTED,
    )

    expect(before.excludedPaths).toEqual(['review.workerThreadId'])
    expect(before.semantic.review).not.toHaveProperty('workerThreadId')
    expect(before.semantic.replay).toBe(beforeContent.replay)
    expect(before.replayCounts).toEqual({
      objectPages: 1,
      objectRows: 2,
      outingFilterEntries: 2,
      outingFilterPages: 1,
      trackPages: 2,
      trackRows: 5,
    })
    expect(JSON.stringify(before)).toBe(JSON.stringify(after))
    expect(() => projectArchiveLifecycleSmokeClosedReviewSemantic({
      ...closedReviewContent(),
      unexpected: true,
    }, REPLAY_EXPECTED)).toThrow(/closed Review content/iu)
    const missingWorker = structuredClone(closedReviewContent()) as Record<string, unknown>
    delete (missingWorker.review as Record<string, unknown>).workerThreadId
    expect(() => projectArchiveLifecycleSmokeClosedReviewSemantic(missingWorker, REPLAY_EXPECTED))
      .toThrow(/worker.*metadata/iu)
    const extraWorker = structuredClone(closedReviewContent()) as Record<string, unknown>
    const extraReview = extraWorker.review as Record<string, unknown>
    extraReview.workerProcessId = 8
    expect(() => projectArchiveLifecycleSmokeClosedReviewSemantic(extraWorker, REPLAY_EXPECTED))
      .toThrow(/closed Review|worker.*metadata/iu)
  })

  it.each([
    ['mission revision', (content: Record<string, unknown>) => {
      const missions = content.missions as Array<Record<string, unknown>>
      missions[0] = { ...missions[0], revision: 4 }
    }],
    ['audit content', (content: Record<string, unknown>) => {
      const review = content.review as Record<string, unknown>
      const auditEvents = review.auditEvents as Array<Record<string, unknown>>
      auditEvents[0] = { ...auditEvents[0], type: 'mission_changed' }
    }],
    ['breadcrumb count', (content: Record<string, unknown>) => {
      const review = content.review as Record<string, unknown>
      review.breadcrumbCount = 1
    }],
    ['later track-page content', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[1].result as Record<string, unknown>
      const tracks = result.tracks as Array<Record<string, unknown>>
      tracks[0] = { ...tracks[0], lat: 53.25 }
    }],
    ['later object-page content', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.objectPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      const objects = result.objects as Array<Record<string, unknown>>
      objects[0] = { ...objects[0], state: { id: 'object-2', revision: 3 } }
    }],
    ['later outing-filter-page content', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.outingFilterPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.entries = ['outing-c']
    }],
  ])('keeps %s inside the closed Review semantic comparison', (_label, mutate) => {
    const baseline = structuredClone(closedReviewContent()) as Record<string, unknown>
    const changed = structuredClone(closedReviewContent()) as Record<string, unknown>
    mutate(changed)
    expect(JSON.stringify(projectArchiveLifecycleSmokeClosedReviewSemantic(
      changed,
      REPLAY_EXPECTED,
    ))).not.toBe(JSON.stringify(projectArchiveLifecycleSmokeClosedReviewSemantic(
      baseline,
      REPLAY_EXPECTED,
    )))
  })

  it.each([
    ['partial track paging', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      replay.trackPages = (replay.trackPages as unknown[]).slice(0, 1)
    }, /partial|exhaust|terminal/iu],
    ['partial object paging', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      replay.objectPages = []
    }, /partial|exhaust|terminal/iu],
    ['partial outing-filter paging', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      replay.outingFilterPages = []
    }, /partial|exhaust|terminal/iu],
    ['cyclic track cursor', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.nextCursor = 'track-after-2'
    }, /cursor.*cycle/iu],
    ['cyclic object cursor', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.objectPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.nextObjectCursor = 'object-after-1'
    }, /cursor.*cycle/iu],
    ['cyclic outing-filter cursor', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.outingFilterPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.nextCursor = 'outing-after-a'
    }, /cursor.*cycle/iu],
    ['empty nonterminal track page', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.tracks = []
    }, /empty|nonterminal/iu],
    ['empty initial nonterminal track page', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const initial = replay.initial as Record<string, unknown>
      const initialTracks = initial.tracks as Array<Record<string, unknown>>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      pages.unshift({
        request: {
          ...(replay.query as Record<string, unknown>),
          cursor: 'track-from-empty-initial',
        },
        result: {
          missionId: REPLAY_EXPECTED.missionId,
          selectedTime: REPLAY_EXPECTED.selectedTime,
          tracks: initialTracks,
          trackCursor: '0',
          previousCursor: 'track-before-first',
          totalTrackCount: 5,
          nextCursor: 'track-after-2',
          progress: 0.4,
        },
      })
      initial.tracks = []
      initial.nextCursor = 'track-from-empty-initial'
    }, /initial.*empty|empty.*initial|initial.*nonterminal/iu],
    ['empty initial nonterminal object page', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const initial = replay.initial as Record<string, unknown>
      const initialObjects = initial.objects as Array<Record<string, unknown>>
      const pages = replay.objectPages as Array<Record<string, unknown>>
      pages.unshift({
        request: {
          ...(replay.query as Record<string, unknown>),
          objectCursor: 'object-from-empty-initial',
          replayGeneration: 4,
        },
        result: {
          missionId: REPLAY_EXPECTED.missionId,
          selectedTime: REPLAY_EXPECTED.selectedTime,
          replayGeneration: 4,
          objects: initialObjects,
          totalObjectCount: 2,
          objectCursor: '0',
          nextObjectCursor: 'object-after-1',
          progress: 0.5,
          summarizedObjectCount: 0,
        },
      })
      initial.objects = []
      initial.nextObjectCursor = 'object-from-empty-initial'
    }, /initial.*empty|empty.*initial|initial.*nonterminal/iu],
    ['empty initial nonterminal outing-filter page', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const initial = replay.initial as Record<string, unknown>
      const initialEntries = initial.availableOutingIds as string[]
      const pages = replay.outingFilterPages as Array<Record<string, unknown>>
      pages.unshift({
        request: {
          ...(replay.query as Record<string, unknown>),
          filterKind: 'outing',
          filterCursor: 'outing-from-empty-initial',
          filterLimit: 100,
          filterSearch: '',
        },
        result: {
          filterKind: 'outing',
          search: '',
          entries: initialEntries,
          totalCount: 2,
          nextCursor: 'outing-after-a',
        },
      })
      initial.availableOutingIds = []
      initial.availableOutingNextCursor = 'outing-from-empty-initial'
    }, /initial.*empty|empty.*initial|initial.*nonterminal/iu],
    ['reordered track pages', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      replay.trackPages = [...(replay.trackPages as unknown[])].reverse()
    }, /cursor|order|request/iu],
    ['missing continuation previous-track cursor', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.previousCursor = null
    }, /previous.*cursor/iu],
    ['reordered later track rows', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.tracks = [...(result.tracks as unknown[])].reverse()
    }, /order/iu],
    ['track mission mismatch', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.missionId = 'wrong-mission'
    }, /mission/iu],
    ['track selected-time mismatch', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.selectedTime = '2026-08-29T08:11:00.000Z'
    }, /selected.*time/iu],
    ['track total mismatch', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.totalTrackCount = 6
    }, /total/iu],
    ['object replay-generation mismatch', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.objectPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.replayGeneration = 5
    }, /generation/iu],
    ['object request replay-generation mismatch', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.objectPages as Array<Record<string, unknown>>
      const request = pages[0].request as Record<string, unknown>
      request.replayGeneration = 5
    }, /generation/iu],
    ['filter search mismatch', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.outingFilterPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.search = 'changed'
    }, /search|filter/iu],
    ['duplicate track identity', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const initial = replay.initial as Record<string, unknown>
      const initialTracks = initial.tracks as Array<Record<string, unknown>>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      const tracks = result.tracks as Array<Record<string, unknown>>
      tracks[0] = { ...tracks[0], evidence_id: initialTracks[0].evidence_id }
    }, /duplicate.*track/iu],
    ['duplicate object identity', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.objectPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.objects = [replayObject('clue', 'object-1')]
    }, /duplicate.*object/iu],
    ['duplicate outing identity', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.outingFilterPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.entries = ['outing-a']
    }, /duplicate.*outing/iu],
    ['extra terminal track page', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      pages.push(structuredClone(pages[1]))
    }, /extra|terminal/iu],
    ['oversized terminal track page', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const result = pages[0].result as Record<string, unknown>
      result.tracks = [replayTrack(3), replayTrack(4), replayTrack(5)]
      result.nextCursor = null
      replay.trackPages = [pages[0]]
    }, /bound|limit|page/iu],
    ['empty extra track page after the declared total', (content: Record<string, unknown>) => {
      const replay = content.replay as Record<string, unknown>
      const pages = replay.trackPages as Array<Record<string, unknown>>
      const finalResult = pages[1].result as Record<string, unknown>
      finalResult.nextCursor = 'track-after-5'
      pages.push({
        request: {
          ...(replay.query as Record<string, unknown>),
          cursor: 'track-after-5',
        },
        result: {
          missionId: REPLAY_EXPECTED.missionId,
          selectedTime: REPLAY_EXPECTED.selectedTime,
          tracks: [],
          trackCursor: '5',
          previousCursor: 'track-before-5',
          totalTrackCount: 5,
          nextCursor: null,
          progress: 1,
        },
      })
    }, /extra|total|terminal/iu],
  ])('rejects malformed exhaustive Replay evidence: %s', (_label, mutate, expected) => {
    const content = structuredClone(closedReviewContent()) as Record<string, unknown>
    mutate(content)
    expect(() => projectArchiveLifecycleSmokeClosedReviewSemantic(content, REPLAY_EXPECTED))
      .toThrow(expected)
  })

  it('compares all 4,096 seeded track rows, including the final continuation page', () => {
    const expected = {
      ...REPLAY_EXPECTED,
      expectedBreadcrumbCount: 4_096,
    }
    const baseline = closedReviewContentWithTrackCount(4_096, 1_000)
    const changed = structuredClone(baseline) as Record<string, unknown>
    const replay = changed.replay as Record<string, unknown>
    const pages = replay.trackPages as Array<Record<string, unknown>>
    const finalResult = pages.at(-1)?.result as Record<string, unknown>
    const finalRows = finalResult.tracks as Array<Record<string, unknown>>
    finalRows[finalRows.length - 1] = {
      ...finalRows[finalRows.length - 1],
      lat: 53.4096,
    }

    const baselineProjection = projectArchiveLifecycleSmokeClosedReviewSemantic(
      baseline,
      expected,
    )
    const changedProjection = projectArchiveLifecycleSmokeClosedReviewSemantic(
      changed,
      expected,
    )
    expect(baselineProjection.replayCounts.trackRows).toBe(4_096)
    expect(baselineProjection.replayCounts.trackPages).toBe(4)
    expect(JSON.stringify(changedProjection)).not.toBe(JSON.stringify(baselineProjection))
  })

  it('accepts only a public addPositionsBulk array with the exact requested batch length', () => {
    const exactBatch = Array.from({ length: 512 }, (_unused, index) => ({ id: `${index}` }))
    expect(archiveLifecycleSmokeBatchInsertedEveryRow(exactBatch, 512)).toBe(true)
    expect(archiveLifecycleSmokeBatchInsertedEveryRow({ insertedPositionCount: 512 }, 512))
      .toBe(false)
    expect(archiveLifecycleSmokeBatchInsertedEveryRow(exactBatch.slice(0, 511), 512)).toBe(false)
    expect(archiveLifecycleSmokeBatchInsertedEveryRow([...exactBatch, { id: 'extra' }], 512))
      .toBe(false)
  })

  it('matches a CSS-uppercased full build head without accepting prefixes or longer hex tokens', () => {
    const exactHead = '60bda977c7f69c9b78310c2e8af4a9b3ca5f7d95'
    expect(renderedVersionContainsExactHead(
      `0.1.0-BETA.12.11+SHA.${exactHead.toUpperCase()}`,
      exactHead,
    )).toBe(true)
    expect(renderedVersionContainsExactHead(
      `0.1.0-BETA.12.11+SHA.${exactHead.slice(0, 12).toUpperCase()}`,
      exactHead,
    )).toBe(false)
    expect(renderedVersionContainsExactHead(
      `0.1.0-BETA.12.11+SHA.${exactHead.toUpperCase()}A`,
      exactHead,
    )).toBe(false)
  })

  it('parses an absolute, exact-head runner command without accepting custody material', () => {
    expect(parseArchiveLifecycleSmokeArgs([
      '--app',
      '/tmp/sartracker-web',
      '--evidence',
      '/tmp/archive-smoke',
      '--expected-head',
      HEAD,
      '--seed-position-rows',
      '2048',
      '--timeout-ms',
      '240000',
      '--',
      '--no-sandbox',
    ])).toEqual({
      appPath: '/tmp/sartracker-web',
      evidenceDir: '/tmp/archive-smoke',
      expectedHead: HEAD,
      seedPositionRows: 2_048,
      timeoutMs: 240_000,
      extraArgs: ['--no-sandbox'],
    })

    expect(() => parseArchiveLifecycleSmokeArgs([])).toThrow(/--app/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', 'relative-app', '--evidence', '/tmp/e', '--expected-head', HEAD,
    ])).toThrow(/absolute/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', 'relative-evidence', '--expected-head', HEAD,
    ])).toThrow(/absolute/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', '/tmp/e', '--expected-head', 'main',
    ])).toThrow(/head/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', '/tmp/e', '--expected-head', HEAD,
      '--passphrase', 'must-never-be-cli-input',
    ])).toThrow(/unknown|custody|argument/iu)
    expect(() => parseArchiveLifecycleSmokeArgs([
      '--app', '/tmp/app', '--evidence', '/tmp/e', '--expected-head', HEAD,
      '--', '--archive-secret=must-never-be-forwarded',
    ])).toThrow(/secret|credential|custody/iu)
  })

  it('builds a deterministic exact-head CI invocation and Linux-only renderer environment', () => {
    expect(buildArchiveLifecycleSmokeCiRunnerArgs({
      appPath: '/tmp/sartracker-web',
      expectedHead: HEAD,
      platform: 'linux',
      projectRoot: '/repo',
    })).toEqual([
      '/repo/scripts/electron-archive-lifecycle-smoke.mjs',
      '--app',
      '/tmp/sartracker-web',
      '--evidence',
      '/repo/tmp/breadcrumb-pr6-packaged-archive-smoke',
      '--expected-head',
      HEAD,
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ])
    expect(buildArchiveLifecycleSmokeCiEnvironment({
      environment: { DISPLAY: ':99', EXISTING: 'preserved' },
      platform: 'linux',
    })).toEqual({
      DISPLAY: ':99',
      EXISTING: 'preserved',
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
    })
    expect(buildArchiveLifecycleSmokeCiEnvironment({
      environment: { EXISTING: 'preserved' },
      platform: 'darwin',
    })).toEqual({ EXISTING: 'preserved' })
  })

  it('binds the packaged application archive separately from its platform wrapper', () => {
    expect(resolvePackagedApplicationArchivePath(
      '/repo/tmp/electron-dist/linux-unpacked/sartracker-web',
      'linux',
    )).toBe('/repo/tmp/electron-dist/linux-unpacked/resources/app.asar')
    expect(resolvePackagedApplicationArchivePath(
      '/repo/tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app/Contents/MacOS/SAR Tracker Electron Validation',
      'darwin',
    )).toBe(
      '/repo/tmp/electron-dist/mac-arm64/SAR Tracker Electron Validation.app/Contents/Resources/app.asar',
    )
  })

  it('accepts only a complete, exact-head, restart-swept lifecycle proof', () => {
    expect(validateArchiveLifecycleSmokeEvidence(completeEvidence())).toEqual({
      valid: true,
      passed: true,
      failureReasons: [],
    })
  })

  it('requires exact physically seeded object and outing continuation totals', () => {
    const evidence = completeEvidence() as Record<string, Record<string, unknown>>
    const seeded = {
      ...evidence,
      mission: {
        ...evidence.mission,
        seededReplayObjectRows: 202,
        seededOutingChoices: 101,
      },
      reviewBeforeCleanup: {
        ...evidence.reviewBeforeCleanup,
        replayObjectCount: 202,
        replayOutingFilterCount: 101,
      },
      reviewAfterCleanup: {
        ...evidence.reviewAfterCleanup,
        replayObjectCount: 202,
        replayOutingFilterCount: 101,
      },
    }
    expect(validateArchiveLifecycleSmokeEvidence(seeded)).toEqual({
      valid: true,
      passed: true,
      failureReasons: [],
    })

    const unpagedObjects = {
      ...seeded,
      reviewBeforeCleanup: {
        ...seeded.reviewBeforeCleanup,
        replayObjectCount: 100,
      },
    }
    expect(validateArchiveLifecycleSmokeEvidence(unpagedObjects).failureReasons.join('\n'))
      .toMatch(/object.*seeded|seeded.*object/iu)
    const unpagedOutings = {
      ...seeded,
      reviewAfterCleanup: {
        ...seeded.reviewAfterCleanup,
        replayOutingFilterCount: 100,
      },
    }
    expect(validateArchiveLifecycleSmokeEvidence(unpagedOutings).failureReasons.join('\n'))
      .toMatch(/outing.*seeded|seeded.*outing/iu)
  })

  it('proves the verifier integrated into finalization without retrying an already verified archive', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).not.toContain('.verifyMissionArchive(')

    const evidence = completeEvidence() as Record<string, Record<string, unknown>>
    const conflated = {
      ...evidence,
      archive: {
        ...evidence.archive,
        createProgressPhases: ['encrypt', 'publish', 'snapshot', 'verified'],
      },
    }
    expect(validateArchiveLifecycleSmokeEvidence(conflated).failureReasons.join('\n'))
      .toMatch(/create.*seal/iu)
  })

  it('binds CI to the workflow exact-source variable instead of the pull-request merge SHA', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke-ci.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('process.env.EXPECTED_SOURCE_SHA')
    expect(runnerSource).not.toContain('process.env.GITHUB_SHA')
  })

  it('counts every app-owned archive plaintext scratch root in the terminal residue claim', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain("path.join(userDataDir, 'archives', '.staging')")
    expect(runnerSource).toContain("path.join(userDataDir, 'archives', '.verification')")
    expect(runnerSource).toContain("path.join(userDataDir, 'archive-review')")
  })

  it('observes packaged build identity, live Review permissions/content, and child exit', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('resolvePackagedApplicationArchivePath')
    expect(runnerSource).toContain('options.expectedHead')
    expect(runnerSource).toContain('openFilesOwnerOnly')
    expect(runnerSource).toContain("method: 'upsertMarker'")
    expect(runnerSource).toContain('remainingBreadcrumbRows')
    expect(runnerSource).toContain('privacyCanaryDetectedBeforeRestart')
    expect(runnerSource).toContain('observedLaunchExitCount')
  })

  it('physically seeds every Replay continuation lane through public preload calls', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('seedReplayContinuationEvidence')
    expect(runnerSource).toContain('store.upsertMarker')
    expect(runnerSource).toContain('store.createOuting')
    expect(runnerSource).toContain('store.endOuting')
    expect(runnerSource).toContain('store.importGpxEvidencePaths')
    expect(runnerSource).toContain('store.assignGpxImportToOuting')
  })

  it('uses the owned packaged launch page for both restore-interruption calls', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('await input.launch.page.exposeFunction')
    expect(runnerSource).toContain('await input.launch.page.evaluate')
  })

  it('reuses the persisted mission finish fence for both exhaustive Replay reads', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('const reviewSelectedTime = finalized.mission.finish_time')
    expect(runnerSource).toContain('const persistedMission = await page.evaluate')
    expect(runnerSource).toContain('return store.getMission(selectedMissionId)')
    expect(runnerSource.match(/selectedTime: reviewSelectedTime/gu)).toHaveLength(2)
    expect(runnerSource).not.toContain('(input.expectedBreadcrumbCount + 60) * 1_000')
  })

  it('bounds each Replay continuation lane by its own initial declared total', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain('const maximumTrackPages = initialReplayResult.totalTrackCount + 1')
    expect(runnerSource).toContain('const maximumObjectPages = initialReplayResult.totalObjectCount + 1')
    expect(runnerSource).toContain(
      'const maximumOutingFilterPages = initialReplayResult.availableOutingTotalCount + 1',
    )
    expect(runnerSource).not.toContain('const maximumPages = request.expectedBreadcrumbCount + 1')
  })

  it('keeps the disposable profile outside the evidence upload tree and sweeps it', () => {
    const runnerSource = readFileSync(
      path.resolve('scripts/electron-archive-lifecycle-smoke.mjs'),
      'utf8',
    )
    expect(runnerSource).toContain("mkdtemp(path.join(os.tmpdir(), 'sartracker-pr6-archive-smoke-'))")
    expect(runnerSource).not.toContain("path.join(options.evidenceDir, 'user-data')")
    expect(runnerSource).toContain('await removeDisposableProfile(userDataDir)')
    expect(runnerSource.indexOf('await removeDisposableProfile(userDataDir)'))
      .toBeLessThan(runnerSource.indexOf("'electron-archive-lifecycle-smoke-report.json'"))
  })

  it.each([
    ['source head drift', { source: { headAfter: 'd'.repeat(40) } }, /head/iu],
    ['dirty source', { source: { worktreeCleanAfter: false } }, /clean/iu],
    ['stale packaged app', { source: { packagedBuildHeadMatched: false } }, /packaged.*head/iu],
    ['invalid app archive hash', { source: { packagedApplicationArchiveSha256: 'bad' } }, /application.*archive/iu],
    ['unobserved launch exit', { run: { observedLaunchExitCount: 1 } }, /launch.*exit/iu],
    ['no independent verify', { archive: { statusAfterIndependentVerify: 'sealed' } }, /independent.*verif/iu],
    ['no pre-cleanup mutation denial', { reviewBeforeCleanup: { mutationDenied: false } }, /mutation/iu],
    ['pre-cleanup content drift', { reviewBeforeCleanup: { contentSha256: 'd'.repeat(64) } }, /content.*changed|review.*changed/iu],
    ['world-readable Review files', { reviewBeforeCleanup: { openFilesOwnerOnly: false } }, /permission|owner/iu],
    ['restored content count drift', { reviewBeforeCleanup: { breadcrumbCount: 4_095 } }, /breadcrumb.*seeded/iu],
    ['partial Replay track proof', { reviewBeforeCleanup: { replayTrackCount: 1_000 } }, /replay.*track|track.*seeded/iu],
    ['cleanup did not archive', { cleanup: { storageState: 'live' } }, /cleanup|archived/iu],
    ['cleanup retained breadcrumbs', { cleanup: { remainingBreadcrumbRows: 1 } }, /breadcrumb.*remain/iu],
    ['no post-cleanup read', { reviewAfterCleanup: { readMissionIdMatched: false } }, /post-cleanup|mission/iu],
    ['kill not progress-triggered', { interruptedRestore: { progressTriggered: false } }, /progress/iu],
    ['wrong kill signal', { interruptedRestore: { exitSignal: 'SIGTERM' } }, /SIGKILL/iu],
    ['no interrupted residual', { interruptedRestore: { residualEntriesBeforeRestart: 0 } }, /residual.*before/iu],
    ['no interrupted plaintext file', { interruptedRestore: { plaintextFileObservedBeforeRestart: false } }, /plaintext.*before/iu],
    ['restart left residue', { interruptedRestore: { residualEntriesAfterRestart: 1 } }, /restart.*residu/iu],
    ['final plaintext residue', { privacy: { plaintextResidueEntriesAtEnd: 1 } }, /plaintext.*residu/iu],
  ])('fails closed for %s', (_label, patch, expected) => {
    const base = completeEvidence() as Record<string, Record<string, unknown>>
    const [section, update] = Object.entries(patch)[0] as [string, Record<string, unknown>]
    const evidence = { ...base, [section]: { ...base[section], ...update } }
    const verdict = validateArchiveLifecycleSmokeEvidence(evidence)
    expect(verdict.passed).toBe(false)
    expect(verdict.failureReasons.join('\n')).toMatch(expected)
  })

  it('rejects unknown fields, absolute paths, recovery codes, and exact in-memory secrets', () => {
    const evidence = completeEvidence()
    expect(validateArchiveLifecycleSmokeEvidence({
      ...evidence,
      archivePath: '/private/tmp/mission.sararch',
    }).failureReasons.join('\n')).toMatch(/unknown|path/iu)
    expect(validateArchiveLifecycleSmokeEvidence({
      ...evidence,
      privacy: {
        ...(evidence.privacy as Readonly<Record<string, unknown>>),
        recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567',
      },
    }).failureReasons.join('\n')).toMatch(/unknown|recovery|secret/iu)

    expect(() => assertArchiveLifecycleSmokeEvidenceOmitsSecrets(
      evidence,
      ['Generated!Passphrase2026', '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567'],
    )).not.toThrow()
    expect(() => assertArchiveLifecycleSmokeEvidenceOmitsSecrets(
      { ...evidence, leaked: 'Generated!Passphrase2026' },
      ['Generated!Passphrase2026'],
    )).toThrow(/secret|custody/iu)
  })
})
