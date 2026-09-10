/** Restricts saved mission history only by its own participant selection. */
export function resolveMissionHistoryOmissions(deviceIds: readonly string[], historyOmissions: readonly string[]): readonly string[] {
  const omitted = new Set(historyOmissions)
  return deviceIds.filter((id) => omitted.has(id))
}
