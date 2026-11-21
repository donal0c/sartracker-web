import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { countPeopleNeedingAttention } from '../../features/workspace/people-model'
import { panelOpenByDefault, panelSide, type PanelArrangement } from '../../features/workspace/panel-arrangement'
import { useTrackingHeadline } from '../../features/workspace/tracking-headline'
import { useMissionStore } from '../../features/mission/mission-store'
import { CoverageAttentionIndicator } from '../coverage-attention-indicator'
import { DeferredGpxImportPanel } from '../deferred-gpx-import-panel'
import { HelicopterPanel } from '../helicopter-panel'
import { LayerFilterPanel } from '../layer-filter-panel'
import { MissionControlPanel } from '../mission-control-panel'
import { usePeopleRows } from '../../features/workspace/use-people-rows'
import { ExceptionsOnMap } from './exceptions-on-map'
import { PeoplePanel } from './people-panel'
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
}): { readonly top: ReactNode; readonly side: ReactNode; readonly overMap: ReactNode; readonly slotSide: 'left' | 'right' } {
  const { arrangement, decisionOpen, actionError } = input
  const side = panelSide(arrangement)
  const phase = useMissionStore((state) => state.phase)
  const headline = useTrackingHeadline()
  const people = usePeopleRows()
  const attentionCount = countPeopleNeedingAttention(people)

  const defaultBase = useCallback((): BasePanel | null => (panelOpenByDefault(arrangement) ? 'people' : null), [arrangement])
  const [base, setBase] = useState<BasePanel | null>(defaultBase)
  const [temporary, setTemporary] = useState<TemporaryPanel | null>(null)
  useEffect(() => { setBase(defaultBase()) }, [defaultBase])

  const running = phase === 'active' || phase === 'paused'
  const isSetup = phase === 'idle' || phase === 'recovery'
  const [setupCardOpen, setSetupCardOpen] = useState(true)
  useEffect(() => {
    setTemporary(null)
    setSetupCardOpen(true)
  }, [phase])

  // A decision or failed action always forces Mission back into view.
  const missionForced = decisionOpen || actionError !== null
  // A warning in Mission opens it once and stays on the Mission button until it
  // clears, but never locks the operator out of Tracking (Reconnect) or the map.
  const [missionAttention, setMissionAttention] = useState(false)
  useEffect(() => {
    if (!missionAttention) return
    setSetupCardOpen(true)
    setTemporary('mission')
  }, [missionAttention])
  // Tracking opens before a mission too: troubleshooting must not need a mission first.
  const visible: BasePanel | TemporaryPanel | null = !running
    ? (temporary === 'tracking' ? 'tracking' : null)
    : missionForced ? 'mission' : temporary ?? base
  const missionVisible = isSetup ? setupCardOpen || missionForced : visible === 'mission'
  const openMission = useCallback(() => setTemporary('mission'), [])
  const showBase = (panel: BasePanel) => {
    setTemporary(null)
    setBase(visible === panel ? null : panel)
  }
  const closeBase = () => { setTemporary(null); setBase(null) }

  const panelButtons = !running ? null : (
    <>
      <button aria-pressed={visible === 'people'} className="ws-bar-button" data-testid="ws-toggle-people" onClick={() => showBase('people')} type="button">
        People {people.length}
        {attentionCount > 0 ? <span className="ws-badge" data-testid="ws-people-attention">{attentionCount} ⚠</span> : null}
      </button>
      <button aria-pressed={visible === 'layers'} className="ws-bar-button" data-testid="ws-toggle-layers" onClick={() => showBase('layers')} type="button">
        Layers
      </button>
      {!panelOpenByDefault(arrangement) ? null : (
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
          if (isSetup) setSetupCardOpen(!setupCardOpen)
          else setTemporary(temporary === 'mission' ? null : 'mission')
        }}
        panelButtons={panelButtons}
        weather={input.weather}
      />
      <TrackingAlarm headline={headline} onOpenTracking={() => setTemporary('tracking')} />
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
      {visible === 'tracking' ? <TrackingDetails headline={headline} onClose={() => setTemporary(null)} /> : null}
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
          disabled={missionForced}
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

  return { top, side: panel, overMap, slotSide: side }
}
