import { useState } from 'react'

import type {
  MissionReplayRuntimeState,
  MissionReviewController,
} from '../features/mission-review/start-mission-review-runtime'
import type {
  Outing,
  SearchArea,
  SearchAssignment,
  SearchPass,
} from '../infrastructure/mission-store/tauri-mission-store'
import { formatOperatorLocalTimestamp } from '../features/tracking/operator-time'
import {
  formatDublinDateTimeLocal,
  getDublinLocalTimeChoices,
  parseDublinDateTimeLocal,
  type DublinLocalTimeChoice,
} from '../features/mission-review/dublin-local-time'

/** Read-only data-known-at-T surface that never mutates the operational live map. */
export function MissionReplayTab(props: {
  readonly controller: MissionReviewController | null
  readonly missionEndTime: string
  readonly replay: MissionReplayRuntimeState
}) {
  const [selectedLocalTime, setSelectedLocalTime] = useState(() => formatDublinDateTimeLocal(props.missionEndTime))
  const [selectedOffsetMinutes, setSelectedOffsetMinutes] = useState<DublinLocalTimeChoice['offsetMinutes'] | null>(
    () => initialDublinOffsetChoice(props.missionEndTime),
  )
  const [deviceFilterIds, setDeviceFilterIds] = useState<readonly string[]>([])
  const [outingFilterIds, setOutingFilterIds] = useState<readonly string[]>([])
  const selectedTime = readDublinSelection(selectedLocalTime, selectedOffsetMinutes)
  const localTimeChoices = readDublinChoices(selectedLocalTime)
  const result = props.replay.result

  return <div className="space-y-4" data-testid="mission-replay-workspace">
    <section className="rounded-2xl border border-sky-400/40 bg-sky-400/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-200">
            {props.replay.mode === 'live' ? 'Live map context' : 'Replay — data known at selected time'}
          </p>
          <p className="mt-2 text-sm text-stone-200">Replay is read-only and never replaces the operational live map. Current safety positions remain live beside this review.</p>
        </div>
        {props.replay.mode === 'replay' ? <button className="rounded-lg border border-sky-300/50 px-3 py-2 text-xs font-semibold text-sky-100" data-testid="mission-replay-return-live" onClick={props.controller?.returnToLive} type="button">Return to Live / now</button> : null}
      </div>
    </section>
    <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
      <label className="text-[11px] font-bold uppercase tracking-wider text-stone-400" htmlFor="mission-replay-time">Selected local time — Europe/Dublin</label>
      <div className="mt-3 flex flex-wrap gap-3">
        <input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-sm text-stone-100" data-testid="mission-replay-time" id="mission-replay-time" onChange={(event) => { setSelectedLocalTime(event.target.value); setSelectedOffsetMinutes(null) }} step="0.001" type="datetime-local" value={selectedLocalTime} />
        {localTimeChoices.length > 1 ? <label className="text-xs text-stone-300">Repeated clock time
          <select className="ml-2 rounded-lg border border-stone-700 bg-stone-950 px-3 py-2" data-testid="mission-replay-time-offset" onChange={(event) => setSelectedOffsetMinutes(event.target.value === '' ? null : Number(event.target.value) as DublinLocalTimeChoice['offsetMinutes'])} value={selectedOffsetMinutes ?? ''}>
            <option value="">Choose exact occurrence</option>
            <option value="60">First occurrence · Irish Summer Time (UTC+01)</option>
            <option value="0">Second occurrence · Greenwich Mean Time (UTC+00)</option>
          </select>
        </label> : null}
        <button className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-stone-950 disabled:opacity-40" data-testid="mission-replay-seek" disabled={selectedTime.iso === null || props.controller === null || props.replay.loading} onClick={() => selectedTime.iso === null ? undefined : void props.controller?.seekReplay(selectedTime.iso, {
          ...(deviceFilterIds.length === 0 ? {} : { deviceIds: deviceFilterIds }),
          ...(outingFilterIds.length === 0 ? {} : { outingIds: outingFilterIds }),
        })} type="button">{props.replay.loading ? 'Loading evidence…' : 'Replay data known at this time'}</button>
      </div>
      {selectedTime.error === null ? null : <p className="mt-3 text-sm text-rose-200" data-testid="mission-replay-time-error" role="alert">{selectedTime.error}</p>}
    </section>
    {props.replay.error !== null ? <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100" data-testid="mission-replay-error" role="alert">Replay is incomplete: {props.replay.error}. The live map has not been changed.</p> : null}
    {result !== null ? <>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-replay-display-filters">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Display-only track filters</p>
        <p className="mt-2 text-xs text-stone-400">These filters narrow exact track and static GPX evidence only. They never alter reconstructed mission state.</p>
        {result.limitations.some((item) => item.code === 'undated_gpx_static') ? <p className="mt-2 text-xs font-medium text-amber-200">Undated GPX remains static and is excluded from precise replay.</p> : null}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ReplayFilterGroup
            label="Traccar devices"
            onChange={setDeviceFilterIds}
            options={result.availableDeviceIds}
            selected={deviceFilterIds}
            testIdPrefix="mission-replay-device-filter"
          />
          <ReplayFilterGroup
            label="GPX outings"
            onChange={setOutingFilterIds}
            options={result.availableOutingIds}
            selected={outingFilterIds}
            testIdPrefix="mission-replay-outing-filter"
          />
        </div>
        <button className="mt-4 rounded-lg border border-amber-400/50 px-3 py-2 text-xs font-semibold text-amber-100" data-testid="mission-replay-apply-filters" disabled={selectedTime.iso === null || props.controller === null || props.replay.loading} onClick={() => selectedTime.iso === null ? undefined : void props.controller?.seekReplay(selectedTime.iso, {
          ...(deviceFilterIds.length === 0 ? {} : { deviceIds: deviceFilterIds }),
          ...(outingFilterIds.length === 0 ? {} : { outingIds: outingFilterIds }),
        })} type="button">Apply display filters</button>
      </section>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
        <div className="flex justify-between gap-4"><p className="font-mono text-sm text-stone-200">{result.tracks.length.toLocaleString()} / {result.totalTrackCount.toLocaleString()} dated points</p><span className="font-mono text-xs text-stone-400">{Math.round(result.progress * 100)}%</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-800" role="progressbar" aria-valuenow={Math.round(result.progress * 100)}><div className="h-full bg-amber-400" style={{ width: `${result.progress * 100}%` }} /></div>
        <p className="mt-2 text-xs text-stone-400">Showing dated points {Number(result.trackCursor) + 1}–{Number(result.trackCursor) + result.tracks.length} of {result.totalTrackCount.toLocaleString()}.</p>
        <div className="mt-4 flex gap-3">
          {result.previousCursor !== null ? <button className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs text-stone-100" data-testid="mission-replay-load-previous" disabled={props.replay.loadingMore} onClick={() => void props.controller?.loadPreviousReplayChunk()} type="button">Earlier exact page</button> : null}
          {result.nextCursor !== null ? <button className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs text-stone-100" data-testid="mission-replay-load-more" disabled={props.replay.loadingMore} onClick={() => void props.controller?.loadNextReplayChunk()} type="button">{props.replay.loadingMore ? 'Loading next exact page…' : 'Later exact page'}</button> : null}
        </div>
      </section>
      {result.limitations.map((item) => <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100" data-testid={`mission-replay-limitation-${item.code}`} key={item.code}><strong>Evidence limitation:</strong> {item.message}</p>)}
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Versioned objects" value={result.totalObjectCount} />
        <Metric label="Outing states" value={result.objectTypeCounts.outing ?? 0} />
        <Metric label="Dated track points" value={result.totalTrackCount} />
        <Metric label="Static undated GPX" value={result.staticGpxPointCount} />
      </div>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-replay-reconstructed-state">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Reconstructed mission evidence</p>
        <p className="mt-2 text-sm text-stone-200">
          Known by {formatReplayTime(result.selectedTime, result.timezone)} · {result.participants?.length ?? 0} active participants · lifecycle {formatLifecycle(result.missionLifecycle?.event_type)}
        </p>
        {result.objects.length === 0 ? <p className="mt-3 text-sm text-stone-400">{result.limitations.some((item) => item.code === 'browser_harness_version_history_unavailable')
          ? 'Versioned mission-object history is unavailable in browser validation; no absence claim is made.'
          : 'No versioned mission objects were known at this time.'}</p> : <div className="mt-3 space-y-2">
          {result.objects.map((item) => <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-3" data-testid={`mission-replay-object-${item.object_type}-${item.object_id}`} key={`${item.object_type}:${item.object_id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-stone-100">{humanize(item.object_type)} · {readObjectName(item.state, item.object_id)}</strong><span className="font-mono text-[11px] text-stone-400">revision {item.version_sequence} · {item.operation}</span></div>
            <p className="mt-2 text-xs text-stone-400">Effective {formatReplayTime(item.effective_at, result.timezone)} · recorded {formatReplayTime(item.recorded_at, result.timezone)} · {item.completeness.replace('_', ' ')}</p>
          </div>)}
        </div>}
        <p className="mt-3 text-xs text-stone-400">Showing reconstructed objects {Number(result.objectCursor) + 1}–{Number(result.objectCursor) + result.objects.length} of {result.totalObjectCount.toLocaleString()}.</p>
        <div className="mt-3 flex gap-3">
          {result.objectCursor !== '0' ? <button className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs text-stone-100" data-testid="mission-replay-objects-previous" disabled={props.replay.loadingMore} onClick={() => void props.controller?.loadPreviousReplayObjects()} type="button">Earlier object page</button> : null}
          {result.nextObjectCursor !== null ? <button className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs text-stone-100" data-testid="mission-replay-objects-next" disabled={props.replay.loadingMore} onClick={() => void props.controller?.loadNextReplayObjects()} type="button">Later object page</button> : null}
        </div>
      </section>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-replay-exact-track-evidence">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Exact dated track evidence loaded</p>
        {result.tracks.length === 0 ? <p className="mt-3 text-sm text-stone-400">{result.deviceFilterIds.length > 0 || result.outingFilterIds.length > 0
          ? 'No precisely dated track evidence matched the active display filters at this time.'
          : 'No precisely dated track evidence was known and eligible at this time.'}</p> : <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {result.tracks.map((track) => <div className="grid gap-1 rounded-xl border border-stone-800 bg-stone-950/40 p-3 text-xs text-stone-300 md:grid-cols-[minmax(9rem,1fr)_minmax(12rem,1.5fr)]" data-testid={`mission-replay-track-${track.evidence_id}`} key={track.evidence_id}>
            <strong className="text-stone-100">{track.source_type === 'traccar_fix' ? 'Traccar fixTime' : 'GPX source time'}</strong>
            <span>{formatReplayTime(track.effective_at, result.timezone)}</span>
            <span className="font-mono">{track.lat.toFixed(6)}, {track.lon.toFixed(6)}</span>
            <span className="font-mono text-stone-500">{track.track_id}</span>
          </div>)}
        </div>}
      </section>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-replay-static-gpx-evidence">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Static / undated GPX evidence</p>
        {result.staticGpxEvidence.length === 0 ? <p className="mt-3 text-sm text-stone-400">No static GPX evidence was eligible at this time.</p> : result.staticGpxEvidence.map((entry) => <div className="mt-3 rounded-xl border border-stone-800 bg-stone-950/40 p-3 text-xs text-stone-300" key={`${entry.import_id}:${entry.revision_sequence}`}>
          <strong className="text-stone-100">{entry.display_name}</strong>
          <p className="mt-1">{entry.static_point_count.toLocaleString()} undated points · outing {entry.outing_id ?? 'Unassigned'} · revision {entry.revision_sequence}</p>
          <p className="mt-1 font-mono text-stone-500">SHA-256 {entry.content_sha256 ?? 'legacy source hash unavailable'} · {entry.rejection_count} retained rejections</p>
        </div>)}
      </section>
    </> : null}
  </div>
}

/** Coordinator entry and revision display for stable areas, assignments, and repeated passes. */
export function SearchOperationsTab(props: {
  readonly controller: MissionReviewController | null
  readonly operations: { readonly areas: readonly SearchArea[]; readonly assignments: readonly SearchAssignment[]; readonly passes: readonly SearchPass[]; readonly outings: readonly Outing[] }
  readonly readOnly: boolean
}) {
  const [teamId, setTeamId] = useState('')
  const [coordinatorName, setCoordinatorName] = useState('')
  const [outcome, setOutcome] = useState<'full' | 'partial' | 'aborted'>('partial')
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [selectedOutingId, setSelectedOutingId] = useState('')
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('')
  const [assignmentParticipantIds, setAssignmentParticipantIds] = useState('')
  const [passParticipantIds, setPassParticipantIds] = useState('')
  const [clueIds, setClueIds] = useState('')
  const [trackEvidenceIds, setTrackEvidenceIds] = useState('')
  const [assignmentNotes, setAssignmentNotes] = useState('')
  const [passNotes, setPassNotes] = useState('')
  const [passStartedLocal, setPassStartedLocal] = useState('')
  const [passEndedLocal, setPassEndedLocal] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const area = props.operations.areas.find((entry) => entry.id === selectedAreaId) ?? null
  const outing = props.operations.outings.find((entry) => entry.id === selectedOutingId) ?? null
  const eligibleAssignments = props.operations.assignments.filter((entry) =>
    entry.search_area_id === area?.id && entry.outing_id === outing?.id)
  const assignment = eligibleAssignments.find((entry) => entry.id === selectedAssignmentId) ?? null

  const recordAssignment = async () => {
    if (props.readOnly || area === null || outing === null || props.controller === null) return
    setError(null)
    try {
      await props.controller.recordSearchAssignment({
        searchAreaId: area.id,
        outingId: outing.id,
        teamId,
        participantIds: parseIdList(assignmentParticipantIds),
        notes: emptyToNull(assignmentNotes),
        coordinatorName,
      })
      setMessage('Assignment recorded as a revision-safe operational record.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Assignment could not be recorded.')
    }
  }
  const recordPass = async () => {
    if (props.readOnly || area === null || assignment === null || props.controller === null) return
    setError(null)
    try {
      const startedAt = parseDublinDateTimeLocal(passStartedLocal)
      const endedAt = passEndedLocal.trim() === '' ? null : parseDublinDateTimeLocal(passEndedLocal)
      await props.controller.recordSearchPass({
        searchAreaId: area.id,
        assignmentId: assignment.id,
        startedAt,
        endedAt,
        outcome,
        notes: emptyToNull(passNotes),
        coordinatorName,
        participantIds: parseIdList(passParticipantIds),
        clueIds: parseIdList(clueIds),
        trackEvidenceIds: parseIdList(trackEvidenceIds),
      })
      setMessage(`Coordinator-declared ${outcome} pass recorded. Geometry did not set the outcome.`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Search pass could not be recorded.')
    }
  }

  return <div className="space-y-4" data-testid="search-operations-workspace">
    <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5"><p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Stable search operations</p><p className="mt-2 text-sm text-stone-300">Areas keep one stable identity across revisions and repeated assignments. Pass outcomes are coordinator-entered declarations; coverage is advisory only.</p></section>
    {props.readOnly ? <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100" data-testid="search-operations-read-only">This finished or finalized mission is permanently read-only. Retained assignments and passes remain visible for evidence review; new records require an active mission.</p> : null}
    {props.operations.areas.length > 0 ? <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="search-operation-entry">
      <fieldset
        aria-disabled={props.readOnly}
        className={props.readOnly ? 'opacity-50' : undefined}
        disabled={props.readOnly}
      >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs text-stone-300">Search area<select className="mt-1 w-full bg-stone-950 p-2" data-testid="search-operation-area" onChange={(event) => { setSelectedAreaId(event.target.value); setSelectedAssignmentId('') }} value={area?.id ?? ''}><option value="">Select search area</option>{props.operations.areas.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="text-xs text-stone-300">Outing<select className="mt-1 w-full bg-stone-950 p-2" data-testid="search-operation-outing" onChange={(event) => { setSelectedOutingId(event.target.value); setSelectedAssignmentId('') }} value={outing?.id ?? ''}><option value="">Select outing</option>{props.operations.outings.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
        <input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100" data-testid="search-operation-coordinator" maxLength={120} onChange={(event) => setCoordinatorName(event.target.value)} placeholder="Coordinator name" value={coordinatorName} />
        <input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100" data-testid="search-assignment-team" maxLength={120} onChange={(event) => setTeamId(event.target.value)} placeholder="Team / group identity" value={teamId} />
        <input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100" data-testid="search-assignment-participants" maxLength={40_200} onChange={(event) => setAssignmentParticipantIds(event.target.value)} placeholder="Participant IDs, comma separated" value={assignmentParticipantIds} />
        <input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100" data-testid="search-assignment-notes" maxLength={2_000} onChange={(event) => setAssignmentNotes(event.target.value)} placeholder="Assignment notes" value={assignmentNotes} />
      </div>
      <button className="mt-3 disabled:opacity-40" data-testid="search-assignment-record" disabled={props.readOnly || area === null || outing === null || teamId.trim() === '' || coordinatorName.trim() === ''} onClick={() => void recordAssignment()} type="button">Record assignment for selected area and outing</button>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-stone-300">Assignment<select className="mt-1 w-full bg-stone-950 p-2" data-testid="search-pass-assignment" onChange={(event) => setSelectedAssignmentId(event.target.value)} value={assignment?.id ?? ''}><option value="">Select assignment</option>{eligibleAssignments.map((entry) => <option key={entry.id} value={entry.id}>{entry.team_id} · {entry.id}</option>)}</select></label>
        <label className="text-xs text-stone-300">Coordinator-declared outcome<select className="mt-1 w-full bg-stone-950 p-2" data-testid="search-pass-outcome" onChange={(event) => setOutcome(event.target.value as typeof outcome)} value={outcome}><option value="full">Fully searched</option><option value="partial">Partially searched</option><option value="aborted">Aborted</option></select></label>
        <label className="text-xs text-stone-300">Pass start — Europe/Dublin<input className="mt-1 w-full bg-stone-950 p-2" data-testid="search-pass-start" onChange={(event) => setPassStartedLocal(event.target.value)} step="0.001" type="datetime-local" value={passStartedLocal} /></label>
        <label className="text-xs text-stone-300">Pass end — Europe/Dublin (optional while active)<input className="mt-1 w-full bg-stone-950 p-2" data-testid="search-pass-end" onChange={(event) => setPassEndedLocal(event.target.value)} step="0.001" type="datetime-local" value={passEndedLocal} /></label>
        <input className="bg-stone-950 p-2" data-testid="search-pass-participants" maxLength={40_200} onChange={(event) => setPassParticipantIds(event.target.value)} placeholder="Participant IDs, comma separated" value={passParticipantIds} />
        <input className="bg-stone-950 p-2" data-testid="search-pass-clues" maxLength={40_200} onChange={(event) => setClueIds(event.target.value)} placeholder="Clue IDs, comma separated" value={clueIds} />
        <input className="bg-stone-950 p-2" data-testid="search-pass-tracks" maxLength={40_200} onChange={(event) => setTrackEvidenceIds(event.target.value)} placeholder="Track evidence IDs, comma separated" value={trackEvidenceIds} />
        <input className="bg-stone-950 p-2" data-testid="search-pass-notes" maxLength={2_000} onChange={(event) => setPassNotes(event.target.value)} placeholder="Pass notes" value={passNotes} />
      </div>
      <button className="mt-3 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-stone-950 disabled:opacity-40" data-testid="search-pass-record" disabled={props.readOnly || assignment === null || coordinatorName.trim() === '' || passStartedLocal.trim() === ''} onClick={() => void recordPass()} type="button">Record coordinator-declared pass</button>
      </fieldset>
      {message !== null ? <p className="mt-3 text-sm text-emerald-200" data-testid="search-operation-feedback">{message}</p> : null}
      {error !== null ? <p className="mt-3 text-sm text-rose-200" data-testid="search-operation-error" role="alert">{error}</p> : null}
    </section> : null}
    {props.operations.areas.length === 0 ? <p className="text-sm text-stone-400">No stable search areas recorded.</p> : props.operations.areas.map((entry) => <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid={`search-area-${entry.id}`} key={entry.id}><h3 className="font-semibold text-stone-100">{entry.name}</h3><p className="mt-1 font-mono text-[11px] text-stone-500">Stable area {entry.id} · geometry revision {entry.version_sequence}</p>{props.operations.passes.filter((pass) => pass.search_area_id === entry.id).map((pass) => <div className="mt-3 rounded-xl border border-stone-800 p-3 text-sm" data-testid={`search-pass-${pass.id}`} key={pass.id}><p><strong>Coordinator-declared: {pass.outcome}</strong> · revision {pass.version_sequence}</p><p className="mt-1 text-xs text-stone-400">{formatReplayTime(pass.started_at, 'Europe/Dublin')} → {pass.ended_at === null ? 'active' : formatReplayTime(pass.ended_at, 'Europe/Dublin')}</p><p className="mt-1 text-xs text-stone-500">Links: {pass.participant_ids?.length ?? 0} participants · {pass.clue_ids?.length ?? 0} clues · {pass.track_evidence_ids?.length ?? 0} tracks</p></div>)}</section>)}
  </div>
}

/** Renders one bounded multi-select used only to narrow replay track display. */
function ReplayFilterGroup(props: {
  readonly label: string
  readonly options: readonly string[]
  readonly selected: readonly string[]
  readonly onChange: (selected: readonly string[]) => void
  readonly testIdPrefix: string
}) {
  return <fieldset className="rounded-xl border border-stone-800 p-3">
    <legend className="px-1 text-xs font-semibold text-stone-200">{props.label}</legend>
    {props.options.length === 0 ? <p className="text-xs text-stone-500">No eligible evidence sources at this time.</p> : <div className="mt-1 max-h-32 space-y-2 overflow-y-auto">
      {props.options.map((option) => <label className="flex items-center gap-2 text-xs text-stone-300" key={option}>
        <input
          checked={props.selected.includes(option)}
          data-testid={`${props.testIdPrefix}-${option}`}
          onChange={(event) => props.onChange(event.target.checked
            ? [...props.selected, option]
            : props.selected.filter((entry) => entry !== option))}
          type="checkbox"
        />
        <span className="font-mono">{option}</span>
      </label>)}
    </div>}
  </fieldset>
}

function Metric(props: { readonly label: string; readonly value: number }) {
  return <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-4"><p className="text-[10px] uppercase text-stone-400">{props.label}</p><p className="mt-2 font-mono text-xl text-stone-100">{props.value.toLocaleString()}</p></div>
}

function readDublinSelection(
  value: string,
  offsetMinutes: DublinLocalTimeChoice['offsetMinutes'] | null = null,
): { readonly iso: string | null; readonly error: string | null } {
  try {
    return { iso: parseDublinDateTimeLocal(value, offsetMinutes ?? undefined), error: null }
  } catch (error) {
    return { iso: null, error: error instanceof Error ? error.message : 'Enter a valid Europe/Dublin time.' }
  }
}

function readDublinChoices(value: string): readonly DublinLocalTimeChoice[] {
  try {
    return getDublinLocalTimeChoices(value)
  } catch {
    return []
  }
}

function initialDublinOffsetChoice(value: string): DublinLocalTimeChoice['offsetMinutes'] | null {
  const canonical = new Date(value).toISOString()
  const local = formatDublinDateTimeLocal(canonical)
  return readDublinChoices(local).find((choice) => choice.iso === canonical)?.offsetMinutes ?? null
}

function parseIdList(value: string): readonly string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))]
}

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim()
}

function formatReplayTime(value: string, timezone: string): string {
  return formatOperatorLocalTimestamp(value, { timeZone: timezone })
}

function formatLifecycle(value: string | undefined): string {
  return value === undefined ? 'unknown' : humanize(value.replace(/^mission_/u, ''))
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

function readObjectName(state: Readonly<Record<string, unknown>>, fallback: string): string {
  for (const key of ['name', 'label', 'title']) {
    const value = state[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return fallback
}
