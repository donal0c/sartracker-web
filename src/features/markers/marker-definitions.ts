import type { MarkerType } from '../../infrastructure/mission-store/tauri-mission-store'

export type MarkerVisualSpec = {
  readonly iconId: string
  readonly labelColor: string
}

export const SUBJECT_CATEGORIES = [
  'Child (1-3 years)',
  'Child (4-6 years)',
  'Child (7-12 years)',
  'Hiker',
  'Hunter',
  'Elderly',
  'Dementia Patient',
  'Despondent',
  'Autistic',
  'Other',
] as const

export const CLUE_TYPES = [
  'Footprint',
  'Clothing',
  'Equipment',
  'Witness Sighting',
  'Physical Evidence',
  'Other',
] as const

export const CONFIDENCE_LEVELS = ['Confirmed', 'Probable', 'Possible'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

const CONFIDENCE_LEVEL_TO_SCORE: Record<ConfidenceLevel, number> = {
  Confirmed: 0.9,
  Probable: 0.8,
  Possible: 0.5,
}

export const HAZARD_TYPES = [
  'Cliff/Drop-off',
  'Water Hazard',
  'Bog/Peatland',
  'Dense Vegetation',
  'Wildlife Danger',
  'Weather Exposure',
  'Other',
] as const

export const HAZARD_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const

export const CASUALTY_CONDITIONS = [
  'Injured - Conscious',
  'Injured - Unconscious',
  'Deceased',
  'Unresponsive',
  'Medical Emergency',
  'Unknown',
] as const

export const EVACUATION_PRIORITIES = ['Immediate', 'Urgent', 'Delayed', 'None Required'] as const

export const MARKER_VISUAL_SPECS: Record<MarkerType, MarkerVisualSpec> = {
  ipp_lkp: {
    iconId: 'marker-ipp_lkp',
    labelColor: '#0066FF',
  },
  clue: {
    iconId: 'marker-clue',
    labelColor: '#806600',
  },
  hazard: {
    iconId: 'marker-hazard',
    labelColor: '#8B0000',
  },
  casualty: {
    iconId: 'marker-casualty',
    labelColor: '#8B0000',
  },
}

export function getMarkerVisualSpec(type: MarkerType): MarkerVisualSpec {
  return MARKER_VISUAL_SPECS[type]
}

export function toConfidenceScore(level: ConfidenceLevel): number {
  return CONFIDENCE_LEVEL_TO_SCORE[level]
}

export function toConfidenceLevel(score: number | null): ConfidenceLevel | '' {
  if (score === null) {
    return ''
  }

  if (score >= 0.85) {
    return 'Confirmed'
  }

  if (score >= 0.65) {
    return 'Probable'
  }

  return 'Possible'
}
