import { create } from 'zustand'

import {
  EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  summarizeCurrentPositionRejections,
  type CurrentPositionIngestHealthSummary,
  type CurrentPositionRejection,
} from './ingest-health'

export type IngestHealthStore = {
  readonly summary: CurrentPositionIngestHealthSummary
  readonly applyRejections: (rejections: readonly CurrentPositionRejection[]) => void
}

export const useIngestHealthStore = create<IngestHealthStore>((set) => ({
  summary: EMPTY_CURRENT_POSITION_INGEST_HEALTH,
  applyRejections: (rejections) => set({
    summary: summarizeCurrentPositionRejections(rejections),
  }),
}))

/**
 * Publishes current-position rejection health outside React render code.
 */
export function applyCurrentPositionRejections(
  rejections: readonly CurrentPositionRejection[],
): void {
  useIngestHealthStore.getState().applyRejections(rejections)
}
