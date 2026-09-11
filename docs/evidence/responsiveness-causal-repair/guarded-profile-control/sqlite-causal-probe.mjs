/** Diagnostic-only native boundaries. No parameters, result rows or disk writes are retained. */
export function installSQLiteCausalProbe(windowMs = 55000) {
  if (globalThis.__SARTRACKER_SQLITE_CAUSAL_PROBE__) return { alreadyInstalled: true }
  const packagePath = process.env.SAR_SQLITE_DIAGNOSTIC_PACKAGE
    ?? `${process.resourcesPath}/app.asar/package.json`
  const require = process.getBuiltinModule('module').createRequire(packagePath)
  const Database = require('better-sqlite3')
  const inspection = new Database(':memory:')
  const statementPrototype = Object.getPrototypeOf(inspection.prepare('SELECT 1'))
  inspection.close()
  const originalTransaction = Database.prototype.transaction
  const originals = Object.fromEntries(['run', 'all', 'get'].map((method) => [method, statementPrototype[method]]))
  const statementMetadata = new WeakMap()
  const queryTotals = new Map()
  const transactions = []
  const slowReads = []
  let currentTransaction = null
  let transactionCount = 0
  let completedTransactionCount = 0
  let droppedTransactions = 0
  let droppedSlowReads = 0
  let slowReadCount = 0
  let stoppedAtMs = null
  let stopTimer = null
  const startedAtMs = performance.now()

  /** Caches only a bounded SQL template, removing literal values and never reading bindings. */
  function metadata(statement) {
    let value = statementMetadata.get(statement)
    if (value) return value
    const template = String(statement.source ?? '').replace(/'(?:''|[^'])*'/gu, '?')
      .replace(/\b\d+(?:\.\d+)?\b/gu, '?').replace(/\s+/gu, ' ').trim().slice(0, 400)
    value = {
      template,
      positionInsert: /^INSERT(?: OR \w+)? INTO positions\b/iu.test(template),
      deviceUpdate: /^UPDATE devices\b/iu.test(template),
      coverageWrite: /^(?:INSERT|UPDATE|DELETE)\b/iu.test(template) && /\bcoverage_\w*/iu.test(template),
    }
    statementMetadata.set(statement, value)
    return value
  }

  // Count write shapes cheaply; native commit time is covered by the outer wrapper.
  statementPrototype.run = function (...args) {
    if (stoppedAtMs === null && currentTransaction !== null) {
      const info = metadata(this)
      if (info.positionInsert) currentTransaction.positionInsertCalls += 1
      if (info.deviceUpdate) currentTransaction.deviceUpdateCalls += 1
      if (info.coverageWrite) currentTransaction.coverageWriteCalls += 1
    }
    return originals.run.apply(this, args)
  }
  for (const method of ['all', 'get']) {
    statementPrototype[method] = function (...args) {
      if (stoppedAtMs !== null) return originals[method].apply(this, args)
      const info = metadata(this)
      const startMs = performance.now()
      try { return originals[method].apply(this, args) }
      finally {
        const endMs = performance.now()
        const elapsedMs = endMs - startMs
        const key = `${method}:${info.template}`
        if (!queryTotals.has(key) && queryTotals.size < 256) {
          queryTotals.set(key, { method, template: info.template, count: 0, totalMs: 0, maximumMs: 0 })
        }
        const total = queryTotals.get(key)
        if (total) { total.count += 1; total.totalMs += elapsedMs; total.maximumMs = Math.max(total.maximumMs, elapsedMs) }
        if (currentTransaction) {
          currentTransaction.statementReadCount += 1
          currentTransaction.statementReadMs += elapsedMs
        }
        if (elapsedMs >= 5) {
          slowReads.push({ sequence: ++slowReadCount, method, template: info.template, startMs, endMs,
            transactionId: currentTransaction?.id ?? null })
          if (slowReads.length > 1024) { slowReads.shift(); droppedSlowReads += 1 }
        }
      }
    }
  }

  Database.prototype.transaction = function (callback) {
    const database = this
    let active = null
    const original = originalTransaction.call(database, function (...args) {
      if (active) active.callbackStartMs = performance.now()
      try { return callback.apply(this, args) }
      finally { if (active) active.callbackEndMs = performance.now() }
    })
    const modes = {}
    for (const mode of ['default', 'deferred', 'immediate', 'exclusive']) {
      modes[mode] = function (...args) {
        if (stoppedAtMs !== null || database.inTransaction) return original[mode].apply(this, args)
        const previous = currentTransaction
        const row = { id: ++transactionCount, mode, startMs: performance.now(),
          callbackStartMs: null, callbackEndMs: null, endMs: null, outcome: 'ok',
          parentId: previous?.id ?? null, positionInsertCalls: 0, deviceUpdateCalls: 0,
          coverageWriteCalls: 0, statementReadCount: 0, statementReadMs: 0 }
        currentTransaction = row
        active = row
        try { return original[mode].apply(this, args) }
        catch (error) { row.outcome = String(error.code ?? error.name).slice(0, 80); throw error }
        finally {
          row.endMs = performance.now()
          row.completionSequence = ++completedTransactionCount
          active = null
          currentTransaction = previous
          transactions.push(row)
          if (transactions.length > 4096) { transactions.shift(); droppedTransactions += 1 }
        }
      }
    }
    const properties = Object.fromEntries(Object.entries(modes).map(([name, value]) => [name, { value }]))
    properties.database = { value: database, enumerable: true }
    for (const method of Object.values(modes)) Object.defineProperties(method, properties)
    return modes.default
  }

  globalThis.__SARTRACKER_SQLITE_CAUSAL_PROBE__ = {
    snapshot: (afterTransactionSequence = 0, afterReadSequence = 0) => ({ timeOriginMs: performance.timeOrigin, startedAtMs, stoppedAtMs,
      sampledAtMs: performance.now(), transactionCount, completedTransactionCount, slowReadCount, droppedTransactions, droppedSlowReads,
      transactions: transactions.filter((row) => row.completionSequence > afterTransactionSequence),
      slowReads: slowReads.filter((row) => row.sequence > afterReadSequence), queryTotals: [...queryTotals.values()],
      limits: { transactions: 4096, slowReads: 1024, slowReadThresholdMs: 5, queryTemplates: 256 },
      limitations: ['Diagnostic wrapper overhead is included; this is not qualification evidence.',
        'Only transactions created after installation are wrapped; iterators and native internal SQL are not timed as reads.',
        'Worker threads use separate prototypes; their SQL is intentionally excluded.'] }),
    stop() {
      if (stoppedAtMs === null) {
        stoppedAtMs = performance.now()
        clearTimeout(stopTimer)
        Database.prototype.transaction = originalTransaction
        for (const method of Object.keys(originals)) statementPrototype[method] = originals[method]
      }
      return this.snapshot()
    },
  }
  stopTimer = setTimeout(() => globalThis.__SARTRACKER_SQLITE_CAUSAL_PROBE__.stop(), windowMs)
  stopTimer.unref?.()
  return { installed: true, startedAtMs, timeOriginMs: performance.timeOrigin }
}
