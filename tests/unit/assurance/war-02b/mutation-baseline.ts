import { cursorWindowArbitrary, ingestCaseArbitrary, irishCoordinateArbitrary } from './arbitraries'
import {
  applyCursorWindowRebreak,
  cursorWindowInvariant,
  observeCursorWindow,
} from './cursor-window-probe'
import { tm65ToWgs84, wgs84ToTM65 } from '../../../../src/lib/coordinates'
import {
  loadPositionPolicy,
  positionPolicyInvariant,
  type PositionPolicy,
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

/** Converts one property result into an explicit killed/survived receipt row. */
function outcome(
  id: string,
  seam: MutationSeam,
  result: { readonly failed: boolean; readonly seed: number; readonly numRuns: number },
  runBudget: number,
  reason: string,
): MutationOutcome {
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
    'mutation coordinate easting offset',
    irishCoordinateArbitrary,
    (input) => {
      const [easting, northing] = wgs84ToTM65(input.lat, input.lon)
      // A one-metre easting mutation must be visible at the WGS84 boundary.
      const [lat, lon] = tm65ToWgs84(easting + 1, northing)
      return Math.abs(lat - input.lat) < 1e-7 && Math.abs(lon - input.lon) < 1e-7
    },
    { seed: coordinateSeed, numRuns: coordinateRuns },
  )

  const cursorSeed = 2026091202
  const cursorRuns = 25
  const cursorResult = await runBoundedAsyncProperty(
    'mutation cursor plus one second',
    cursorWindowArbitrary,
    async (input) => {
      const current = await observeCursorWindow(input)
      return cursorWindowInvariant(applyCursorWindowRebreak(current))
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

  const survivorSeed = 2026091204
  const survivorRuns = 100
  const baselinePolicy = loadPositionPolicy()
  const legacyHashMutation: PositionPolicy = {
    canonicalizeAcceptedPosition: baselinePolicy.canonicalizeAcceptedPosition,
    classifyPositionIngest: (input) => {
      const storedHash = input.existing?.content_hash
      if (typeof storedHash === 'string' && storedHash.startsWith('legacy:')) {
        const canonicalIncoming = baselinePolicy.canonicalizeAcceptedPosition(input.incoming)
        return { decision: 'duplicate', contentHash: canonicalIncoming.contentHash }
      }
      return baselinePolicy.classifyPositionIngest(input)
    },
  }
  const survivorResult = runBoundedProperty(
    'mutation legacy hash prefix handling',
    ingestCaseArbitrary,
    (input) => positionPolicyInvariant(legacyHashMutation, input),
    { seed: survivorSeed, numRuns: survivorRuns },
  )

  return [
    outcome(
      'coordinate-easting-plus-one-metre',
      'coordinate-transform',
      coordinateResult,
      coordinateRuns,
      'Round-trip oracle rejects a transformed easting offset.',
    ),
    outcome(
      'cursor-plus-one-second',
      'cursor-window-arithmetic',
      cursorResult,
      cursorRuns,
      'Inclusive boundary oracle rejects a fetch start after the previous cursor.',
    ),
    outcome(
      'ingest-timestamp-without-normalization',
      'position-ingest-policy',
      ingestKilledResult,
      ingestRuns,
      'Equivalent timestamp spellings must retain duplicate identity.',
    ),
    outcome(
      'ingest-legacy-prefix-conflict-uncovered',
      'position-ingest-policy',
      survivorResult,
      survivorRuns,
      'Survives because the bounded corpus does not generate legacy: stored hashes; this is a coverage gap, not a pass claim.',
    ),
  ]
}

/** Ensures the baseline catalog cannot silently grow beyond the three approved seams. */
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
}
