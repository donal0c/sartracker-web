import { useEffect, useMemo, useState } from 'react'

import {
  getBreadcrumbDeviceFeatureNodeId,
  getDeviceFeatureNodeId,
  TRACKING_BREADCRUMBS_LAYER_NODE_ID,
  TRACKING_DEVICES_LAYER_NODE_ID,
} from '../../features/layers/layer-catalog-ids'
import { useLayerCatalogStore } from '../../features/layers/layer-catalog-store'
import { findCatalogNode } from '../../features/layers/layer-catalog-tree'
import { getLayerVisibilityCheckboxState } from '../../features/layers/layer-panel-model'
import { setLayerSubtreeVisibility } from '../../features/layers/layer-subtree-visibility'
import { useLayerVisibilityStore } from '../../features/layers/layer-visibility-store'
import { buildPeopleRows, type PersonRow } from '../../features/layout-trial/people-model'
import { useMapTargetStore } from '../../features/map/map-target-store'
import { useMissionStore } from '../../features/mission/mission-store'
import { buildDeviceWorkspaceRows } from '../../features/tracking/device-workspace-model'
import { useDeviceWorkspaceStore } from '../../features/tracking/device-workspace-store'
import { useIngestHealthStore } from '../../features/tracking/ingest-health-store'
import { useStationaryAttentionStore } from '../../features/tracking/stationary-attention-store'
import { createDeviceColor } from '../../features/tracking/tracking-color'
import { useTrackingStore } from '../../features/tracking/tracking-store'
import { useTrackingStyleStore } from '../../features/tracking/tracking-style-store'

import { TrialPanelHead } from './trial-chrome'

const SEARCH_THRESHOLD = 8

/** Builds the live people list once, for the panel and for its count on the buttons. */
export function usePeopleRows(): readonly PersonRow[] {
  const snapshot = useTrackingStore((state) => state.snapshot)
  const mode = useTrackingStore((state) => state.status.mode)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const ingestHealth = useIngestHealthStore((state) => state.summary)
  const attentionByDevice = useStationaryAttentionStore((state) => state.byDevice)
  const phase = useMissionStore((state) => state.phase)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // "3 min ago" has to keep moving even when no new position arrives.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 20_000)
    return () => window.clearInterval(timer)
  }, [])

  return useMemo(() => buildPeopleRows(
    buildDeviceWorkspaceRows(snapshot, hiddenDeviceIds, ingestHealth, attentionByDevice, mode),
    nowMs,
    mode === 'online' && phase === 'active',
  ), [attentionByDevice, hiddenDeviceIds, ingestHealth, mode, nowMs, phase, snapshot])
}

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

  const setVisible = (nodeId: string, visible: boolean) => {
    void setLayerSubtreeVisibility({ root, controller, nodeId, visible })
  }
  const allState = (nodeId: string) => {
    const node = findCatalogNode(root, nodeId)
    return node === null ? { checked: true, mixed: false } : getLayerVisibilityCheckboxState(node)
  }
  const allPositions = allState(TRACKING_DEVICES_LAYER_NODE_ID)
  const allTrails = allState(TRACKING_BREADCRUMBS_LAYER_NODE_ID)

  return (
    <section className="trial-panel-section" data-testid="trial-people-panel">
      <TrialPanelHead onClose={props.onClose} title={<>People <span className="trial-count" data-testid="trial-people-count">{props.people.length}</span></>}>
        <button className="trial-link-button" data-testid="open-devices-workspace" onClick={() => openDevices()} type="button">
          All devices
        </button>
      </TrialPanelHead>

      <div className="trial-people-grid trial-people-all" data-testid="trial-people-all">
        <span>Everyone</span>
        <span className="trial-tick-column">
          <label>
            <input
              aria-checked={allPositions.mixed ? 'mixed' : allPositions.checked}
              checked={allPositions.checked}
              data-testid="trial-all-positions"
              onChange={(event) => setVisible(TRACKING_DEVICES_LAYER_NODE_ID, event.target.checked)}
              ref={(input) => { if (input !== null) input.indeterminate = allPositions.mixed }}
              type="checkbox"
            />
            <span>Location</span>
          </label>
        </span>
        <span className="trial-tick-column">
          <label>
            <input
              aria-checked={allTrails.mixed ? 'mixed' : allTrails.checked}
              checked={allTrails.checked}
              data-testid="trial-all-trails"
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
          className="sar-input trial-people-search"
          data-testid="trial-people-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a person"
          type="search"
          value={query}
        />
      ) : null}

      <ul className="trial-people-list min-h-0 flex-1 overflow-y-auto" data-testid="trial-people-list">
        {props.people.length === 0 ? (
          <li className="trial-empty">
            {hasMission ? (
              <>
                <p>Nobody on this mission yet.</p>
                <button className="sar-button mt-2 px-3 py-2 text-sm font-bold" onClick={props.onOpenMission} type="button">Add people</button>
              </>
            ) : <p>Start a mission to see your team here.</p>}
          </li>
        ) : shown.length === 0 ? (
          <li className="trial-empty"><p>Nobody called {query.trim()}.</p></li>
        ) : shown.map((person) => (
          <li className={`trial-person trial-person-${person.tone}`} data-testid={`trial-person-${person.deviceId}`} key={person.deviceId}>
            <div className="trial-people-grid">
              <button
                aria-label={person.canZoom ? `Go to ${person.name} on the map` : `${person.name} has no position yet`}
                className="trial-person-main"
                data-testid={`trial-person-zoom-${person.deviceId}`}
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
                  className="trial-swatch"
                  style={{ backgroundColor: deviceColors[person.deviceId] ?? createDeviceColor(person.deviceId) }}
                />
                <span className="min-w-0">
                  <span className="trial-person-name">{person.name}</span>
                  <span className="trial-person-status" data-testid={`trial-person-status-${person.deviceId}`}>{person.statusText}</span>
                </span>
              </button>
              <span className="trial-tick-column">
                <input
                  aria-label={`Show ${person.name}'s current location`}
                  checked={!person.positionHidden}
                  data-testid={`trial-position-${person.deviceId}`}
                  onChange={(event) => setVisible(getDeviceFeatureNodeId(person.deviceId), event.target.checked)}
                  type="checkbox"
                />
              </span>
              <span className="trial-tick-column">
                <input
                  aria-label={`Show ${person.name}'s breadcrumb trail`}
                  checked={!hiddenBreadcrumbs.includes(person.deviceId)}
                  data-testid={`trial-trail-${person.deviceId}`}
                  onChange={(event) => setVisible(getBreadcrumbDeviceFeatureNodeId(person.deviceId), event.target.checked)}
                  type="checkbox"
                />
              </span>
            </div>
            {person.canAcknowledge ? (
              <button
                className="trial-ack"
                data-testid={`trial-acknowledge-${person.deviceId}`}
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
