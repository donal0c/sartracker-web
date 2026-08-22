import { create } from 'zustand'
import {
  EMPTY_INGEST_EVIDENCE_HEALTH,
  type IngestEvidenceHealth,
} from '../../domain/tracking-ingest-evidence'

import {
  EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  summarizeCurrentPositionRejections,
  type CurrentPositionIngestHealthSummary,
  type CurrentPositionRejection,
} from './ingest-health'

export type IngestHealthStore = {
  readonly summary: CurrentPositionIngestHealthSummary
  readonly evidenceHealth: IngestEvidenceHealth
  readonly applyRejections: (rejections: readonly CurrentPositionRejection[]) => void
  readonly applyEvidenceHealth: (health: IngestEvidenceHealth) => void
}

export const useIngestHealthStore = create<IngestHealthStore>((set) => ({
  summary: EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  evidenceHealth: EMPTY_INGEST_EVIDENCE_HEALTH,
  applyRejections: (rejections) => set({
    summary: summarizeCurrentPositionRejections(rejections),
  }),
  applyEvidenceHealth: (evidenceHealth) => set({ evidenceHealth }),
}))

/**
 * Publishes current-position rejection health outside React render code.
 */
export function applyCurrentPositionRejections(
  rejections: readonly CurrentPositionRejection[],
): void {
  useIngestHealthStore.getState().applyRejections(rejections)
}

/** Publishes persistent ingest-evidence health outside React render code. */
export function applyIngestEvidenceHealth(health: IngestEvidenceHealth): void {
  useIngestHealthStore.getState().applyEvidenceHealth(health)
}
