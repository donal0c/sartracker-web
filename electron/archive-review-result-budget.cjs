'use strict'

const MAX_ARCHIVE_REVIEW_RESULT_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_REVIEW_RESULT_ROWS = 100_000

/** Stable failure for an unsafe or oversized worker result. */
class ArchiveReviewResultBudgetError extends Error {
  /** Creates a non-reflective result-boundary failure. */
  constructor(message = 'Archive review result exceeds the 8 MiB output limit.') {
    super(message)
    this.name = 'ArchiveReviewResultBudgetError'
    this.code = 'ARCHIVE_REVIEW_RESULT_INVALID'
  }
}

/** Adds exact JSON bytes and stops before the result can cross the worker boundary. */
function addJsonBytes(budget, count) {
  budget.bytes += count
  if (budget.bytes > MAX_ARCHIVE_REVIEW_RESULT_BYTES) {
    throw new ArchiveReviewResultBudgetError()
  }
}

/** Counts one JSON string exactly, including escaping and lone-surrogate replacement. */
function countJsonStringBytes(value, budget) {
  addJsonBytes(budget, 2)
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit === 0x22 || codeUnit === 0x5c
      || codeUnit === 0x08 || codeUnit === 0x09 || codeUnit === 0x0a
      || codeUnit === 0x0c || codeUnit === 0x0d) {
      addJsonBytes(budget, 2)
    } else if (codeUnit <= 0x1f) {
      addJsonBytes(budget, 6)
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        addJsonBytes(budget, 4)
        index += 1
      } else {
        addJsonBytes(budget, 6)
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      addJsonBytes(budget, 6)
    } else if (codeUnit <= 0x7f) {
      addJsonBytes(budget, 1)
    } else if (codeUnit <= 0x7ff) {
      addJsonBytes(budget, 2)
    } else {
      addJsonBytes(budget, 3)
    }
  }
}

/** Validates and exactly sizes one closed JSON value without serializing it. */
function countSafeJsonValue(value, budget, seen, depth = 0) {
  if (depth > 32) throw new ArchiveReviewResultBudgetError('Archive review result is invalid.')
  if (value === null) {
    addJsonBytes(budget, 4)
    return
  }
  if (typeof value === 'boolean') {
    addJsonBytes(budget, value ? 4 : 5)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ArchiveReviewResultBudgetError('Archive review result is invalid.')
    }
    addJsonBytes(budget, JSON.stringify(value).length)
    return
  }
  if (typeof value === 'string') {
    countJsonStringBytes(value, budget)
    return
  }
  if (Array.isArray(value)) {
    if (seen.has(value) || value.length > MAX_ARCHIVE_REVIEW_RESULT_ROWS) {
      throw new ArchiveReviewResultBudgetError('Archive review result is invalid.')
    }
    seen.add(value)
    addJsonBytes(budget, 2 + Math.max(0, value.length - 1))
    for (const entry of value) countSafeJsonValue(entry, budget, seen, depth + 1)
    seen.delete(value)
    return
  }
  if (typeof value !== 'object'
    || seen.has(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ArchiveReviewResultBudgetError('Archive review result is invalid.')
  }
  const entries = Object.entries(value)
  if (entries.length > 100) {
    throw new ArchiveReviewResultBudgetError('Archive review result is invalid.')
  }
  seen.add(value)
  addJsonBytes(budget, 2 + Math.max(0, entries.length - 1) + entries.length)
  for (const [key, child] of entries) {
    if (key.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new ArchiveReviewResultBudgetError('Archive review result is invalid.')
    }
    countJsonStringBytes(key, budget)
    countSafeJsonValue(child, budget, seen, depth + 1)
  }
  seen.delete(value)
}

/** Returns the exact UTF-8 JSON size after validating the closed result shape. */
function assertArchiveReviewResultBudget(value) {
  const budget = { bytes: 0 }
  countSafeJsonValue(value, budget, new Set())
  return budget.bytes
}

module.exports = {
  ArchiveReviewResultBudgetError,
  MAX_ARCHIVE_REVIEW_RESULT_BYTES,
  MAX_ARCHIVE_REVIEW_RESULT_ROWS,
  assertArchiveReviewResultBudget,
}
