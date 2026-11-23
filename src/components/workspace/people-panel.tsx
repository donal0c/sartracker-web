import { useMemo, useState } from 'react'

import {
  getBreadcrumbDeviceFeatureNodeId,
  getDeviceFeatureNodeId,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
} from '../../features/layers/layer-catalog-ids'
import { useLayerCatalogStore } from '../../features/layers/layer-catalog-store'
import { findCatalogNode } from '../../features/layers/layer-catalog-tree'
import { getLayerVisibilityCheckboxState } from '../../features/layers/layer-panel-model'
import { queueLayerSubtreeVisibility, StaleLayerVisibilityChangeError } from '../../features/layers/layer-subtree-visibility'
import { useLayerVisibilityStore } from '../../features/layers/layer-visibility-store'
import type { PersonRow } from '../../features/workspace/people-model'
import { useMapTargetStore } from '../../features/map/map-target-store'
import { useMissionStore } from '../../features/mission/mission-store'
import { useDeviceWorkspaceStore } from '../../features/tracking/device-workspace-store'
import { useStationaryAttentionStore } from '../../features/tracking/stationary-attention-store'
import { createDeviceColor } from '../../features/tracking/tracking-color'
import { useTrackingStyleStore } from '../../features/tracking/tracking-style-store'

import { PanelHead } from './workspace-chrome'

const SEARCH_THRESHOLD = 8

/**
 * The team's own idea of the panel: each active person by name, with their
 * current location and breadcrumbs separately switchable (Seán, Jan 2026;
 * Install Tests item 20; Sar_4 item 6).
 */
export function PeoplePanel(props: { readonly people: readonly PersonRow[]; readonly onOpenMission: () => void; readonly onClose: () => void }) {
  const root = useLayerCatalogStore((state) => state.root)
  const controller = useLayerCatalogStore((state) => state.controller)
  const hiddenBreadcrumbs = useLayerVisibilityStore((state) => state.hiddenBreadcrumbDeviceIds)
  const deviceColors = useTrackingStyleStore((state) => state.deviceColors)
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const acknowledge = useStationaryAttentionStore((state) => state.acknowledge)
  const openDevices = useDeviceWorkspaceStore((state) => state.openWorkspace)
  const hasMission = useMissionStore((state) => state.currentMission !== null)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle === '' ? props.people : props.people.filter((person) => person.name.toLowerCase().includes(needle))
  }, [props.people, query])

  const [visibilityError, setVisibilityError] = useState<string | null>(null)
  const setVisible = (nodeId: string, visible: boolean) => {
    // Tracking is not listed in Layers here, so switching on must also undo a hidden Tracking group.
    // Changes are saved one at a time against the catalog as last saved; a failed
    // save puts the ticks back to what was saved and says so here. The queue
    // finishes changes in order, so the alert always reflects the latest one.
    queueLayerSubtreeVisibility({
      readMissionId: () => useMissionStore.getState().currentMission?.id ?? null,
      readRoot: () => useLayerCatalogStore.getState().root,
      controller,
      nodeId,
      visible,
      revealAncestors: true,
    }).then(() => setVisibilityError(null), (error: unknown) => {
      // A change made in a mission that has since closed was not applied; nothing to fix here.
      if (error instanceof StaleLayerVisibilityChangeError) return
      const reason = error instanceof Error ? error.message : 'unknown error'
      setVisibilityError(`Who is shown on the map could not be saved (${reason}). The ticks show what was saved. Try again; if it keeps failing, open More, then Diagnostics.`)
    })
  }
  const allState = (nodeId: string) => {
    const node = findCatalogNode(root, nodeId)
    return node === null ? { checked: true, mixed: false } : getLayerVisibilityCheckboxState(node)
  }
  const allPositions = allState(TRACKING_DEVICES_LAYER_NODE_ID)
  const allTrails = allState(TRACKING_BREADCRUMBS_LAYER_NODE_ID)

  return (
    <section className="ws-panel-section" data-testid="ws-people-panel">
      <PanelHead onClose={props.onClose} title={<>People <span className="ws-count" data-testid="ws-people-count">{props.people.length}</span></>}>
        <button className="ws-link-button" data-testid="open-devices-workspace" onClick={() => openDevices()} type="button">
          All devices
        </button>
      </PanelHead>
      {visibilityError === null ? null : (
        <p className="sar-inline-alert mx-3 my-2 p-2 text-[13px] text-amber-100" data-testid="ws-people-visibility-error" role="alert">
          {visibilityError}
        </p>
      )}

      <div className="ws-people-grid ws-people-all" data-testid="ws-people-all">
        <span>Everyone</span>
        <span className="ws-tick-column">
          <label>
            <input
              aria-checked={allPositions.mixed ? 'mixed' : allPositions.checked}
              checked={allPositions.checked}
              data-testid="ws-all-positions"
              onChange={(event) => setVisible(TRACKING_DEVICES_LAYER_NODE_ID, event.target.checked)}
              ref={(input) => { if (input !== null) input.indeterminate = allPositions.mixed }}
              type="checkbox"
            />
            <span>Location</span>
          </label>
        </span>
        <span className="ws-tick-column">
          <label>
            <input
              aria-checked={allTrails.mixed ? 'mixed' : allTrails.checked}
              checked={allTrails.checked}
              data-testid="ws-all-trails"
              onChange={(event) => setVisible(TRACKING_BREADCRUMBS_LAYER_NODE_ID, event.target.checked)}
              ref={(input) => { if (input !== null) input.indeterminate = allTrails.mixed }}
              type="checkbox"
            />
            <span>Trail</span>
          </label>
        </span>
      </div>

      {props.people.length > SEARCH_THRESHOLD ? (
        <input
          aria-label="Find a person"
          className="sar-input ws-people-search"
          data-testid="ws-people-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a person"
          type="search"
          value={query}
        />
      ) : null}

      <ul className="ws-people-list min-h-0 flex-1 overflow-y-auto" data-testid="ws-people-list">
        {props.people.length === 0 ? (
          <li className="ws-empty">
            {hasMission ? (
              <>
                <p>Nobody on this mission yet.</p>
                <button className="sar-button mt-2 px-3 py-2 text-sm font-bold" onClick={props.onOpenMission} type="button">Add people</button>
              </>
            ) : <p>Start a mission to see your team here.</p>}
          </li>
        ) : shown.length === 0 ? (
          <li className="ws-empty"><p>Nobody called {query.trim()}.</p></li>
        ) : shown.map((person) => (
          <li className={`ws-person ws-person-${person.tone}`} data-testid={`ws-person-${person.deviceId}`} key={person.deviceId}>
            <div className="ws-people-grid">
              <button
                aria-label={person.canZoom ? `Go to ${person.name} on the map` : `${person.name} has no position yet`}
                className="ws-person-main"
                data-testid={`ws-person-zoom-${person.deviceId}`}
                disabled={!person.canZoom}
                onClick={() => {
                  if (person.latitude !== null && person.longitude !== null) {
                    queueTarget(person.latitude, person.longitude, person.name)
                  }
                }}
                title={person.canZoom ? 'Go to this person on the map' : undefined}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="ws-swatch"
                  style={{ backgroundColor: deviceColors[person.deviceId] ?? createDeviceColor(person.deviceId) }}
                />
                <span className="min-w-0">
                  <span className="ws-person-name">{person.name}</span>
                  <span className="ws-person-status" data-testid={`ws-person-status-${person.deviceId}`}>{person.statusText}</span>
                </span>
              </button>
              <span className="ws-tick-column">
                <input
                  aria-label={`Show ${person.name}'s current location`}
                  checked={!person.positionHidden}
                  data-testid={`ws-position-${person.deviceId}`}
                  onChange={(event) => setVisible(getDeviceFeatureNodeId(person.deviceId), event.target.checked)}
                  type="checkbox"
                />
              </span>
              <span className="ws-tick-column">
                <input
                  aria-label={`Show ${person.name}'s breadcrumb trail`}
                  checked={!hiddenBreadcrumbs.includes(person.deviceId)}
                  data-testid={`ws-trail-${person.deviceId}`}
                  onChange={(event) => setVisible(getBreadcrumbDeviceFeatureNodeId(person.deviceId), event.target.checked)}
                  type="checkbox"
                />
              </span>
            </div>
            {person.canAcknowledge ? (
              <button
                className="ws-ack"
                data-testid={`ws-acknowledge-${person.deviceId}`}
                onClick={() => acknowledge(person.deviceId)}
                type="button"
              >
                Noted, I&apos;m on it
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
