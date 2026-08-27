import { statSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

import {
  createExactBreadcrumbDotController,
  resolveBreadcrumbDotOverlaySnapshot,
  type ExactBreadcrumbDotPage,
  type ExactBreadcrumbDotState,
} from '../../src/features/tracking/exact-breadcrumb-dot-controller'
import { createExactBreadcrumbDotFeatureCollection } from '../../src/features/tracking/tracking-geojson'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const MISSION_ID = 'dots-contract-mission'
const ACTIVE_DEVICE_IDS = ['device-a', 'device-b'] as const
const PAGE_LIMIT = 10_000

const CONTRACT_SUITE_PATHS = [
  'tests/unit/breadcrumb-live-exact-proof-lib.test.ts',
  'tests/unit/breadcrumb-live-exact-smoke-safety.test.ts',
  'tests/unit/electron-breadcrumb-36h-proof-lib.test.ts',
  'tests/unit/electron-breadcrumb-dot-ipc.test.ts',
  'tests/unit/electron-breadcrumb-dot-mission-store.test.ts',
  'tests/unit/electron-breadcrumb-dot-query.test.ts',
  'tests/unit/electron-breadcrumb-dot-runner.test.ts',
  'tests/unit/electron-tracking-soak-exact-action.test.ts',
  'tests/unit/electron-tracking-soak-exact-proof-lib.test.ts',
  'tests/unit/electron-tracking-soak-exact-renderer-proof-lib.test.ts',
  'tests/unit/electron-tracking-soak-exact-script.test.ts',
  'tests/unit/exact-breadcrumb-dot-controller.test.ts',
  'tests/unit/exact-breadcrumb-dot-manual.test.ts',
  'tests/unit/exact-breadcrumb-dot-status.test.ts',
  'tests/unit/start-exact-breadcrumb-dot-runtime.test.ts',
] as const

type StoredExactDot = {
  readonly id: string
  readonly source_position_id: string | null
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly data_origin: 'live' | 'cache'
}

type StoredExactDotPage = Omit<ExactBreadcrumbDotPage, 'positions'> & {
  readonly positions: readonly StoredExactDot[]
}

type ExactDotQuery = (
  database: unknown,
  input: {
    readonly missionId: string
    readonly activeDeviceIds: readonly string[]
    readonly limit: number
    readonly cursor?: string | null
    readonly direction: 'earlier' | 'later' | 'latest'
    readonly signal?: AbortSignal
  },
) => StoredExactDotPage

type ContractMutation =
  | 'drop-one-row'
  | 'duplicate-one-row'
  | 'swap-order'
  | 'shift-one-coordinate'
  | 'shift-one-timestamp'
  | 'substitute-identity'
  | 'truncate-page'
  | 'lie-about-total'

describe('[DOTS-CONTRACT] exact Breadcrumb Dots inspection and evidence contract', () => {
  it('enumerates every supporting contract suite as an explicit table of contents', () => {
    for (const suitePath of CONTRACT_SUITE_PATHS) {
      expect(statSync(suitePath).size, suitePath).toBeGreaterThan(0)
    }
  })

  it('preserves exact truth through SQLite pages, IPC shape, controller and GeoJSON', async () => {
    const database = createContractDatabase()
    try {
      const expected = seedContractMission(database)
      const pages = readChronologicalPages(database)

      expect(expected).toHaveLength(37_479)
      expect([...pages].reverse().map((page) => page.pagePositionCount)).toEqual([
        10_000,
        10_000,
        10_000,
        7_479,
      ])
      assertExactContract(pages, expected)
      await assertControllerAndGeoJsonContract(database, pages.at(-1)!)
    } finally {
      database.close()
    }
  })

  it.each<ContractMutation>([
    'drop-one-row',
    'duplicate-one-row',
    'swap-order',
    'shift-one-coordinate',
    'shift-one-timestamp',
    'substitute-identity',
    'truncate-page',
    'lie-about-total',
  ])('proves the guard rejects the injected %s fault', (mutation) => {
    const database = createContractDatabase()
    try {
      const expected = seedContractMission(database)
      const pages = readChronologicalPages(database)

      expect(() => assertExactContract(mutatePages(pages, mutation), expected))
        .toThrow(/DOTS_CONTRACT_VIOLATION/u)
    } finally {
      database.close()
    }
  })
})

/** Creates the smallest real SQLite schema accepted by the production exact query. */
function createContractDatabase() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE missions (
      id TEXT PRIMARY KEY,
      start_time TEXT NOT NULL
    );
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      UNIQUE (mission_id, device_id)
    );
    CREATE TABLE positions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      source_position_id TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      timestamp TEXT NOT NULL,
      data_origin TEXT NOT NULL,
      timestamp_source TEXT NOT NULL DEFAULT 'fix',
      UNIQUE (mission_id, device_id, source_position_id)
    );
    CREATE INDEX idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
  `)
  return database
}

/** Seeds three devices while returning only the selected, in-mission source truth. */
function seedContractMission(database: ReturnType<typeof createContractDatabase>): StoredExactDot[] {
  const missionStartMs = Date.UTC(2026, 7, 8)
  database.prepare('INSERT INTO missions (id, start_time) VALUES (?, ?)').run(
    MISSION_ID,
    new Date(missionStartMs).toISOString(),
  )
  const insertDevice = database.prepare(
    'INSERT INTO devices (id, mission_id, device_id) VALUES (?, ?, ?)',
  )
  for (const deviceId of [...ACTIVE_DEVICE_IDS, 'device-not-selected']) {
    insertDevice.run(`${MISSION_ID}:${deviceId}`, MISSION_ID, deviceId)
  }

  const insertPosition = database.prepare(`
    INSERT INTO positions (
      id, mission_id, device_id, source_position_id,
      lat, lon, timestamp, data_origin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'live')
  `)
  const expected: StoredExactDot[] = []
  database.transaction(() => {
    insertPosition.run(
      'pre-mission-local',
      MISSION_ID,
      'device-a',
      'pre-mission-source',
      52,
      -9.7,
      new Date(missionStartMs - 1).toISOString(),
    )
    for (const [deviceIndex, deviceId] of ACTIVE_DEVICE_IDS.entries()) {
      const deviceFixCount = deviceIndex === 0 ? 18_740 : 18_739
      for (let ordinal = 0; ordinal < deviceFixCount; ordinal += 1) {
        const sourcePositionId = `${deviceId}-source-${String(ordinal).padStart(5, '0')}`
        const position: StoredExactDot = {
          id: `${deviceId}-local-${ordinal}`,
          source_position_id: sourcePositionId,
          device_id: deviceId,
          lat: 52 + deviceIndex / 100 + ordinal / 10_000_000,
          lon: -9.7 - deviceIndex / 100 - ordinal / 10_000_000,
          timestamp: new Date(missionStartMs + 60_000 + ordinal * 5_000).toISOString(),
          data_origin: 'live',
        }
        insertPosition.run(
          position.id,
          MISSION_ID,
          position.device_id,
          position.source_position_id,
          position.lat,
          position.lon,
          position.timestamp,
        )
        expected.push(position)
      }
    }
    for (let ordinal = 0; ordinal < 5; ordinal += 1) {
      insertPosition.run(
        `unselected-local-${ordinal}`,
        MISSION_ID,
        'device-not-selected',
        `unselected-source-${ordinal}`,
        53,
        -8,
        new Date(missionStartMs + 60_000 + ordinal * 5_000).toISOString(),
      )
    }
  })()
  return expected.sort(compareStoredDots)
}

/** Traverses newest-to-oldest keyset pages and returns them in chronological order. */
function readChronologicalPages(
  database: ReturnType<typeof createContractDatabase>,
): StoredExactDotPage[] {
  const query = loadExactDotQuery()
  const pages: StoredExactDotPage[] = []
  let cursor: string | null = null
  let direction: 'latest' | 'earlier' = 'latest'
  while (true) {
    const page = roundTripIpcPayload(query(database, {
      missionId: MISSION_ID,
      activeDeviceIds: ACTIVE_DEVICE_IDS,
      limit: PAGE_LIMIT,
      cursor,
      direction,
    }))
    pages.unshift(page)
    if (!page.hasEarlier) {
      break
    }
    cursor = page.earlierCursor
    direction = 'earlier'
  }
  return pages
}

/** Loads the real production SQLite query and fails if it is unavailable. */
function loadExactDotQuery(): ExactDotQuery {
  const module = require('../../electron/breadcrumb-dot-query.cjs') as {
    readonly listExactBreadcrumbDotPage?: ExactDotQuery
  }
  if (typeof module.listExactBreadcrumbDotPage !== 'function') {
    throw new Error('DOTS_CONTRACT_VIOLATION: production exact query is unavailable')
  }
  return module.listExactBreadcrumbDotPage
}

/** Simulates the Electron structured-clone boundary using a JSON-safe payload. */
function roundTripIpcPayload(page: StoredExactDotPage): StoredExactDotPage {
  return JSON.parse(JSON.stringify(page)) as StoredExactDotPage
}

/** Maps the stored IPC page into the renderer shape used by the exact-dot runtime. */
function toRendererPage(page: StoredExactDotPage): ExactBreadcrumbDotPage {
  return {
    ...page,
    positions: page.positions.map(toNormalizedPosition),
  }
}

/** Converts one exact stored row without changing its evidence fields. */
function toNormalizedPosition(position: StoredExactDot): NormalizedTrackingPosition & {
  readonly source_position_id: string | null
} {
  return {
    id: position.source_position_id?.trim() || position.id,
    source_position_id: position.source_position_id?.trim() || null,
    device_id: position.device_id,
    lat: position.lat,
    lon: position.lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: position.timestamp,
    source: 'traccar',
    data_origin: position.data_origin,
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

/** Proves the controller publishes exact rows and never snapshot representatives. */
async function assertControllerAndGeoJsonContract(
  database: ReturnType<typeof createContractDatabase>,
  expectedLatest: StoredExactDotPage,
): Promise<void> {
  const query = loadExactDotQuery()
  const controller = createExactBreadcrumbDotController({
    limit: PAGE_LIMIT,
    queryPage: async (input) => toRendererPage(roundTripIpcPayload(query(database, input))),
    publish: () => undefined,
  })
  controller.updateContext({
    missionId: MISSION_ID,
    trailMode: 'dots',
    activeDeviceIds: ACTIVE_DEVICE_IDS,
  })
  await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))

  const representative = toNormalizedPosition({
    id: 'representative-local',
    source_position_id: 'representative-source',
    device_id: 'device-a',
    lat: 0,
    lon: 0,
    timestamp: '2026-08-08T00:00:00.000Z',
    data_origin: 'live',
  })
  const snapshot: TrackingSnapshot = {
    devices: [],
    positions: [],
    breadcrumbs: [representative],
  }
  const resolved = resolveBreadcrumbDotOverlaySnapshot(
    snapshot,
    'dots',
    controller.getState(),
  )
  const expectedPositions = expectedLatest.positions.map(toNormalizedPosition)
  assertCondition(
    exactJson(resolved.breadcrumbs) === exactJson(expectedPositions),
    'controller did not publish the latest exact page',
  )
  assertCondition(
    !resolved.breadcrumbs.some((position) => position.id === representative.id),
    'controller substituted a representative breadcrumb',
  )
  assertFeatureCollection(resolved.breadcrumbs)

  controller.showEarlier()
  await vi.waitFor(() => {
    const state = controller.getState()
    expect(state.status === 'ready' && state.toTimestamp !== expectedLatest.toTimestamp).toBe(true)
  })
  controller.showLater()
  await vi.waitFor(() => {
    const state = controller.getState()
    expect(state.status === 'ready' ? state.toTimestamp : null).toBe(expectedLatest.toTimestamp)
  })
  assertCondition(
    exactJson(getReadyPositions(controller.getState())) === exactJson(expectedPositions),
    'Earlier/Later round-trip did not return to the identical latest page',
  )
  controller.stop()
}

/** Proves every page and its union equal the independently seeded source truth. */
function assertExactContract(
  pages: readonly StoredExactDotPage[],
  expected: readonly StoredExactDot[],
): void {
  assertCondition(pages.length >= 3, 'fixture did not produce at least three pages')
  const union: StoredExactDot[] = []
  for (const [pageIndex, page] of pages.entries()) {
    assertCondition(page.totalPositionCount === expected.length, 'page total disagrees with truth')
    assertCondition(page.pagePositionCount === page.positions.length, 'page count disagrees with rows')
    assertCondition(
      exactJson([...page.positions].sort(compareStoredDots)) === exactJson(page.positions),
      `page ${pageIndex} is not in stable chronological identity order`,
    )
    assertCondition(page.hasEarlier === (pageIndex > 0), 'Earlier navigation flag is false')
    assertCondition(page.hasLater === (pageIndex < pages.length - 1), 'Later navigation flag is false')
    assertFeatureCollection(page.positions.map(toNormalizedPosition))
    union.push(...page.positions)
  }
  assertCondition(union.length === expected.length, 'page union count disagrees with truth')
  assertCondition(new Set(union.map(createStoredIdentity)).size === union.length, 'page union has duplicate identities')
  assertCondition(exactJson(union) === exactJson(expected), 'page union changed source truth')
}

/** Proves GeoJSON retains exact identity, time and coordinates for every row. */
function assertFeatureCollection(
  positions: readonly (NormalizedTrackingPosition & {
    readonly source_position_id?: string | null
  })[],
): void {
  const collection = createExactBreadcrumbDotFeatureCollection(positions)
  assertCondition(collection.features.length === positions.length, 'GeoJSON count changed')
  for (const [index, feature] of collection.features.entries()) {
    const position = positions[index]!
    const sourceIdentity = position.source_position_id?.trim() || null
    const expectedId = sourceIdentity === null
      ? `${position.device_id}:stored:${position.id.trim()}`
      : `${position.device_id}:id:${sourceIdentity}`
    assertCondition(feature.id === expectedId, 'GeoJSON identity changed')
    assertCondition(
      exactJson(feature.geometry.coordinates) === exactJson([position.lon, position.lat]),
      'GeoJSON coordinates changed',
    )
    assertCondition(feature.properties.timestamp === position.timestamp, 'GeoJSON timestamp changed')
  }
}

/** Injects one deterministic pipeline fault without changing production code. */
function mutatePages(
  sourcePages: readonly StoredExactDotPage[],
  mutation: ContractMutation,
): StoredExactDotPage[] {
  const pages = JSON.parse(JSON.stringify(sourcePages)) as StoredExactDotPage[]
  if (mutation === 'truncate-page') {
    return pages.slice(1)
  }
  if (mutation === 'lie-about-total') {
    return pages.map((page, index) => index === 0
      ? { ...page, totalPositionCount: page.totalPositionCount + 1 }
      : page)
  }
  const targetIndex = pages.findIndex((page) => page.positions.length >= 2)
  const target = pages[targetIndex]!
  const positions = [...target.positions]
  switch (mutation) {
    case 'drop-one-row':
      positions.splice(1, 1)
      break
    case 'duplicate-one-row':
      positions.splice(1, 0, positions[0]!)
      break
    case 'swap-order':
      ;[positions[0], positions[1]] = [positions[1]!, positions[0]!]
      break
    case 'shift-one-coordinate':
      positions[0] = { ...positions[0]!, lat: positions[0]!.lat + 0.0001 }
      break
    case 'shift-one-timestamp':
      positions[0] = {
        ...positions[0]!,
        timestamp: new Date(Date.parse(positions[0]!.timestamp) + 1_000).toISOString(),
      }
      break
    case 'substitute-identity':
      positions[0] = { ...positions[0]!, source_position_id: 'substituted-source-identity' }
      break
    default:
      throw new Error(`Unsupported contract mutation: ${mutation satisfies never}`)
  }
  pages[targetIndex] = {
    ...target,
    positions,
    pagePositionCount: positions.length,
    fromTimestamp: positions[0]?.timestamp ?? null,
    toTimestamp: positions.at(-1)?.timestamp ?? null,
  }
  return pages
}

/** Returns positions only from a ready controller state. */
function getReadyPositions(state: ExactBreadcrumbDotState): readonly NormalizedTrackingPosition[] {
  if (state.status !== 'ready') {
    throw new Error('DOTS_CONTRACT_VIOLATION: controller is not ready')
  }
  return state.positions
}

/** Creates the stable identity used by the exact page contract. */
function createStoredIdentity(position: StoredExactDot): string {
  return `${position.device_id}\u0000${position.source_position_id ?? `stored:${position.id}`}`
}

/** Orders exact rows by timestamp, device and durable source identity. */
function compareStoredDots(left: StoredExactDot, right: StoredExactDot): number {
  return (
    compareStrings(left.timestamp, right.timestamp) ||
    compareStrings(left.device_id, right.device_id) ||
    compareStrings(left.source_position_id ?? left.id, right.source_position_id ?? right.id)
  )
}

/** Compares strings by JavaScript code-unit ordering, matching production SQLite tie handling. */
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Produces deterministic evidence text without tolerant numeric comparison. */
function exactJson(value: unknown): string {
  return JSON.stringify(value)
}

/** Throws one stable contract-class error for every invariant violation. */
function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`DOTS_CONTRACT_VIOLATION: ${message}`)
  }
}
