import {
  coordinateGoldenAnchorArbitrary,
  cursorWindowArbitrary,
  ingestCaseArbitrary,
} from './arbitraries'
import {
  WAR_02B_CURSOR_OVERLAP_MS,
  cursorWindowInvariant,
  cursorWindowRequestArithmeticInvariant,
  observeCursorWindow,
} from './cursor-window-probe'
import { tm65ToWgs84 } from '../../../../src/lib/coordinates'
import {
  loadPositionPolicy,
  positionPolicyInvariant,
} from './property-contracts'
import { runBoundedAsyncProperty, runBoundedProperty } from './property-runner'

export type MutationSeam = 'coordinate-transform' | 'cursor-window-arithmetic' | 'position-ingest-policy'

export type MutationOutcome = {
  readonly id: string
  readonly seam: MutationSeam
  readonly status: 'killed' | 'survived'
  readonly seed: number
  readonly runBudget: number
  readonly numRuns: number
  readonly reason: string
}

export const WAR_02B_MUTATION_SEAMS: readonly MutationSeam[] = [
  'coordinate-transform',
  'cursor-window-arithmetic',
  'position-ingest-policy',
]

export const WAR_02B_MUTATION_IDS: readonly string[] = [
  'coordinate-tm65-golden-anchor-perturbation',
  'cursor-public-boundary-fault-injection',
  'ingest-timestamp-without-normalization',
  'ingest-unversioned-hash-integrity',
]

/** Converts one property result into an explicit killed/survived receipt row. */
function outcome(
  id: string,
  seam: MutationSeam,
  result: {
    readonly failed: boolean
    readonly seed: number
    readonly numRuns: number
    readonly errorInstance?: unknown
  },
  runBudget: number,
  reason: string,
): MutationOutcome {
  if (result.failed && (!(result.errorInstance instanceof Error)
    || result.errorInstance.message !== 'Property failed by returning false')) {
    throw new Error(`WAR-02B mutation ${id} failed for an unexpected reason.`)
  }
  return {
    id,
    seam,
    status: result.failed ? 'killed' : 'survived',
    seed: result.seed,
    runBudget,
    numRuns: result.numRuns,
    reason,
  }
}

/** Runs the deliberately small semantic mutation baseline for the three named seams. */
export async function runWar02bMutationBaseline(): Promise<readonly MutationOutcome[]> {
  const coordinateSeed = 2026091201
  const coordinateRuns = 50
  const coordinateResult = runBoundedProperty(
    'mutation coordinate TM65 golden anchor perturbation',
    coordinateGoldenAnchorArbitrary,
    (input) => {
      // A ten-metre projected-coordinate perturbation must fail against a fixed
      // WGS84 anchor; a self-inverse round trip cannot provide this oracle.
      const [lat, lon] = tm65ToWgs84(input.easting + 10, input.northing)
      return Math.abs(lat - input.lat) <= input.toleranceDegrees &&
        Math.abs(lon - input.lon) <= input.toleranceDegrees
    },
    { seed: coordinateSeed, numRuns: coordinateRuns },
  )

  const cursorSeed = 2026091202
  const cursorRuns = 25
  const cursorResult = await runBoundedAsyncProperty(
    'mutation cursor public boundary fault injection',
    cursorWindowArbitrary,
    async (input) => {
      const baseline = await observeCursorWindow(input)
      if (!cursorWindowInvariant(baseline)) {
        throw new Error('WAR-02B current cursor oracle is broken before fault injection.')
      }
      const mutated = await observeCursorWindow(input, {
        mutateRequestedFrom: (requestedFromMs) =>
          requestedFromMs + WAR_02B_CURSOR_OVERLAP_MS + 1_000,
      })
      if (!cursorWindowRequestArithmeticInvariant(mutated)) {
        throw new Error('WAR-02B fault injection did not preserve the manager request arithmetic.')
      }
      return cursorWindowInvariant(mutated)
    },
    { seed: cursorSeed, numRuns: cursorRuns },
  )

  const ingestSeed = 2026091203
  const ingestRuns = 100
  const timestampMutation = loadPositionPolicy({
    from: 'timestamp: normalizeCanonicalTimestamp(input.timestamp)',
    to: 'timestamp: input.timestamp',
  })
  const ingestKilledResult = runBoundedProperty(
    'mutation ingest timestamp normalization',
    ingestCaseArbitrary,
    (input) => positionPolicyInvariant(timestampMutation, input),
    { seed: ingestSeed, numRuns: ingestRuns },
  )

  const hashSeed = 2026091204
  const hashRuns = 100
  const unversionedHashMutation = loadPositionPolicy({
    from: "storedHash.startsWith('v1:')",
    to: 'true',
  })
  const hashResult = runBoundedProperty(
    'mutation unversioned hash integrity',
    ingestCaseArbitrary,
    (input) => positionPolicyInvariant(unversionedHashMutation, input),
    { seed: hashSeed, numRuns: hashRuns },
  )

  return [
    outcome(
      'coordinate-tm65-golden-anchor-perturbation',
      'coordinate-transform',
      coordinateResult,
      coordinateRuns,
      'Independent TM65/WGS84 anchor rejects a ten-metre projected-coordinate perturbation.',
    ),
    outcome(
      'cursor-public-boundary-fault-injection',
      'cursor-window-arithmetic',
      cursorResult,
      cursorRuns,
      'A client-boundary fault after the real manager arithmetic loses the boundary and is rejected.',
    ),
    outcome(
      'ingest-timestamp-without-normalization',
      'position-ingest-policy',
      ingestKilledResult,
      ingestRuns,
      'Equivalent timestamp spellings must retain duplicate identity.',
    ),
    outcome(
      'ingest-unversioned-hash-integrity',
      'position-ingest-policy',
      hashResult,
      hashRuns,
      'An unknown hash prefix must not bypass integrity checking when the stored hash is treated as versioned.',
    ),
  ]
}

/** Ensures every approved seam and named current mutant remains present in the receipt. */
export function assertExactlyThreeMutationSeams(outcomes: readonly MutationOutcome[]): void {
  const seams = new Set(outcomes.map((entry) => entry.seam))
  if (seams.size !== WAR_02B_MUTATION_SEAMS.length) {
    throw new Error(`WAR-02B mutation baseline expected exactly three seams, got ${seams.size}.`)
  }
  for (const seam of WAR_02B_MUTATION_SEAMS) {
    if (!seams.has(seam)) {
      throw new Error(`WAR-02B mutation baseline omitted approved seam: ${seam}.`)
    }
  }
  const ids = outcomes.map((entry) => entry.id)
  if (ids.length !== WAR_02B_MUTATION_IDS.length
    || new Set(ids).size !== ids.length
    || WAR_02B_MUTATION_IDS.some((id) => !ids.includes(id))) {
    throw new Error('WAR-02B mutation baseline does not match the approved mutant catalog.')
  }
}
