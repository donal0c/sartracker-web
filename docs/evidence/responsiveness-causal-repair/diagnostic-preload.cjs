'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { threadId } = require('node:worker_threads')
const inspector = require('node:inspector')
const root = process.env.SAR_CAUSAL_OUTPUT
if (root) {
  fs.mkdirSync(root, { recursive: true })
  const Database = require('better-sqlite3')
  const events = []
  const totals = {}
  const epoch = performance.timeOrigin
  let sequence = 0
  const originalPrepare = Database.prototype.prepare
  const originalExec = Database.prototype.exec
  const originalTransaction = Database.prototype.transaction
  const profileEnabled = process.env.SAR_CAUSAL_PROFILE === '1'
  const session = profileEnabled ? new inspector.Session() : null
  if (session) {
    session.connect()
    session.post('Profiler.enable')
    session.post('Profiler.setSamplingInterval', { interval: 1000 })
    session.post('Profiler.start')
  }
  /** Records durations without retaining SQL parameters or source data. */
  function measure(label, callback) {
    const start = performance.now()
    const cpu = process.cpuUsage()
    const usage = process.resourceUsage()
    let outcome = 'ok'
    try { return callback() } catch (error) { outcome = error.code || error.name; throw error }
    finally {
      const end = performance.now()
      const spent = process.cpuUsage(cpu)
      const after = process.resourceUsage()
      const wall = end - start
      const total = totals[label] ||= { count: 0, wallMs: 0, maxMs: 0 }
      total.count++; total.wallMs += wall; total.maxMs = Math.max(total.maxMs, wall)
      if (wall >= 10 || outcome !== 'ok') {
        events.push({ sequence: sequence++, label, start, end, wall, cpuMs: (spent.user + spent.system) / 1000,
          voluntary: after.voluntaryContextSwitches - usage.voluntaryContextSwitches,
          involuntary: after.involuntaryContextSwitches - usage.involuntaryContextSwitches, outcome })
        if (events.length > 2000) events.shift()
      }
    }
  }
  Database.prototype.prepare = function(sql) {
    const statement = originalPrepare.call(this, sql)
    const label = sql.trim().replace(/\s+/g, ' ').slice(0, 110)
    for (const method of ['run', 'get', 'all']) {
      const original = statement[method]
      statement[method] = function(...args) { return measure(`${method}:${label}`, () => original.apply(this, args)) }
    }
    return statement
  }
  Database.prototype.exec = function(sql) { return measure(`exec:${sql.trim().slice(0, 80)}`, () => originalExec.call(this, sql)) }
  Database.prototype.transaction = function(callback) {
    const transaction = originalTransaction.call(this, callback)
    const wrapped = function(...args) { return measure('transaction:deferred', () => transaction.apply(this, args)) }
    for (const mode of ['deferred', 'immediate', 'exclusive']) {
      wrapped[mode] = function(...args) { return measure(`transaction:${mode}`, () => transaction[mode].apply(this, args)) }
    }
    return wrapped
  }
  /** Flushes evidence only after execution; no observer file I/O occurs within the timed gate. */
  function flush() {
    const stem = path.join(root, `${process.pid}-${threadId}`)
    fs.writeFileSync(`${stem}.json`, JSON.stringify({ pid: process.pid, threadId, epoch, profileEnabled, events, totals }))
    if (session) session.post('Profiler.stop', (error, result) => {
      if (error) fs.writeFileSync(`${stem}.profile-error.txt`, String(error))
      else fs.writeFileSync(`${stem}.cpuprofile`, JSON.stringify(result.profile))
      session.disconnect()
    })
  }
  module.exports = { flush }
  process.once('exit', flush)
}
