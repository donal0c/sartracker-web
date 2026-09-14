'use strict'

const SEARCH_OPERATIONS_GENERATION_COLUMN = 'search_operations_generation'
const MAX_GENERATION = Number.MAX_SAFE_INTEGER
const SEARCH_OPERATION_TABLES = Object.freeze([
  'outings',
  'search_areas',
  'search_assignments',
  'search_pass_evidence_links',
  'search_passes',
])
const SEARCH_OPERATIONS_TRIGGER_NAMES = Object.freeze(
  SEARCH_OPERATION_TABLES.flatMap((tableName) => [
    `search_operations_generation_${tableName}_delete`,
    `search_operations_generation_${tableName}_insert`,
    `search_operations_generation_${tableName}_update`,
  ]).sort(),
)

/** Returns whether a named SQLite table exists. */
function tableExists(database, tableName) {
  return database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName) !== undefined
}

/** Returns the names of one table's columns without trusting schema text. */
function tableColumns(database, tableName) {
  return database.prepare(`PRAGMA table_info("${tableName}")`).all()
    .map((column) => column.name)
}

/** Adds the durable Search Operations generation column to legacy stores. */
function ensureSearchOperationsGenerationSchema(database) {
  if (database === null || typeof database !== 'object'
    || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new Error('Search Operations generation database is invalid.')
  }
  if (!tableExists(database, 'mission_replay_generations')) {
    throw new Error('Search Operations generation table is missing.')
  }
  if (!tableColumns(database, 'mission_replay_generations')
    .includes(SEARCH_OPERATIONS_GENERATION_COLUMN)) {
    database.exec(`ALTER TABLE mission_replay_generations ADD COLUMN
      ${SEARCH_OPERATIONS_GENERATION_COLUMN} INTEGER NOT NULL DEFAULT 0
      CHECK(${SEARCH_OPERATIONS_GENERATION_COLUMN} >= 0)`)
    return true
  }
  return false
}

/** Reads the generation that fences all four Search Operations page kinds. */
function readSearchOperationsGeneration(database, missionId) {
  if (database === null || typeof database !== 'object'
    || typeof database.prepare !== 'function') {
    throw new Error('Search Operations generation database is invalid.')
  }
  if (!tableExists(database, 'mission_replay_generations')) return 0
  const columns = tableColumns(database, 'mission_replay_generations')
  if (!columns.includes('generation')) {
    throw new Error('Search Operations mission generation is invalid.')
  }
  // The fallback keeps older isolated query fixtures readable. Live stores are
  // upgraded by ensureSearchOperationsGenerationSchema before any page query.
  const column = columns.includes(SEARCH_OPERATIONS_GENERATION_COLUMN)
    ? SEARCH_OPERATIONS_GENERATION_COLUMN
    : 'generation'
  const generation = Number(database.prepare(`SELECT ${column}
    FROM mission_replay_generations WHERE mission_id = ?`).get(missionId)?.[column] ?? 0)
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Search Operations mission generation is invalid.')
  }
  return generation
}

/** Returns a trigger row's mission identity for one searchable projection. */
function missionExpression(tableName, rowAlias) {
  if (tableName === 'search_pass_evidence_links') {
    return `(SELECT search_pass.mission_id FROM search_passes AS search_pass
      WHERE search_pass.id = ${rowAlias}."pass_id")`
  }
  return `${rowAlias}."mission_id"`
}

/** Creates one transactional generation bump for a trigger body. */
function createAdvanceStatement(expression, predicate = '1') {
  const mission = `(${expression})`
  return `        INSERT INTO mission_replay_generations (
          mission_id, generation, ${SEARCH_OPERATIONS_GENERATION_COLUMN}
        ) SELECT ${mission}, 0, 1
        WHERE ${mission} IS NOT NULL
          AND (${predicate})
          AND EXISTS (SELECT 1 FROM missions WHERE id = ${mission})
        ON CONFLICT(mission_id) DO UPDATE SET
          ${SEARCH_OPERATIONS_GENERATION_COLUMN} = CASE
            WHEN ${SEARCH_OPERATIONS_GENERATION_COLUMN} < ${MAX_GENERATION}
              THEN ${SEARCH_OPERATIONS_GENERATION_COLUMN} + 1
            ELSE RAISE(ABORT, 'Search Operations generation is exhausted.')
          END;`
}

/** Creates one named Search Operations trigger for a projection mutation. */
function createTriggerSql(tableName, operation) {
  const oldMission = missionExpression(tableName, 'OLD')
  const newMission = missionExpression(tableName, 'NEW')
  const statements = operation === 'delete'
    ? createAdvanceStatement(oldMission)
    : operation === 'insert'
      ? createAdvanceStatement(newMission)
      : `${createAdvanceStatement(oldMission)}
${createAdvanceStatement(newMission, `${newMission} IS NOT ${oldMission}`)}`
  return `CREATE TRIGGER search_operations_generation_${tableName}_${operation}
    BEFORE ${operation.toUpperCase()} ON "${tableName}"
    BEGIN
${statements}
    END`
}

const SEARCH_OPERATIONS_TRIGGER_SQL = Object.freeze(Object.fromEntries(
  SEARCH_OPERATION_TABLES.flatMap((tableName) =>
    ['delete', 'insert', 'update'].map((operation) => [
      `search_operations_generation_${tableName}_${operation}`,
      createTriggerSql(tableName, operation),
    ])),
))

/** Installs separately attested invalidation triggers for each projection. */
function installSearchOperationsGenerationTriggers(database) {
  if (database === null || typeof database !== 'object'
    || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new Error('Search Operations generation database is invalid.')
  }
  ensureSearchOperationsGenerationSchema(database)
  for (const triggerName of SEARCH_OPERATIONS_TRIGGER_NAMES) {
    database.exec(`DROP TRIGGER IF EXISTS "${triggerName}"`)
  }
  for (const triggerName of SEARCH_OPERATIONS_TRIGGER_NAMES) {
    database.exec(SEARCH_OPERATIONS_TRIGGER_SQL[triggerName])
  }
}

module.exports = {
  SEARCH_OPERATIONS_GENERATION_COLUMN,
  SEARCH_OPERATION_TABLES,
  SEARCH_OPERATIONS_TRIGGER_NAMES,
  SEARCH_OPERATIONS_TRIGGER_SQL,
  ensureSearchOperationsGenerationSchema,
  installSearchOperationsGenerationTriggers,
  readSearchOperationsGeneration,
}
