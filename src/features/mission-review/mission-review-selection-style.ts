/**
 * Returns row chrome for selected mission-review entries.
 */
export function getMissionReviewSelectionClassName(selected: boolean): string {
  return selected ? 'sar-selected-row' : ''
}
