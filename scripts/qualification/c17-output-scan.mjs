import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import path from 'node:path'

export const C17_OUTPUT_BYTE_LIMIT = 1_048_576
export const C17_OUTPUT_SCAN_IDENTITY_SCHEMA = 'sartracker-c17-output-scan-identity-v1'

/** Read one regular output file without allocating or scanning beyond the C17 byte limit. */
export function scanC17OutputFileSync(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.resolve(filePath) !== filePath) {
    return failedScan('non-canonical-path')
  }

  let descriptor
  try {
    const pathStat = lstatSync(filePath)
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) return failedScan('not-regular-file')

    const noFollow = constants.O_NOFOLLOW ?? 0
    descriptor = openSync(filePath, constants.O_RDONLY | noFollow)
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.dev !== pathStat.dev || before.ino !== pathStat.ino) {
      return failedScan('file-identity-changed', before.size)
    }
    if (before.size > C17_OUTPUT_BYTE_LIMIT) return failedScan('output-over-limit', before.size)

    const buffer = Buffer.alloc(C17_OUTPUT_BYTE_LIMIT + 1)
    let bytesScanned = 0
    while (bytesScanned < buffer.byteLength) {
      const count = readSync(descriptor, buffer, bytesScanned, buffer.byteLength - bytesScanned, bytesScanned)
      if (count === 0) break
      bytesScanned += count
    }

    const after = fstatSync(descriptor)
    if (!after.isFile() || before.size !== after.size || bytesScanned !== after.size) {
      return failedScan('file-changed-during-scan', after.size, bytesScanned)
    }
    if (bytesScanned > C17_OUTPUT_BYTE_LIMIT) {
      return failedScan('output-over-limit', after.size, bytesScanned)
    }

    const bytes = buffer.subarray(0, bytesScanned)
    return Object.freeze({
      complete: true,
      withinLimit: true,
      byteLength: bytes.byteLength,
      bytesScanned,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
      failureCode: null,
    })
  } catch {
    return failedScan('unavailable-or-unreadable')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // The scan result is already fail-closed; close errors add no safe evidence.
      }
    }
  }
}

/** Bind an output scan and its retained copy to one source head and packaged app. */
export function buildC17OutputScanIdentity({
  sourceHead,
  appSha256,
  exportedPath,
  retainedOutputPath,
  outputScan,
  retainedScan,
}) {
  const outputComplete = outputScan?.complete === true && outputScan.withinLimit === true
  const retainedComplete = retainedScan?.complete === true && retainedScan.withinLimit === true
  const exactBytesMatch = outputComplete && retainedComplete
    && outputScan.bytes.equals(retainedScan.bytes)

  return Object.freeze({
    schema: C17_OUTPUT_SCAN_IDENTITY_SCHEMA,
    sourceHead,
    appSha256,
    exportedPath,
    retainedOutputPath,
    scanLimitBytes: C17_OUTPUT_BYTE_LIMIT,
    outputScanComplete: outputComplete,
    outputBytesScanned: outputScan?.bytesScanned ?? 0,
    outputByteLength: outputScan?.byteLength ?? null,
    outputSha256: outputScan?.sha256 ?? null,
    retainedScanComplete: retainedComplete,
    retainedBytesScanned: retainedScan?.bytesScanned ?? 0,
    retainedOutputByteLength: retainedScan?.byteLength ?? null,
    retainedOutputSha256: retainedScan?.sha256 ?? null,
    exactBytesMatch,
  })
}

/** Build a bounded failure result without retaining bytes or exposing file contents. */
function failedScan(failureCode, byteLength = null, bytesScanned = 0) {
  return Object.freeze({
    complete: false,
    withinLimit: false,
    byteLength: Number.isSafeInteger(byteLength) && byteLength >= 0 ? byteLength : null,
    bytesScanned: Number.isSafeInteger(bytesScanned) && bytesScanned >= 0 ? bytesScanned : 0,
    sha256: null,
    bytes: null,
    failureCode,
  })
}
