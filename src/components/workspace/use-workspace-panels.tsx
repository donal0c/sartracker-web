import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { countPeopleNeedingAttention } from '../../features/workspace/people-model'
import { persistFullMap, readStoredFullMap } from '../../features/workspace/full-map-preference'
import { panelOpenByDefault, panelSide, type PanelArrangement } from '../../features/workspace/panel-arrangement'
import { useTrackingHeadline } from '../../features/workspace/tracking-headline'
import { useMissionStore } from '../../features/mission/mission-store'
import { selectWorkspaceHideBlockedReason } from '../../features/mission/workspace-hide-blocked-reason'
import { CoverageAttentionIndicator } from '../coverage-attention-indicator'
import { DeferredGpxImportPanel } from '../deferred-gpx-import-panel'
import { HelicopterPanel } from '../helicopter-panel'
import { LayerFilterPanel } from '../layer-filter-panel'
import { MissionControlPanel } from '../mission-control-panel'
import { usePeopleRows } from '../../features/workspace/use-people-rows'
import { ExceptionsOnMap } from './exceptions-on-map'
import { PeoplePanel } from './people-panel'
import { useOpenTrackingAdvice } from './use-open-tracking-advice'
import { TrackingDetails, TrackingAlarm, PanelHead, WorkspaceTopBar } from './workspace-chrome'

type BasePanel = 'people' | 'layers'
type TemporaryPanel = 'mission' | 'tracking' | 'tools'

/**
 * Builds the shared top bar, alarm and the single side slot for the chosen arrangement.
 * Only one panel shows at a time; arrangements differ in where the slot sits
 * and in whether it is open by default.
 */
export function useWorkspacePanels(input: {
  readonly arrangement: PanelArrangement
  readonly weather: ReactNode
  readonly onActionErrorChange: (error: string | null) => void
  readonly onDecisionOpenChange: (open: boolean) => void
  readonly decisionOpen: boolean
  readonly actionError: string | null
}): { readonly top: ReactNode; readonly alarm: ReactNode; readonly side: ReactNode; readonly overMap: ReactNode; readonly slotSide: 'left' | 'right' } {
  const { arrangement, decisionOpen, actionError } = input
  const side = panelSide(arrangement)
  const phase = useMissionStore((state) => state.phase)
  const governanceMission = useMissionStore((state) => state.governanceMission)
  const headline = useTrackingHeadline()
  const people = usePeopleRows()
  const attentionCount = countPeopleNeedingAttention(people)

  // The operator's last Full map choice wins over the arrangement's default.
  const defaultBase = useCallback(
    (): BasePanel | null => (readStoredFullMap() || !panelOpenByDefault(arrangement) ? null : 'people'),
    [arrangement],
  )
  const [base, setBaseState] = useState<BasePanel | null>(defaultBase)
  const setBase = useCallback((next: BasePanel | null) => {
    persistFullMap(next === null)
    setBaseState(next)
  }, [])
  const [temporary, setTemporary] = useState<TemporaryPanel | null>(null)
  // What to do in the alarm shows Tracking and moves focus to it, closing an open workspace first.
  const [trackingFocusToken, setTrackingFocusToken] = useState(0)
  const showTrackingAdvice = useCallback(() => {
    setTemporary('tracking')
    setTrackingFocusToken((token) => token + 1)
  }, [])
  const openTrackingAdvice = useOpenTrackingAdvice(showTrackingAdvice)
  useEffect(() => { setBaseState(defaultBase()) }, [defaultBase])

  const running = phase === 'active' || phase === 'paused'
  const isSetup = phase === 'idle' || phase === 'recovery'
  const [setupCardOpen, setSetupCardOpen] = useState(true)
  // Layers before Start, in recovery and after Finish. Kept apart from `base`
  // so closing it does not count as choosing Full map.
  const [setupPanel, setSetupPanel] = useState<'layers' | null>(null)
  useEffect(() => {
    setTemporary(null)
    setSetupCardOpen(true)
    setSetupPanel(null)
  }, [phase])

  // An open decision (for example the Finish confirmation) holds Mission in view.
  // A failed action does not: it is flagged below, so Tracking (Reconnect) stays reachable.
  const missionForced = decisionOpen
  // Before Start the card is Mission itself. As on the old screen, it cannot be
  // closed while a mission waits to be resumed or a finished mission's archive
  // controls are showing (selectWorkspaceHideBlockedReason).
  const setupHideBlockedReason = isSetup
    ? selectWorkspaceHideBlockedReason({ decisionOpen, actionError, phase, governanceMission })
    : null
  // A warning in Mission opens it once and stays on the Mission button until it
  // clears, but never locks the operator out of Tracking (Reconnect) or the map.
  const [panelAttention, setMissionAttention] = useState(false)
  // A refused or failed mission action (for example Finish while history is
  // still loading) counts as a warning until the operator clears it.
  const missionAttention = panelAttention || actionError !== null
  useEffect(() => {
    if (!missionAttention) return
    setSetupCardOpen(true)
    setTemporary('mission')
  }, [missionAttention])
  // Tracking, Layers, GPX and helicopters open before a mission too, as the old
  // sidebar tabs did. Before Start, Mission is the card, never a side panel.
  const visible: BasePanel | TemporaryPanel | null = !running
    ? (temporary === 'mission' ? null : temporary ?? setupPanel)
    : missionForced ? 'mission' : temporary ?? base
  const missionVisible = isSetup ? setupCardOpen || setupHideBlockedReason !== null : visible === 'mission'
  const openMission = useCallback(() => setTemporary('mission'), [])
  const showBase = (panel: BasePanel) => {
    setTemporary(null)
    if (!running) {
      if (panel === 'layers') setSetupPanel(visible === 'layers' ? null : 'layers')
      return
    }
    setBase(visible === panel ? null : panel)
  }
  const closeBase = () => {
    setTemporary(null)
    if (running) setBase(null)
    else setSetupPanel(null)
  }

  const panelButtons = (
    <>
      <button
        aria-pressed={visible === 'people'}
        className="ws-bar-button"
        data-testid="ws-toggle-people"
        disabled={!running}
        onClick={() => showBase('people')}
        // People are the running mission's roster; say why rather than hide the button.
        title={running ? undefined : 'Start or resume a mission to see people'}
        type="button"
      >
        {running ? `People ${people.length}` : 'People'}
        {attentionCount > 0 ? <span className="ws-badge" data-testid="ws-people-attention">{attentionCount} ⚠</span> : null}
      </button>
      <button aria-pressed={visible === 'layers'} className="ws-bar-button" data-testid="ws-toggle-layers" onClick={() => showBase('layers')} type="button">
        Layers
      </button>
      {!running || !panelOpenByDefault(arrangement) ? null : (
        <button
          aria-pressed={visible === null}
          className="ws-bar-button"
          data-testid="ws-full-map"
          onClick={() => { if (visible === null) { setBase('people') } else { closeBase() } }}
          type="button"
        >
          {visible === null ? 'Show panel' : 'Full map'}
        </button>
      )}
    </>
  )

  const top = (
    <>
      <WorkspaceTopBar
        headline={headline}
        missionAttention={missionAttention}
        missionOpen={missionVisible}
        onOpenTracking={() => setTemporary('tracking')}
        onToggleMission={() => {
          if (isSetup) setSetupCardOpen(setupHideBlockedReason !== null || !setupCardOpen)
          else setTemporary(temporary === 'mission' ? null : 'mission')
        }}
        panelButtons={panelButtons}
        weather={input.weather}
      />
      {/* DON-338 REN-6: the history-line warning stays on screen whenever Tracking is closed. */}
      {visible === 'tracking' ? null : <CoverageAttentionIndicator onOpenTracking={() => setTemporary('tracking')} />}
    </>
  )

  const panel = (
    // One stable element, so Mission keeps its entries and decisions while hidden.
    <aside
      className={`ws-side ws-side-${side}`}
      data-empty={visible === null ? 'true' : 'false'}
      data-testid="ws-side"
    >
      {visible === 'people' ? <PeoplePanel onClose={closeBase} onOpenMission={openMission} people={people} /> : null}
      {visible === 'layers' ? (
        <section className="ws-panel-section" data-testid="ws-layers-panel">
          <PanelHead onClose={closeBase} title="Layers">
            <button className="ws-link-button" data-testid="ws-open-tools" onClick={() => setTemporary('tools')} type="button">Add GPX, helicopters</button>
          </PanelHead>
          <LayerFilterPanel variant="simplified" />
        </section>
      ) : null}
      {visible === 'tracking' ? <TrackingDetails focusToken={trackingFocusToken} headline={headline} onClose={() => setTemporary(null)} /> : null}
      {visible === 'tools' ? (
        <section className="ws-panel-section" data-testid="ws-tools-panel">
          <PanelHead onClose={() => setTemporary(null)} title="GPX and helicopters" />
          <div className="ws-panel-scroll space-y-4"><DeferredGpxImportPanel /><HelicopterPanel /></div>
        </section>
      ) : null}
      <div
        className={isSetup ? 'ws-mission-card' : 'ws-panel-section'}
        data-testid="ws-mission-host"
        style={missionVisible ? undefined : { display: 'none' }}
      >
        <button
          className="ws-close ws-mission-close"
          data-testid="ws-mission-close"
          disabled={isSetup ? setupHideBlockedReason !== null : missionForced}
          title={(isSetup ? setupHideBlockedReason : null) ?? undefined}
          onClick={() => { if (isSetup) setSetupCardOpen(false); else setTemporary(null) }}
          type="button"
        >
          Close
        </button>
        <MissionControlPanel
          onActionErrorChange={input.onActionErrorChange}
          onAttentionChange={setMissionAttention}
          onDecisionOpenChange={input.onDecisionOpenChange}
          variant="simplified"
        />
      </div>
    </aside>
  )

  const overMap = running && visible !== 'people'
    ? <ExceptionsOnMap onShowAll={() => showBase('people')} people={people} />
    : null

  // Drawn across the top of the map, never above the side panel, so nothing moves under the pointer.
  const alarm = <TrackingAlarm headline={headline} onOpenTracking={openTrackingAdvice} />

  return { top, alarm, side: panel, overMap, slotSide: side }
}
