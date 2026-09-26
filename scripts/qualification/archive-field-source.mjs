export const ARCHIVE_FIELD_MIN_BYTES = 3_700_000_000
const missionId = 'fixture-mission-000000000001'
const startTime = '2026-01-01T00:00:00.000Z'
const tables = ['missions', 'devices', 'positions', 'mission_events']

/** Bind the archive role to the original target-size generator and measured source. */
export function assertArchiveFieldManifest(manifest, source) {
  if (manifest?.preset !== 'field' || manifest.generatorVersion !== 2 || manifest.schemaVersion !== 13
      || manifest.syntheticDataOnly !== true || manifest.workload?.mode !== 'target-size'
      || manifest.workload.deviceCount !== 32 || manifest.workload.activePositionDeviceCount !== 8
      || manifest.scenario !== undefined || !/^[a-f0-9]{64}$/u.test(source?.sha256 ?? '')
      || !Number.isSafeInteger(source?.bytes) || source.bytes < ARCHIVE_FIELD_MIN_BYTES
      || manifest.database?.sha256 !== source.sha256 || manifest.database.bytes !== source.bytes) {
    throw new Error('Archive field fixture role, version, size, or source identity differs.')
  }
  const counts = manifest.rows?.byTable
  if (tables.some(table => !Number.isSafeInteger(counts?.[table]) || counts[table] < 1)
      || counts.missions !== 1 || counts.devices !== 32
      || manifest.workload.realPositionRows !== counts.positions
      || manifest.rows.totalMissionEvents !== counts.mission_events) {
    throw new Error('Archive field fixture manifest inventory differs.')
  }
}

/** Validate the retained all-position inventory against its bound legacy manifest. */
export function assertArchiveFieldInventory(manifest, inventory) {
  if (inventory?.primary?.id !== missionId || inventory.primary.status !== 'active'
      || inventory.primary.start_time !== startTime || inventory.primary.schema_version !== 13
      || inventory.activePositionDeviceCount !== 8
      || tables.some(table => inventory.rowCounts?.[table] !== manifest.rows.byTable[table])
      || inventory.fixturePositionCount !== manifest.rows.byTable.positions
      || inventory.primary.positionCount !== inventory.fixturePositionCount
      || ['null', 'fix', 'other'].some(key => !Number.isSafeInteger(inventory.provenance?.[key]) || inventory.provenance[key] < 0)
      || inventory.provenance.null + inventory.provenance.fix + inventory.provenance.other !== inventory.fixturePositionCount) {
    throw new Error('Archive field fixture database inventory differs from its manifest.')
  }
}

/** Count every archive position without inventing paging eligibility or provenance. */
export function selectArchiveFieldSource(database, manifest, source) {
  assertArchiveFieldManifest(manifest, source)
  const missions = database.prepare('SELECT id,status,start_time,schema_version FROM missions').all()
  if (missions.length !== 1) throw new Error('Archive field fixture must have exactly one intended active mission.')
  const rowCounts = Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]))
  for (const table of tables.slice(1)) {
    if (database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE mission_id=?`).get(missionId).count !== rowCounts[table]) {
      throw new Error('Archive field fixture contains rows outside the intended mission.')
    }
  }
  const provenance = database.prepare(`SELECT
    SUM(timestamp_source IS NULL) AS "null",
    SUM(timestamp_source='fix') AS fix,
    SUM(timestamp_source IS NOT NULL AND timestamp_source!='fix') AS other FROM positions`).get()
  // SUM over exclusively NULL comparisons is NULL, but the corresponding count is zero.
  for (const key of ['null', 'fix', 'other']) provenance[key] ??= 0
  const inventory = {
    primary: { ...missions[0], positionCount: rowCounts.positions },
    fixturePositionCount: rowCounts.positions, rowCounts, provenance,
    activePositionDeviceCount: database.prepare('SELECT COUNT(DISTINCT device_id) AS count FROM positions').get().count,
  }
  assertArchiveFieldInventory(manifest, inventory)
  return Object.freeze(inventory)
}
