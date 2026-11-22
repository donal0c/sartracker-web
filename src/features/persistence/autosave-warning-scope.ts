/** Keeps stale autosave warnings mission-scoped while preserving failure visibility. */
export function scopeAutosaveWarningToMission(
  warning: string | null,
  currentMission: unknown,
): string | null {
  if (warning === null) {
    return null
  }

  if (warning.startsWith('Autosave failing')) {
    return warning
  }

  return currentMission === null ? null : warning
}
