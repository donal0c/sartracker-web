import * as fc from 'fast-check'

export const WAR_02B_DEFAULT_SEED = 20260912
export const WAR_02B_MAX_RUNS = 250
const WAR_02B_PREDICATE_TIMEOUT_MS = 10_000
const WAR_02B_INTERRUPT_TIMEOUT_MS = 120_000

export type BoundedPropertyOptions = {
  readonly seed?: number
  readonly numRuns?: number
}

export type BoundedPropertyResult<T> = fc.RunDetails<[T]>

/** Builds the common bounded execution parameters for one property run. */
function boundedParameters<T>(options: BoundedPropertyOptions): fc.Parameters<[T]> {
  const numRuns = options.numRuns ?? 100
  if (!Number.isInteger(numRuns) || numRuns < 1 || numRuns > WAR_02B_MAX_RUNS) {
    throw new RangeError(`WAR-02B numRuns must be an integer from 1 to ${WAR_02B_MAX_RUNS}.`)
  }
  const seed = options.seed ?? WAR_02B_DEFAULT_SEED
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError('WAR-02B seed must be a finite integer.')
  }
  return {
    seed,
    numRuns,
    // Keep the run bounded while retaining fast-check's minimal counterexample.
    timeout: WAR_02B_PREDICATE_TIMEOUT_MS,
    interruptAfterTimeLimit: WAR_02B_INTERRUPT_TIMEOUT_MS,
    markInterruptAsFailure: true,
    // Any precondition skip is a missing test case, not a successful property run.
    maxSkipsPerRun: 0,
  }
}

/** Converts arbitrary fast-check failure values into stable one-line evidence. */
function describeUnknown(value: unknown, seen = new WeakSet<object>()): string {
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'
    seen.add(value)
  }
  if (value instanceof Error) {
    const stack = typeof value.stack === 'string'
      ? value.stack.replaceAll('\n', '\\n')
      : undefined
    const cause = 'cause' in value && value.cause !== value
      ? `; cause=${describeUnknown(value.cause, seen)}`
      : ''
    return `${value.name}: ${value.message}${cause}${stack ? `; stack=${stack}` : ''}`
  }
  try {
    return JSON.stringify(value, (_key, nested: unknown) =>
      typeof nested === 'number' && !Number.isFinite(nested) ? String(nested) : nested,
    ) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Creates the actionable error used when a runtime predicate violates its boolean contract. */
function predicateContractError(name: string, value: unknown): TypeError {
  return new TypeError(
    `WAR-02B predicate "${name}" must return boolean; received ${typeof value}`,
  )
}

/** Wraps a synchronous predicate so JavaScript callers cannot pass through a missing return value. */
function enforceSyncPredicate<T>(
  name: string,
  predicate: (value: T) => boolean,
): (value: T) => boolean {
  return (value: T): boolean => {
    const result = predicate(value)
    if (typeof result !== 'boolean') {
      throw predicateContractError(name, result)
    }
    return result
  }
}

/** Wraps an asynchronous predicate with the same fail-closed runtime contract as synchronous properties. */
function enforceAsyncPredicate<T>(
  name: string,
  predicate: (value: T) => Promise<boolean>,
): (value: T) => Promise<boolean> {
  return async (value: T): Promise<boolean> => {
    const result = await predicate(value)
    if (typeof result !== 'boolean') {
      throw predicateContractError(name, result)
    }
    return result
  }
}

/** Formats the exact fast-check replay information needed to reproduce a failure. */
export function formatBoundedPropertyFailure<T>(
  name: string,
  result: BoundedPropertyResult<T>,
): string {
  const counterexample = result.counterexample?.[0]
  return [
    `WAR-02B property failed: ${name}`,
    `seed=${result.seed}`,
    `path=${result.counterexamplePath ?? '<none>'}`,
    `numRuns=${result.numRuns}`,
    `counterexample=${describeUnknown(counterexample)}`,
    `error=${describeUnknown(result.errorInstance)}`,
    `replay=seed=${result.seed} path=${result.counterexamplePath ?? '<none>'}`,
  ].join('\n')
}

/** Runs a synchronous property with a fixed seed and a CI-safe run budget. */
export function runBoundedProperty<T>(
  name: string,
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => boolean,
  options: BoundedPropertyOptions = {},
): BoundedPropertyResult<T> {
  const result = fc.check(
    fc.property(arbitrary, enforceSyncPredicate(name, predicate)),
    boundedParameters<T>(options),
  )
  return result
}

/** Runs an asynchronous property with the same deterministic bounded contract. */
export async function runBoundedAsyncProperty<T>(
  name: string,
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => Promise<boolean>,
  options: BoundedPropertyOptions = {},
): Promise<BoundedPropertyResult<T>> {
  const result = await fc.check(
    fc.asyncProperty(arbitrary, enforceAsyncPredicate(name, predicate)),
    boundedParameters<T>(options),
  )
  return result
}

/** Throws with deterministic replay data when a normal WAR-02B property is false. */
export function assertBoundedProperty<T>(
  name: string,
  result: BoundedPropertyResult<T>,
): void {
  if (result.interrupted || result.failed) {
    throw new Error(formatBoundedPropertyFailure(name, result))
  }
}
