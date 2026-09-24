import { createHash } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  C17_OUTPUT_BYTE_LIMIT,
  buildC17OutputScanIdentity,
  scanC17OutputFileSync,
} from '../../scripts/qualification/c17-output-scan.mjs'
import { C17_OUTPUT_SCAN_SOURCE_TEST_NAME } from '../../scripts/qualification/c17-adversarial-corpus.mjs'

const evidenceRoots: string[] = []

/** Create a private temporary evidence directory for one scanner test. */
function makeEvidenceRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sartracker-c17-output-scan-'))
  evidenceRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of evidenceRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('C17 bounded output scan identity [DON-254]', () => {
  it(C17_OUTPUT_SCAN_SOURCE_TEST_NAME, () => {
    const root = makeEvidenceRoot()
    const outputPath = path.join(root, 'export.txt')
    const retainedPath = path.join(root, 'retained.txt')
    const outputBytes = Buffer.from('C17 positive output control\n', 'utf8')
    writeFileSync(outputPath, outputBytes, { mode: 0o600 })
    writeFileSync(retainedPath, outputBytes, { mode: 0o600 })

    const outputScan = scanC17OutputFileSync(outputPath)
    const retainedScan = scanC17OutputFileSync(retainedPath)
    expect(outputScan).toMatchObject({
      complete: true,
      withinLimit: true,
      byteLength: outputBytes.byteLength,
      bytesScanned: outputBytes.byteLength,
      sha256: createHash('sha256').update(outputBytes).digest('hex'),
      failureCode: null,
    })

    const identity = buildC17OutputScanIdentity({
      sourceHead: 'a'.repeat(40),
      appSha256: 'b'.repeat(64),
      exportedPath: outputPath,
      retainedOutputPath: retainedPath,
      outputScan,
      retainedScan,
    })
    expect(identity).toMatchObject({
      scanLimitBytes: C17_OUTPUT_BYTE_LIMIT,
      outputScanComplete: true,
      retainedScanComplete: true,
      exactBytesMatch: true,
      outputSha256: retainedScan.sha256,
      retainedOutputSha256: outputScan.sha256,
      outputByteLength: outputBytes.byteLength,
      retainedOutputByteLength: outputBytes.byteLength,
    })

    writeFileSync(retainedPath, Buffer.concat([outputBytes, Buffer.from('changed')]), { mode: 0o600 })
    const mismatchedIdentity = buildC17OutputScanIdentity({
      sourceHead: 'a'.repeat(40),
      appSha256: 'b'.repeat(64),
      exportedPath: outputPath,
      retainedOutputPath: retainedPath,
      outputScan,
      retainedScan: scanC17OutputFileSync(retainedPath),
    })
    expect(mismatchedIdentity.exactBytesMatch).toBe(false)
  })

  it('rejects oversized and symbolic-link output before scanning content', () => {
    const root = makeEvidenceRoot()
    const oversizedPath = path.join(root, 'oversized.txt')
    const linkedPath = path.join(root, 'linked.txt')
    const targetPath = path.join(root, 'target.txt')
    const oversizedDescriptor = openSync(oversizedPath, 'w', 0o600)
    closeSync(oversizedDescriptor)
    truncateSync(oversizedPath, C17_OUTPUT_BYTE_LIMIT + 1)
    writeFileSync(targetPath, 'not a direct evidence file', { mode: 0o600 })
    symlinkSync(targetPath, linkedPath)

    expect(scanC17OutputFileSync(oversizedPath)).toMatchObject({
      complete: false,
      withinLimit: false,
      byteLength: C17_OUTPUT_BYTE_LIMIT + 1,
      bytesScanned: 0,
      sha256: null,
      failureCode: 'output-over-limit',
    })
    expect(scanC17OutputFileSync(linkedPath)).toMatchObject({
      complete: false,
      withinLimit: false,
      sha256: null,
      failureCode: 'not-regular-file',
    })
  })
})
