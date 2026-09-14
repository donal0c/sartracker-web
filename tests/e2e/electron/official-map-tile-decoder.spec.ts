import { _electron as electron, expect, test } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { LEGACY_NO_COVERAGE_TILE_BASE64: legacyNoCoverageTileBase64 } = require(
  '../../../tests/fixtures/legacy-official-map-no-coverage-hatch.cjs',
) as { readonly LEGACY_NO_COVERAGE_TILE_BASE64: string }
const { NO_COVERAGE_TILE_BASE64: repairedNoCoverageTileBase64 } = require(
  '../../../electron/official-map-no-coverage.cjs',
) as { readonly NO_COVERAGE_TILE_BASE64: string }

test('uses Electron nativeImage to reject the legacy hatch and accept the repaired opaque tile', async () => {
  const decoderPath = path.resolve('electron/official-map-tile-decoder.cjs')
  const app = await electron.launch({
    args: ['tests/fixtures/native-image-decoder.cjs'],
    env: { ...process.env, SARTRACKER_DECODER_PATH: decoderPath },
  })
  const child = app.process()
  console.log(`Electron child PID=${child.pid ?? 'unknown'}`)
  const exitPromise = waitForProcessExit(child)
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.waitForSelector('[data-testid="native-image-decoder-ready"]')

    const result = await app.evaluate(
      ({ nativeImage }, input) => {
        const { decodeOfficialMapTile } = globalThis.__SARTRACKER_NATIVE_IMAGE_DECODER__
        const decode = (base64: string) =>
          decodeOfficialMapTile(Buffer.from(base64, 'base64'), 'png', nativeImage)
        return {
          nativeImageAvailable: typeof nativeImage?.createFromBuffer === 'function',
          legacyAccepted: decode(input.legacyTile),
          repairedAccepted: decode(input.repairedTile),
          repairedSize: nativeImage.createFromBuffer(Buffer.from(input.repairedTile, 'base64')).getSize(),
        }
      },
      {
        legacyTile: legacyNoCoverageTileBase64,
        repairedTile: repairedNoCoverageTileBase64,
      },
    )

    expect(result).toEqual({
      nativeImageAvailable: true,
      legacyAccepted: false,
      repairedAccepted: true,
      repairedSize: { width: 256, height: 256 },
    })
  } finally {
    await withTimeout(app.close(), 5000, 'Electron app.close() did not complete cleanly.')
    const exit = await withTimeout(exitPromise, 5000, 'Electron process did not exit after app.close().')
    console.log(`Electron child exit code=${exit.code ?? 'null'} signal=${exit.signal ?? 'null'}`)
    expect(exit.signal, `Electron exited by signal ${exit.signal ?? 'unknown'}.`).toBeNull()
    expect(exit.code, `Electron exited with code ${exit.code ?? 'unknown'}.`).toBe(0)
  }
})

/** Captures the Electron child exit independently from Playwright's app close promise. */
function waitForProcessExit(child: ChildProcess) {
  return new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

/** Rejects when teardown does not complete within the bounded smoke-test window. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
