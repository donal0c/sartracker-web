import { useEffect, useMemo, useState } from 'react'

import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import { useMissionStore } from '../mission/mission-store'
import { buildDeviceWorkspaceRows } from '../tracking/device-workspace-model'
import { useIngestHealthStore } from '../tracking/ingest-health-store'
import { useStationaryAttentionStore } from '../tracking/stationary-attention-store'
import { useTrackingStore } from '../tracking/tracking-store'
import { buildPeopleRows, type PersonRow } from './people-model'
import { useLastConfirmedAt } from './tracking-headline'

/** Builds the live people list once, for the panel and for its count on the buttons. */
export function usePeopleRows(): readonly PersonRow[] {
  const snapshot = useTrackingStore((state) => state.snapshot)
  const mode = useTrackingStore((state) => state.status.mode)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const ingestHealth = useIngestHealthStore((state) => state.summary)
  const attentionByDevice = useStationaryAttentionStore((state) => state.byDevice)
  const phase = useMissionStore((state) => state.phase)
  const lastConfirmedAt = useLastConfirmedAt()
  const [nowMs, setNowMs] = useState(() => Date.now())

  // "3 min ago" has to keep moving even when no new position arrives.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 20_000)
    return () => window.clearInterval(timer)
  }, [])

  return useMemo(() => buildPeopleRows(
    buildDeviceWorkspaceRows(snapshot, hiddenDeviceIds, ingestHealth, attentionByDevice, mode),
    nowMs,
    { live: mode === 'online' && phase === 'active', lastConfirmedAt },
  ), [attentionByDevice, hiddenDeviceIds, ingestHealth, lastConfirmedAt, mode, nowMs, phase, snapshot])
}
