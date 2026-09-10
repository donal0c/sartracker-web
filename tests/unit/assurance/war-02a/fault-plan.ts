export type FaultCode = 'EIO' | 'ENOSPC' | 'INTERRUPTED'
export type FaultSpec = {
  operation: string
  boundary: 'before' | 'after'
  occurrence: number
  code: FaultCode
}
export type FaultEntry = { operation: string; occurrence: number; phase: 'before' | 'after' | 'fault' }

/** Injects one named boundary failure without swallowing the real operation's errors. */
export class FaultPlan {
  private readonly counts = new Map<string, number>()
  private readonly entries: FaultEntry[] = []
  private hits = 0
  private readonly spec: FaultSpec | undefined

  /** Copies and validates the plan so the target cannot drift during execution. */
  constructor(spec?: FaultSpec) {
    if (spec && (!spec.operation.trim() || !Number.isSafeInteger(spec.occurrence) || spec.occurrence < 1)) {
      throw new Error('Invalid fault target')
    }
    this.spec = spec ? { ...spec } : undefined
  }

  /** Returns an immutable-by-copy trace for exact replay assertions. */
  get trace(): FaultEntry[] { return this.entries.map((entry) => ({ ...entry })) }

  /** Runs a real operation unless its before boundary is the selected failure. */
  async run<T>(operation: string, action: () => Promise<T>): Promise<T> {
    const occurrence = (this.counts.get(operation) ?? 0) + 1
    this.counts.set(operation, occurrence)
    this.boundary(operation, occurrence, 'before')
    const result = await action()
    this.boundary(operation, occurrence, 'after')
    return result
  }

  /** Requires evidence that an armed fault actually exercised its target. */
  assertTriggered(): void {
    if (this.spec && this.hits !== 1) throw new Error(`Fault not triggered: ${this.spec.operation}`)
  }

  /** Records attempt/completion before injecting a typed, single-use failure. */
  private boundary(operation: string, occurrence: number, phase: 'before' | 'after'): void {
    this.entries.push({ operation, occurrence, phase })
    if (this.spec?.operation !== operation || this.spec.occurrence !== occurrence || this.spec.boundary !== phase) return
    this.hits++
    this.entries.push({ operation, occurrence, phase: 'fault' })
    throw Object.assign(new Error(`Injected ${this.spec.code} ${phase} ${operation} #${occurrence}`), {
      code: this.spec.code,
      name: this.spec.code === 'INTERRUPTED' ? 'InjectedInterruption' : 'Error',
    })
  }
}
