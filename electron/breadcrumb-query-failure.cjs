'use strict'

const MESSAGES = Object.freeze({
  MEMORY: 'Saved breadcrumb history exceeded available worker memory. Close unused applications and retry.',
  MODULE: 'The saved-history worker could not load a required application component. Restart or reinstall the application.',
  STORAGE: 'Saved breadcrumb history could not be read from mission storage. Retry; if it persists, contact support before changing mission files.',
  WORKER: 'Saved breadcrumb history could not be loaded. Retry; if it persists, restart the application.',
  INACTIVITY: 'Breadcrumb query session timed out while waiting for progress. Retry loading saved history.',
  ABSOLUTE: 'Breadcrumb query reached its absolute session time limit. Retry loading saved history.',
  EXIT_GRACE: 'Breadcrumb query worker did not exit within its completion grace period. Retry loading saved history.',
})

/** Creates the single public error representation without private native details. */
function createBreadcrumbQueryFailure(category) {
  const safeCategory = Object.hasOwn(MESSAGES, category) ? category : 'WORKER'
  const error = new Error(MESSAGES[safeCategory])
  error.code = `BREADCRUMB_QUERY_${safeCategory}`
  // Public diagnostics may serialize non-enumerable fields, including stack.
  error.stack = `Error: ${error.message}`
  return error
}

/** Preserves known categories and classifies private failures without echoing them. */
function sanitizeBreadcrumbQueryFailure(failure) {
  const code = String(failure?.code ?? '')
  const knownCategory = code.startsWith('BREADCRUMB_QUERY_') ? code.slice('BREADCRUMB_QUERY_'.length) : ''
  if (Object.hasOwn(MESSAGES, knownCategory)) return createBreadcrumbQueryFailure(knownCategory)
  const detail = `${code} ${String(failure?.name ?? '')} ${String(failure?.message ?? '')}`
  if (/ERR_WORKER_OUT_OF_MEMORY|out of memory|heap limit/i.test(detail)) return createBreadcrumbQueryFailure('MEMORY')
  if (/MODULE_NOT_FOUND|ERR_WORKER_PATH|ERR_DLOPEN_FAILED|Cannot find module|NODE_MODULE_VERSION|dlopen/i.test(detail)) {
    return createBreadcrumbQueryFailure('MODULE')
  }
  if (/SQLITE_|SqliteError|unable to open database|database disk image/i.test(detail)) return createBreadcrumbQueryFailure('STORAGE')
  return createBreadcrumbQueryFailure('WORKER')
}

module.exports = { createBreadcrumbQueryFailure, sanitizeBreadcrumbQueryFailure }
