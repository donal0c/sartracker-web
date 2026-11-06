import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { countPeopleNeedingAttention, selectExceptionsForMap, type PersonRow } from '../../features/layout-trial/people-model'
import type { LayoutTrialVersion } from '../../features/layout-trial/layout-trial-store'
import { useTrackingHeadline } from '../../features/layout-trial/use-tracking-issues'
import { useMapTargetStore } from '../../features/map/map-target-store'
import { useMissionStore } from '../../features/mission/mission-store'
import { DeferredGpxImportPanel } from '../deferred-gpx-import-panel'
import { HelicopterPanel } from '../helicopter-panel'
import { LayerFilterPanel } from '../layer-filter-panel'
import { MissionControlPanel } from '../mission-control-panel'
import { PeoplePanel, usePeopleRows } from './people-panel'
import { TrackingDetails, TrialAlarm, TrialPanelHead, TrialTopBar } from './trial-chrome'

type BasePanel = 'people' | 'layers'
type TemporaryPanel = 'mission' | 'tracking' | 'tools'

const MAX_EXCEPTIONS_ON_MAP = 3

/**
 * Builds the shared top bar, alarm and the single side slot for one version.
 * Only one panel shows at a time; the versions differ in where the slot sits
 * and in whether it is open by default.
 */
export function useTrialChrome(input: {
  readonly version: LayoutTrialVersion
  readonly weather: ReactNode
  readonly onActionErrorChange: (error: string | null) => void
  readonly onDecisionOpenChange: (open: boolean) => void
  readonly decisionOpen: boolean
  readonly actionError: string | null
}): { readonly top: ReactNode; readonly side: ReactNode; readonly overMap: ReactNode; readonly slotSide: 'left' | 'right' } {
  const { version, decisionOpen, actionError } = input
  const phase = useMissionStore((state) => state.phase)
  const headline = useTrackingHeadline()
  const people = usePeopleRows()
  const attentionCount = countPeopleNeedingAttention(people)

  const defaultBase = useCallback((): BasePanel | null => (version === 'c' ? null : 'people'), [version])
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

  // A decision or failure always forces Mission back into view.
  const missionForced = decisionOpen || actionError !== null
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
      <button aria-pressed={visible === 'people'} className="trial-bar-button" data-testid="trial-toggle-people" onClick={() => showBase('people')} type="button">
        People {people.length}
        {attentionCount > 0 ? <span className="trial-badge" data-testid="trial-people-attention">{attentionCount} ⚠</span> : null}
      </button>
      <button aria-pressed={visible === 'layers'} className="trial-bar-button" data-testid="trial-toggle-layers" onClick={() => showBase('layers')} type="button">
        Layers
      </button>
      {version === 'c' ? null : (
        <button
          aria-pressed={visible === null}
          className="trial-bar-button"
          data-testid="trial-full-map"
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
      <TrialTopBar
        headline={headline}
        missionOpen={missionVisible}
        onOpenTracking={() => setTemporary('tracking')}
        onToggleMission={() => {
          if (isSetup) setSetupCardOpen(!setupCardOpen)
          else setTemporary(temporary === 'mission' ? null : 'mission')
        }}
        panelButtons={panelButtons}
        weather={input.weather}
      />
      <TrialAlarm headline={headline} onOpenTracking={() => setTemporary('tracking')} />
    </>
  )

  const side = (
    // One stable element, so Mission keeps its entries and decisions while hidden.
    <aside
      className={`trial-side trial-side-${version === 'b' ? 'left' : 'right'}`}
      data-empty={visible === null ? 'true' : 'false'}
      data-testid="trial-side"
    >
      {visible === 'people' ? <PeoplePanel onClose={closeBase} onOpenMission={openMission} people={people} /> : null}
      {visible === 'layers' ? (
        <section className="trial-panel-section" data-testid="trial-layers-panel">
          <TrialPanelHead onClose={closeBase} title="Layers">
            <button className="trial-link-button" data-testid="trial-open-tools" onClick={() => setTemporary('tools')} type="button">Add GPX, helicopters</button>
          </TrialPanelHead>
          <LayerFilterPanel variant="trial" />
        </section>
      ) : null}
      {visible === 'tracking' ? <TrackingDetails headline={headline} onClose={() => setTemporary(null)} /> : null}
      {visible === 'tools' ? (
        <section className="trial-panel-section" data-testid="trial-tools-panel">
          <TrialPanelHead onClose={() => setTemporary(null)} title="GPX and helicopters" />
          <div className="trial-panel-scroll space-y-4"><DeferredGpxImportPanel /><HelicopterPanel /></div>
        </section>
      ) : null}
      <div
        className={isSetup ? 'trial-mission-card' : 'trial-panel-section'}
        data-testid="trial-mission-host"
        style={missionVisible ? undefined : { display: 'none' }}
      >
        <button
          className="trial-close trial-mission-close"
          data-testid="trial-mission-close"
          disabled={missionForced}
          onClick={() => { if (isSetup) setSetupCardOpen(false); else setTemporary(null) }}
          type="button"
        >
          Close
        </button>
        <MissionControlPanel
          onActionErrorChange={input.onActionErrorChange}
          onDecisionOpenChange={input.onDecisionOpenChange}
          variant="trial"
        />
      </div>
    </aside>
  )

  const overMap = running && visible !== 'people'
    ? <ExceptionsOnMap onShowAll={() => showBase('people')} people={people} />
    : null

  return { top, side, overMap, slotSide: version === 'b' ? 'left' : 'right' }
}

/** With People closed, whoever needs a look is still named on the map, in words. */
function ExceptionsOnMap(props: { readonly people: readonly PersonRow[]; readonly onShowAll: () => void }) {
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const exceptions = selectExceptionsForMap(props.people)
  if (exceptions.length === 0) return null
  const extra = exceptions.length - MAX_EXCEPTIONS_ON_MAP
  return (
    <div className="trial-exceptions" data-map-interaction-boundary="true" data-testid="trial-exceptions">
      {exceptions.slice(0, MAX_EXCEPTIONS_ON_MAP).map((person) => (
        <button
          data-testid={`trial-exception-${person.deviceId}`}
          disabled={person.latitude === null || person.longitude === null}
          key={person.deviceId}
          onClick={() => { if (person.latitude !== null && person.longitude !== null) queueTarget(person.latitude, person.longitude, person.name) }}
          title="Go to this person on the map"
          type="button"
        >
          <strong>⚠ {person.name}</strong> {person.statusText}
        </button>
      ))}
      {extra > 0 ? <button data-testid="trial-exceptions-more" onClick={props.onShowAll} type="button"><strong>+{extra} more</strong></button> : null}
    </div>
  )
}
