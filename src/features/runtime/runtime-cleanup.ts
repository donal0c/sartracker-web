/**
 * Attempts every owned cleanup step in order even after a failure. Concurrent
 * callers share one attempt; retries revisit only steps that did not settle.
 */
export function createRuntimeCleanup(
  steps: readonly (() => void | Promise<void>)[],
): () => Promise<void> {
  const completed = new Set<number>()
  let pending: Promise<void> | null = null
  return () => {
    pending ??= attempt().finally(() => { pending = null })
    return pending
  }

  /** Retains all failures while allowing independent resources to be released. */
  async function attempt(): Promise<void> {
    const failures: unknown[] = []
    for (const [index, step] of steps.entries()) {
      if (completed.has(index)) continue
      try {
        const result = step()
        if (result !== undefined) await result
        completed.add(index)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Runtime cleanup remains incomplete; retry shutdown.')
  }
}
