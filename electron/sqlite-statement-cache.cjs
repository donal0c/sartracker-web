'use strict'

/** Prepared statements keyed by their database handle, dropped with it. */
const statementsByDatabase = new WeakMap()

/**
 * Returns one reusable prepared statement per database and SQL text. Hot
 * per-write fences call this instead of re-parsing the same SQL on the main
 * thread for every write [DON-310]. A statement still reads current rows and
 * schema on each run; only the parse is shared.
 * @param {{ prepare: (sql: string) => unknown }} database
 * @param {string} sql
 * @returns {any}
 */
function prepareCached(database, sql) {
  let statements = statementsByDatabase.get(database)
  if (statements === undefined) {
    statements = new Map()
    statementsByDatabase.set(database, statements)
  }
  let statement = statements.get(sql)
  if (statement === undefined) {
    statement = database.prepare(sql)
    statements.set(sql, statement)
  }
  return statement
}

module.exports = { prepareCached }
