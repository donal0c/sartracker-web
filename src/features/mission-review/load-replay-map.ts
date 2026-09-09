import type { MissionReplayReadInput, MissionReplayReadResult, MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import { projectReplayMapAsync, type ReplayMapProjection } from './project-replay-map-async'

export type ReplayMapState = {
  readonly status: 'loading' | 'ready' | 'partial' | 'error'
  readonly data: ReplayMapProjection | null
  readonly loaded: number
  readonly total: number
  readonly message: string
}

/** Loads every selected-time page through existing read-only, generation-bound ports. */
export async function loadReplayMap(input: {
  readonly first: MissionReplayReadResult
  readonly store: Pick<MissionStore, 'readMissionReplayTrackChunk' | 'readMissionReplayObjectChunk'>
  readonly requestId: () => string
  readonly isCurrent: () => boolean
  readonly publish: (state: ReplayMapState) => void
  readonly project?: typeof projectReplayMapAsync
}): Promise<void> {
  const first = input.first
  const tracks = [...first.tracks]
  const objects = [...first.objects]
  const total = first.totalTrackCount + first.totalObjectCount
  const query: MissionReplayReadInput = {
    missionId: first.missionId, selectedTime: first.selectedTime,
    trackLimit: 1_000, objectLimit: 100,
    ...(first.replayGeneration === undefined ? {} : { replayGeneration: first.replayGeneration }),
    ...(first.deviceFilterIds.length ? { deviceIds: first.deviceFilterIds } : {}),
    ...(first.outingFilterIds.length ? { outingIds: first.outingFilterIds } : {}),
  }
  const publishProgress = () => input.publish({ status: 'loading', data: null,
    loaded: tracks.length + objects.length, total, message: 'Loading selected-time map evidence…' })
  try {
    publishProgress()
    let cursor = first.nextCursor
    const seen = new Set<string>()
    while (cursor !== null && input.isCurrent()) {
      if (seen.has(cursor)) throw new Error('Replay track continuation repeated. Re-seek the selected time.')
      seen.add(cursor)
      if (!input.store.readMissionReplayTrackChunk) throw new Error('Track continuation is unavailable.')
      const page = await input.store.readMissionReplayTrackChunk({ ...query, cursor }, input.requestId())
      if (!input.isCurrent()) return
      if (page.missionId !== first.missionId || page.selectedTime !== first.selectedTime || page.totalTrackCount !== first.totalTrackCount) throw new Error('Replay map snapshot changed. Re-seek the selected time.')
      tracks.push(...page.tracks)
      cursor = page.nextCursor
      publishProgress()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    let objectCursor = first.nextObjectCursor
    seen.clear()
    while (objectCursor !== null && input.isCurrent()) {
      if (seen.has(objectCursor)) throw new Error('Replay object continuation repeated. Re-seek the selected time.')
      seen.add(objectCursor)
      if (!input.store.readMissionReplayObjectChunk) throw new Error('Object continuation is unavailable.')
      const page = await input.store.readMissionReplayObjectChunk({ ...query, objectCursor }, input.requestId())
      if (!input.isCurrent()) return
      if (page.missionId !== first.missionId || page.selectedTime !== first.selectedTime || page.totalObjectCount !== first.totalObjectCount) throw new Error('Replay object snapshot changed. Re-seek the selected time.')
      objects.push(...page.objects)
      objectCursor = page.nextObjectCursor
      publishProgress()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    for (let index = 0; index < objects.length && input.isCurrent(); index += 1) {
      const object = objects[index]!
      if (object.state._state_details_omitted !== true || !['marker', 'drawing', 'search_area', 'helicopter'].includes(object.object_type)) continue
      if (!input.store.readMissionReplayObjectChunk) throw new Error('Full map geometry is unavailable.')
      let offset: number | null = 0
      let totalCharacters: number | undefined
      const fragments: string[] = []
      while (offset !== null && input.isCurrent()) {
        const page = await input.store.readMissionReplayObjectChunk({ ...query,
          objectDetails: { objectType: object.object_type, objectId: object.object_id, offset },
        }, input.requestId())
        if (!input.isCurrent()) return
        const detail = page.objectDetails
        if (page.missionId !== first.missionId || page.selectedTime !== first.selectedTime || !detail || detail.objectId !== object.object_id || detail.objectType !== object.object_type
          || detail.versionSequence !== object.version_sequence || detail.offset !== offset
          || !Number.isSafeInteger(detail.totalCharacters) || detail.totalCharacters <= 0
          || (totalCharacters !== undefined && detail.totalCharacters !== totalCharacters)
          || detail.fragment.length === 0 || offset + detail.fragment.length > detail.totalCharacters
          || (detail.nextOffset === null && offset + detail.fragment.length !== detail.totalCharacters)
          || (detail.nextOffset !== null && detail.nextOffset !== offset + detail.fragment.length)) throw new Error('Replay geometry continuation is inconsistent.')
        totalCharacters = detail.totalCharacters
        fragments.push(detail.fragment)
        offset = detail.nextOffset
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      if (!input.isCurrent()) return
      const serialized = fragments.join('')
      if (typeof object.state._state_sha256 === 'string') {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))
        const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        if (hex !== object.state._state_sha256) throw new Error('Replay object integrity check failed.')
      }
      const state: unknown = JSON.parse(serialized)
      if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new Error('Replay object geometry is invalid.')
      objects[index] = { ...object, state: state as Readonly<Record<string, unknown>> }
    }
    if (!input.isCurrent()) return
    if (tracks.length !== first.totalTrackCount || objects.length !== first.totalObjectCount) throw new Error('Required map evidence is missing from the page chain.')
    const limitations = first.limitations.filter((entry) => !['large_object_details_summarized', 'undated_gpx_static', 'outing_filter_choices_paged', 'static_gpx_summary_truncated'].includes(entry.code))
    const data = await (input.project ?? projectReplayMapAsync)(tracks, objects, input.isCurrent)
    if (!input.isCurrent()) return
    input.publish({ status: limitations.length ? 'partial' : 'ready', data, loaded: total, total,
      message: limitations.length ? 'Map loaded with evidence limitations; see the warnings below.' : 'Selected-time dated evidence loaded. Undated GPX is excluded from this timeline.' })
  } catch (error) {
    if (input.isCurrent()) input.publish({ status: 'error', data: null, loaded: tracks.length + objects.length, total,
      message: error instanceof Error ? error.message : 'Replay map could not be loaded.' })
  }
}
