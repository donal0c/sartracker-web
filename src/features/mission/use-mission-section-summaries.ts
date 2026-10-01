import { useMemo } from 'react'

import { useOutingControlsViewModel } from '../outings/use-outing-controls-view-model'
import { useParticipantStore } from '../participants/participant-store'
import {
  describeOutingSection,
  describeParticipantSection,
  type MissionSectionSummary,
} from './mission-section-summary'

/** Reads the participant store into the collapsed Participants summary. */
export function useParticipantSectionSummary(): MissionSectionSummary {
  const participants = useParticipantStore((state) => state.participants)
  const membershipNotices = useParticipantStore((state) => state.membershipNotices)
  const envelopeWarning = useParticipantStore((state) => state.envelope.warning)
  const rosterError = useParticipantStore((state) => state.rosterError)
  const error = useParticipantStore((state) => state.error)
  return useMemo(() => describeParticipantSection({
    participants, membershipNotices, envelopeWarning, rosterError, error,
  }), [participants, membershipNotices, envelopeWarning, rosterError, error])
}

/** Reads the outing view model into the collapsed Outings summary. */
export function useOutingSectionSummary(): MissionSectionSummary & { readonly enabled: boolean } {
  const model = useOutingControlsViewModel()
  const activeOutingLabel = model.activeOuting?.label ?? null
  return useMemo(() => ({
    ...describeOutingSection({ activeOutingLabel, error: model.error, loading: model.loading }),
    enabled: model.enabled,
  }), [activeOutingLabel, model.error, model.loading, model.enabled])
}
