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

/** Read-only data-known-at-T surface that never mutates the operational live map. */
export function MissionReplayTab(props: {
  readonly controller: MissionReviewController | null
  readonly missionEndTime: string
  readonly replay: MissionReplayRuntimeState
}) {
  const [selectedLocalTime, setSelectedLocalTime] = useState(() => toDateTimeLocal(props.missionEndTime))
  const selectedDate = new Date(selectedLocalTime)
  const validSelection = Number.isFinite(selectedDate.getTime())
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
        <input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-sm text-stone-100" data-testid="mission-replay-time" id="mission-replay-time" onChange={(event) => setSelectedLocalTime(event.target.value)} step="0.001" type="datetime-local" value={selectedLocalTime} />
        <button className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-stone-950 disabled:opacity-40" data-testid="mission-replay-seek" disabled={!validSelection || props.controller === null || props.replay.loading} onClick={() => void props.controller?.seekReplay(selectedDate.toISOString())} type="button">{props.replay.loading ? 'Loading evidence…' : 'Replay data known at this time'}</button>
      </div>
    </section>
    {props.replay.error !== null ? <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100" data-testid="mission-replay-error" role="alert">Replay is incomplete: {props.replay.error}. The live map has not been changed.</p> : null}
    {result !== null ? <>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
        <div className="flex justify-between gap-4"><p className="font-mono text-sm text-stone-200">{result.tracks.length.toLocaleString()} / {result.totalTrackCount.toLocaleString()} dated points</p><span className="font-mono text-xs text-stone-400">{Math.round(result.progress * 100)}%</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-800" role="progressbar" aria-valuenow={Math.round(result.progress * 100)}><div className="h-full bg-amber-400" style={{ width: `${result.progress * 100}%` }} /></div>
        {result.nextCursor !== null ? <button className="mt-4 rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-xs text-stone-100" data-testid="mission-replay-load-more" disabled={props.replay.loadingMore} onClick={() => void props.controller?.loadNextReplayChunk()} type="button">{props.replay.loadingMore ? 'Loading next exact page…' : 'Load next exact evidence page'}</button> : null}
      </section>
      {result.limitations.map((item) => <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-100" data-testid={`mission-replay-limitation-${item.code}`} key={item.code}><strong>Evidence limitation:</strong> {item.message}</p>)}
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Versioned objects" value={result.objects.length} />
        <Metric label="Outing states" value={result.objects.filter((item) => item.object_type === 'outing').length} />
        <Metric label="Dated track points" value={result.totalTrackCount} />
        <Metric label="Static undated GPX" value={result.staticGpxPointCount} />
      </div>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-replay-reconstructed-state">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Reconstructed mission evidence</p>
        <p className="mt-2 text-sm text-stone-200">
          Known by {formatReplayTime(result.selectedTime, result.timezone)} · {result.participants?.length ?? 0} active participants · lifecycle {formatLifecycle(result.missionLifecycle?.event_type)}
        </p>
        {result.objects.length === 0 ? <p className="mt-3 text-sm text-stone-400">No versioned mission objects were known at this time.</p> : <div className="mt-3 space-y-2">
          {result.objects.slice(0, 50).map((item) => <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-3" data-testid={`mission-replay-object-${item.object_type}-${item.object_id}`} key={`${item.object_type}:${item.object_id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-stone-100">{humanize(item.object_type)} · {readObjectName(item.state, item.object_id)}</strong><span className="font-mono text-[11px] text-stone-400">revision {item.version_sequence} · {item.operation}</span></div>
            <p className="mt-2 text-xs text-stone-400">Effective {formatReplayTime(item.effective_at, result.timezone)} · recorded {formatReplayTime(item.recorded_at, result.timezone)} · {item.completeness.replace('_', ' ')}</p>
          </div>)}
        </div>}
      </section>
      <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="mission-replay-exact-track-evidence">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Exact dated track evidence loaded</p>
        {result.tracks.length === 0 ? <p className="mt-3 text-sm text-stone-400">No precisely dated track evidence was eligible at this time.</p> : <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {result.tracks.slice(0, 100).map((track) => <div className="grid gap-1 rounded-xl border border-stone-800 bg-stone-950/40 p-3 text-xs text-stone-300 md:grid-cols-[minmax(9rem,1fr)_minmax(12rem,1.5fr)]" data-testid={`mission-replay-track-${track.evidence_id}`} key={track.evidence_id}>
            <strong className="text-stone-100">{track.source_type === 'traccar_fix' ? 'Traccar fixTime' : 'GPX source time'}</strong>
            <span>{formatReplayTime(track.effective_at, result.timezone)}</span>
            <span className="font-mono">{track.lat.toFixed(6)}, {track.lon.toFixed(6)}</span>
            <span className="font-mono text-stone-500">{track.track_id}</span>
          </div>)}
        </div>}
      </section>
    </> : null}
  </div>
}

/** Coordinator entry and revision display for stable areas, assignments, and repeated passes. */
export function SearchOperationsTab(props: {
  readonly controller: MissionReviewController | null
  readonly operations: { readonly areas: readonly SearchArea[]; readonly assignments: readonly SearchAssignment[]; readonly passes: readonly SearchPass[]; readonly outings: readonly Outing[] }
}) {
  const [teamId, setTeamId] = useState('')
  const [coordinatorName, setCoordinatorName] = useState('')
  const [outcome, setOutcome] = useState<'full' | 'partial' | 'aborted'>('partial')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const area = props.operations.areas[0] ?? null
  const outing = props.operations.outings[0] ?? null
  const assignment = area === null ? null : props.operations.assignments.find((entry) => entry.search_area_id === area.id) ?? null
  const recordAssignment = async () => {
    if (area === null || outing === null || props.controller === null) return
    setError(null)
    try {
      await props.controller.recordSearchAssignment({ searchAreaId: area.id, outingId: outing.id, teamId, participantIds: [], notes: null, coordinatorName })
      setMessage('Assignment recorded as a revision-safe operational record.')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Assignment could not be recorded.')
    }
  }
  const recordPass = async () => {
    if (area === null || assignment === null || props.controller === null) return
    const timestamp = new Date().toISOString()
    setError(null)
    try {
      await props.controller.recordSearchPass({ searchAreaId: area.id, assignmentId: assignment.id, startedAt: timestamp, endedAt: timestamp, outcome, notes: null, coordinatorName })
      setMessage(`Coordinator-declared ${outcome} pass recorded. Geometry did not set the outcome.`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Search pass could not be recorded.')
    }
  }

  return <div className="space-y-4" data-testid="search-operations-workspace">
    <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5"><p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Stable search operations</p><p className="mt-2 text-sm text-stone-300">Areas keep one stable identity across revisions and repeated assignments. Pass outcomes are coordinator-entered declarations; coverage is advisory only.</p></section>
    {area !== null ? <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid="search-operation-entry">
      <div className="grid gap-3 md:grid-cols-2"><input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100" data-testid="search-operation-coordinator" onChange={(event) => setCoordinatorName(event.target.value)} placeholder="Coordinator name" value={coordinatorName} /><input className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100" data-testid="search-assignment-team" onChange={(event) => setTeamId(event.target.value)} placeholder="Team / group identity" value={teamId} /></div>
      <div className="mt-3 flex flex-wrap gap-3"><button data-testid="search-assignment-record" disabled={outing === null || teamId.trim() === '' || coordinatorName.trim() === ''} onClick={() => void recordAssignment()} type="button">Record assignment</button><select className="bg-stone-950" data-testid="search-pass-outcome" onChange={(event) => setOutcome(event.target.value as typeof outcome)} value={outcome}><option value="full">Fully searched</option><option value="partial">Partially searched</option><option value="aborted">Aborted</option></select><button className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-stone-950 disabled:opacity-40" data-testid="search-pass-record" disabled={assignment === null || coordinatorName.trim() === ''} onClick={() => void recordPass()} type="button">Record coordinator-declared pass</button></div>
      {message !== null ? <p className="mt-3 text-sm text-emerald-200" data-testid="search-operation-feedback">{message}</p> : null}
      {error !== null ? <p className="mt-3 text-sm text-rose-200" data-testid="search-operation-error" role="alert">{error}</p> : null}
    </section> : null}
    {props.operations.areas.length === 0 ? <p className="text-sm text-stone-400">No stable search areas recorded.</p> : props.operations.areas.map((entry) => <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5" data-testid={`search-area-${entry.id}`} key={entry.id}><h3 className="font-semibold text-stone-100">{entry.name}</h3><p className="mt-1 font-mono text-[11px] text-stone-500">Stable area {entry.id} · geometry revision {entry.version_sequence}</p>{props.operations.passes.filter((pass) => pass.search_area_id === entry.id).map((pass) => <p className="mt-3 rounded-xl border border-stone-800 p-3 text-sm" data-testid={`search-pass-${pass.id}`} key={pass.id}><strong>Coordinator-declared: {pass.outcome}</strong> · revision {pass.version_sequence}</p>)}</section>)}
  </div>
}

function Metric(props: { readonly label: string; readonly value: number }) {
  return <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-4"><p className="text-[10px] uppercase text-stone-400">{props.label}</p><p className="mt-2 font-mono text-xl text-stone-100">{props.value.toLocaleString()}</p></div>
}

function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`
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
