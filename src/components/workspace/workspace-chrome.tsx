import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useDiagnosticsWorkspaceStore } from '../../features/diagnostics/diagnostics-workspace-store'
import { useLastConfirmedAt, type TrackingCondition, type TrackingHeadline } from '../../features/workspace/tracking-headline'
import { useMissionReviewWorkspaceStore } from '../../features/mission-review/mission-review-workspace-store'
import { useMissionStore } from '../../features/mission/mission-store'
import { formatMissionDuration } from '../../features/mission/mission-timers'
import { useMissionTimer } from '../../features/mission/use-mission-timer'
import { useSettingsWorkspaceStore } from '../../features/settings/settings-workspace-store'
import { formatOperatorLocalTimestamp } from '../../features/tracking/operator-time'
import { APP_VERSION } from '../../lib/app-version'
import { getAppRuntimeController } from '../../features/runtime/app-runtime-controller'
import { ThemeToggle } from '../theme-toggle'
import { TrackingStatusPanel } from '../tracking-status-panel'

const LAST_RECEIVED = 'The last positions received. They may not be where people are now.'
const TRACKING_ADVICE: Record<TrackingCondition, { readonly happened: string; readonly map: string; readonly todo: string }> = {
  ok: { happened: 'Positions are coming in normally.', map: 'The latest positions received.', todo: 'Nothing. Positions are coming in normally.' },
  attention: { happened: 'Tracking is running, with something to check.', map: 'The latest positions received.', todo: 'Check the people or items listed above. Tracking itself is still running.' },
  lost: { happened: 'New positions have stopped arriving.', map: LAST_RECEIVED, todo: "Don't rely on the map until this clears. Check this computer's internet connection, then press Reconnect." },
  paused: { happened: 'The mission is paused, so positions are not updating.', map: LAST_RECEIVED, todo: 'Positions stopped because the mission is paused. Press Resume mission in the red bar to start them again.' },
  record: { happened: 'Part of the mission record could not be saved.', map: 'Live positions. They are still updating.', todo: 'Keep this app open and carry on tracking. Do not finish the mission yet. Open More, then Diagnostics, and send the support bundle.' },
  recovery: { happened: 'A mission was interrupted and has not been resumed.', map: LAST_RECEIVED, todo: 'Choose Resume in the mission card if this is the same incident.' },
  disconnected: { happened: 'Tracking is not connected.', map: 'No live positions yet.', todo: 'Check the tracking server in Settings, then press Reconnect.' },
}

/** The one line that says whether the map can be trusted; click for the detail. */
function TrackingHeadlineButton(props: { readonly headline: TrackingHeadline; readonly onOpen: () => void }) {
  const lastSuccessAt = useLastConfirmedAt()
  const { headline } = props
  return (
    <button
      aria-label={`${headline.text}. Open tracking details`}
      className={`ws-health ws-health-${headline.tone}`}
      data-testid="ws-tracking-headline"
      onClick={props.onOpen}
      role="status"
      title="Open tracking details"
      type="button"
    >
      <strong><span aria-hidden="true">{headline.tone === 'ok' ? '●' : '⚠'} </span>{headline.text}</strong>
      <span className="ws-health-time">Last update {lastSuccessAt === null ? 'none yet' : formatOperatorLocalTimestamp(lastSuccessAt).replace(/ GMT.*$/, '')}</span>
    </button>
  )
}

/**
 * Mission name and the active search clock (Sar_4); Since start is in the
 * Mission panel. A warning inside Mission is badged here until it clears.
 */
function MissionSummary(props: { readonly attention: boolean; readonly onOpen: () => void; readonly open: boolean }) {
  const mission = useMissionStore((state) => state.currentMission)
  const recoverableMission = useMissionStore((state) => state.recoverableMission)
  const phase = useMissionStore((state) => state.phase)
  const timer = useMissionTimer(mission)
  // An unfinished mission waiting to be resumed is named, not reported as "No mission running".
  const shownName = mission?.name ?? (phase === 'recovery' ? recoverableMission?.name : undefined) ?? 'No mission running'
  return (
    <>
      <button
        aria-expanded={props.open}
        className="ws-mission-button"
        data-testid="ws-mission-button"
        onClick={props.onOpen}
        title="Pause, finish, add people, review"
        type="button"
      >
        <span className={`ws-mission-phase ws-phase-${phase}`} data-testid="ws-mission-phase">{phase === 'idle' ? 'Start a mission ▾' : phase === 'active' ? 'Mission ▾ · Running' : phase === 'paused' ? 'Mission ▾ · PAUSED' : 'Mission ▾ · Needs resuming'}</span>
        <span className="ws-mission-name" data-testid="current-mission-name">{shownName}</span>
        {props.attention ? <span className="ws-badge" data-testid="ws-mission-attention" role="status">⚠ Needs attention</span> : null}
      </button>
      {mission === null ? null : (
        <div className="ws-clocks" data-testid="ws-clocks">
          <div><span>Search time</span><strong>{formatMissionDuration(timer?.activeSeconds ?? 0)}</strong></div>
        </div>
      )}
    </>
  )
}

/** Weather, Diagnostics and display choices stay one click away but out of the way. */
function MoreMenu(props: { readonly weather: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const openDiagnostics = useDiagnosticsWorkspaceStore((state) => state.openWorkspace)
  const openReview = useMissionReviewWorkspaceStore((state) => state.openWorkspace)

  // A press inside a child's portal (the weather menu renders on the body so the
  // top bar cannot clip it [DON-340]) is outside this element in the page but
  // inside it in React, whose events bubble through portals. Mark those presses
  // so the window listener, which runs after React's, does not close More and
  // unmount the weather link before its click lands.
  const pressedInside = useRef(false)

  useEffect(() => {
    if (!open) return
    // The press that opened More marked itself inside before this listener existed.
    pressedInside.current = false
    const close = (event: PointerEvent) => {
      const inside = pressedInside.current || (ref.current !== null && ref.current.contains(event.target as Node))
      pressedInside.current = false
      if (!inside) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="relative" onPointerDown={() => { pressedInside.current = true }} ref={ref}>
      <button aria-expanded={open} className="ws-bar-button" data-testid="ws-more-button" onClick={() => setOpen(!open)} type="button">More ▾</button>
      {open ? (
        <div className="ws-menu" data-testid="ws-more-menu">
          <button data-testid="ws-open-review" onClick={() => { setOpen(false); openReview() }} type="button">Review and replay</button>
          <button data-testid="open-diagnostics-workspace" onClick={() => { setOpen(false); openDiagnostics() }} type="button">Diagnostics</button>
          <a data-testid="open-help-manual" href="./manual/index.html" rel="noreferrer" target="_blank">Help</a>
          <div className="ws-menu-row">{props.weather}</div>
          <div className="ws-menu-row"><ThemeToggle /></div>
          <p className="ws-menu-version">{APP_VERSION}</p>
        </div>
      ) : null}
    </div>
  )
}

/** A single shallow row: mission, trust in the map, panels, and little else. */
export function WorkspaceTopBar(props: {
  readonly headline: TrackingHeadline
  readonly missionAttention: boolean
  readonly missionOpen: boolean
  readonly onToggleMission: () => void
  readonly onOpenTracking: () => void
  readonly panelButtons: ReactNode
  readonly weather: ReactNode
}) {
  const openSettings = useSettingsWorkspaceStore((state) => state.openWorkspace)
  return (
    <header className="ws-top-bar" data-testid="ws-top-bar">
      <img alt="Mountain Rescue team logo" className="ws-logo" src="./brand/kmrt-logo-compact.png" />
      <h1 className="sr-only" data-testid="app-title">SAR Tracker</h1>
      <MissionSummary attention={props.missionAttention} onOpen={props.onToggleMission} open={props.missionOpen} />
      <TrackingHeadlineButton headline={props.headline} onOpen={props.onOpenTracking} />
      <div className="ws-bar-actions">
        {props.panelButtons}
        <button className="ws-bar-button" data-testid="open-settings-workspace" onClick={() => openSettings()} type="button">Settings</button>
        <MoreMenu weather={props.weather} />
      </div>
    </header>
  )
}

/** Full-width alarm for a stopped map; it cannot be scrolled or closed away. */
export function TrackingAlarm(props: { readonly headline: TrackingHeadline; readonly onOpenTracking: () => void }) {
  const phase = useMissionStore((state) => state.phase)
  const controller = useMissionStore((state) => state.controller)
  const [resumeError, setResumeError] = useState<string | null>(null)
  if (props.headline.tone !== 'alert') return null
  return (
    <div className="ws-alarm" data-testid="ws-alarm" role="alert">
      <strong>{props.headline.alarm ?? props.headline.text}</strong>
      {resumeError === null ? null : <span>{resumeError}</span>}
      {phase === 'paused' ? (
        <button
          data-testid="ws-alarm-resume"
          onClick={() => {
            setResumeError(null)
            controller?.resumeMission().catch((error: unknown) => {
              setResumeError(error instanceof Error ? error.message : 'Could not resume the mission. Try Mission, then Resume.')
            })
          }}
          type="button"
        >
          Resume mission
        </button>
      ) : (
        <button data-testid="ws-alarm-details" onClick={props.onOpenTracking} type="button">What to do</button>
      )}
    </div>
  )
}

/** Heading shared by every panel in the side slot, always with a plain way out. */
export function PanelHead(props: { readonly title: ReactNode; readonly onClose: () => void; readonly children?: ReactNode }) {
  return (
    <div className="ws-section-head">
      <h2>{props.title}</h2>
      <span className="flex items-center gap-1">
        {props.children}
        <button className="ws-close" data-testid="ws-panel-close" onClick={props.onClose} type="button">Close</button>
      </span>
    </div>
  )
}

/** Says in plain words what happened, what the map is showing and what to do. */
export function TrackingDetails(props: { readonly headline: TrackingHeadline; readonly onClose: () => void }) {
  const { headline } = props
  const lastSuccessAt = useLastConfirmedAt()
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectError, setReconnectError] = useState<string | null>(null)
  const advice = TRACKING_ADVICE[headline.condition]
  const canReconnect = headline.condition === 'lost' || headline.condition === 'disconnected'

  return (
    <section className="ws-panel-section" data-testid="ws-tracking-panel">
      <PanelHead onClose={props.onClose} title="Tracking" />
      <div className="ws-panel-scroll">
        <dl className="ws-plain-lines">
          <dt>What has happened</dt>
          <dd data-testid="ws-tracking-happened">{advice.happened}{headline.issues.length === 0 ? null : <ul>{headline.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</dd>
          <dt>What the map is showing</dt>
          <dd>{advice.map} Last update: {lastSuccessAt === null ? 'none yet' : formatOperatorLocalTimestamp(lastSuccessAt)}.</dd>
          <dt>What to do</dt>
          <dd data-testid="ws-tracking-advice">{advice.todo}</dd>
        </dl>
        {canReconnect ? <button
          className="sar-button my-2 w-full px-3 py-2 text-sm font-bold"
          data-testid="ws-reconnect"
          disabled={reconnecting}
          onClick={() => {
            const controller = getAppRuntimeController()
            if (controller === null) return
            setReconnecting(true)
            setReconnectError(null)
            controller.reloadSettings({ forceConnect: true })
              .catch((error: unknown) => setReconnectError(error instanceof Error ? error.message : 'Could not reconnect.'))
              .finally(() => setReconnecting(false))
          }}
          type="button"
        >
          {reconnecting ? 'Reconnecting…' : 'Reconnect'}
        </button> : null}
        {reconnectError === null ? null : <p className="sar-inline-alert p-2 text-sm" role="alert">{reconnectError}</p>}
        <TrackingStatusPanel variant="simplified" />
      </div>
    </section>
  )
}
