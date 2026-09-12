import * as fc from 'fast-check'

export const WAR_02B_DEFAULT_SEED = 20260912
export const WAR_02B_MAX_RUNS = 250

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
  return {
    seed: options.seed ?? WAR_02B_DEFAULT_SEED,
    numRuns,
    endOnFailure: true,
    maxSkipsPerRun: 0,
    includeErrorInReport: true,
  }
}

/** Converts arbitrary fast-check failure values into stable one-line evidence. */
function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
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
  void name
  const result = fc.check(
    fc.property(arbitrary, predicate),
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
  void name
  const result = await fc.check(
    fc.asyncProperty(arbitrary, predicate),
    boundedParameters<T>(options),
  )
  return result
}

/** Throws with deterministic replay data when a normal WAR-02B property is false. */
export function assertBoundedProperty<T>(
  name: string,
  result: BoundedPropertyResult<T>,
): void {
  if (result.failed) {
    throw new Error(formatBoundedPropertyFailure(name, result))
  }
}
