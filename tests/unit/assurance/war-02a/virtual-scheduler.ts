type Task = { id: number; at: number; label: string; run: () => void }
export type ScheduleEntry = { at: number; id: number; label: string; phase: 'scheduled' | 'cancelled' | 'ran' }

/** Explicit event ordering; native work and Promise continuations are deliberately external. */
export class VirtualScheduler {
  private time = 0
  private sequence = 0
  private readonly pending = new Map<number, Task>()
  private readonly entries: ScheduleEntry[] = []
  private readonly budget: number
  private advancing = false

  /** Sets a finite per-advance task budget so zero-delay loops fail visibly. */
  constructor(budget = 1000) {
    assertInteger(budget, 'budget')
    if (budget === 0) throw new Error('Scheduler budget must be positive')
    this.budget = budget
  }

  /** Returns virtual monotonic milliseconds. */
  now = (): number => this.time

  /** Returns a copy so an oracle cannot mutate recorded scheduling evidence. */
  get trace(): ScheduleEntry[] { return this.entries.map((entry) => ({ ...entry })) }

  /** Schedules synchronous dispatch; async operations must be joined at explicit gates. */
  schedule(label: string, delay: number, run: () => void): number {
    assertInteger(delay, 'delay')
    assertInteger(this.time + delay, 'deadline')
    if (!label.trim()) throw new Error('Task needs a label')
    const id = ++this.sequence
    const task = { id, at: this.time + delay, label, run }
    this.pending.set(id, task)
    this.entries.push({ at: task.at, id, label, phase: 'scheduled' })
    return id
  }

  /** Adapts the production timer dependency without changing global timers. */
  setTimeout = (run: () => void, delay: number): number => this.schedule('timer', delay, run)

  /** Cancels only the named pending timer; repeated cancellation is harmless. */
  clearTimeout = (id: unknown): void => {
    if (typeof id !== 'number') return
    const task = this.pending.get(id)
    if (!task) return
    this.pending.delete(id)
    this.entries.push({ at: this.time, id, label: task.label, phase: 'cancelled' })
  }

  /** Executes due events by deadline then insertion order, including nested events. */
  advanceTo(target: number): void {
    if (this.advancing) throw new Error('Cannot perform reentrant scheduler advancement')
    assertInteger(target, 'target')
    if (target < this.time) throw new Error('Cannot move virtual time backward')
    this.advancing = true
    try { this.runUntil(target) } finally { this.advancing = false }
  }

  /** Runs one non-reentrant advancement, preserving the failure event's timestamp. */
  private runUntil(target: number): void {
    let count = 0
    for (;;) {
      const task = [...this.pending.values()]
        .filter((entry) => entry.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!task) break
      if (++count > this.budget) throw new Error('Virtual scheduler task budget exhausted')
      this.time = task.at
      this.pending.delete(task.id)
      this.entries.push({ at: this.time, id: task.id, label: task.label, phase: 'ran' })
      const result: unknown = task.run()
      if (result !== undefined) {
        // The synchronous contract error is authoritative; avoid a second unhandled rejection.
        void Promise.resolve(result).catch(() => undefined)
        throw new Error('Scheduled dispatch must return void; use an explicit async gate')
      }
    }
    this.time = target
  }

  /** Fails closeout when an event was silently left unexecuted. */
  assertIdle(): void {
    if (this.pending.size) throw new Error(`Scheduler has pending tasks: ${[...this.pending.values()].map((task) => task.label).join(', ')}`)
  }
}

/** Rejects times which cannot have a reproducible integer ordering. */
function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid scheduler ${label}`)
}

/** One-shot asynchronous boundary with a receipt proving that the consumer arrived. */
export function createGate<T>(name: string) {
  let state: 'new' | 'waiting' | 'released' | 'rejected' = 'new'
  let notifyEntered!: () => void
  let complete!: (value: T) => void
  let fail!: (error: Error) => void
  const entered = new Promise<void>((resolve) => { notifyEntered = resolve })
  const completion = new Promise<T>((resolve, reject) => { complete = resolve; fail = reject })
  return {
    entered,
    state: () => state,
    /** Enters exactly once; callers can await entered before choosing another event. */
    wait(): Promise<T> {
      if (state !== 'new') throw new Error(`${name} already entered`)
      state = 'waiting'
      notifyEntered()
      return completion
    },
    /** Releases only after arrival, so an impossible ordering cannot pass silently. */
    release(value: T): void {
      if (state !== 'waiting') throw new Error(`${name} not waiting or already released`)
      state = 'released'
      complete(value)
    },
    /** Delivers a chosen worker failure through the same explicit completion boundary. */
    reject(error: Error): void {
      if (state !== 'waiting') throw new Error(`${name} not waiting or already settled`)
      state = 'rejected'
      fail(error)
    },
    /** Fails closeout if a gate was never reached or never settled. */
    assertSettled(): void {
      if (state !== 'released' && state !== 'rejected') throw new Error(`${name} not settled`)
    },
  }
}
