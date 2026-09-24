import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  C01_STORE_LOCK_READY_TIMEOUT_MS,
  waitForOwnedProcessExitAfterDialog,
} from '../../scripts/qualification/startup-probe.mjs'
import {
  C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS,
  C01_HELD_GATE_TIMEOUT_MS,
} from '../../scripts/qualification/startup-receipts.mjs'

describe('C01 held-gate product exit observation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps lock-holder readiness and product-exit observation budgets independent', () => {
    expect(C01_STORE_LOCK_READY_TIMEOUT_MS).toBe(5_000)
    expect(C01_HELD_GATE_TIMEOUT_MS).toBe(20_000)
    expect(C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS).toBe(12_000)
  })

  it('measures the application exit after dialog dismissal', async () => {
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null })
    const dismissDialog = vi.fn(async () => undefined)
    let monotonicNow = 100
    const exitObservation = waitForOwnedProcessExitAfterDialog(
      child, 12_000, dismissDialog, () => monotonicNow,
    )

    await vi.advanceTimersByTimeAsync(275)
    monotonicNow += 275
    child.exitCode = 1
    child.emit('exit', 1, null)

    await expect(exitObservation).resolves.toEqual({
      code: 1,
      signal: null,
      elapsedMs: 275,
    })
    expect(dismissDialog).toHaveBeenCalledOnce()
  })

  it('does not mistake an already-closed harness child for a post-dialog product exit', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null })
    child.exitCode = 0
    const dismissDialog = vi.fn(async () => undefined)

    await expect(waitForOwnedProcessExitAfterDialog(child, 12_000, dismissDialog)).resolves.toBeNull()
    expect(dismissDialog).not.toHaveBeenCalled()
  })

  it('captures the child exit while the dismissal command is completing', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null as NodeJS.Signals | null })
    const dismissDialog = vi.fn(async () => {
      child.exitCode = 1
      child.emit('exit', 1, null)
    })

    await expect(waitForOwnedProcessExitAfterDialog(child, 12_000, dismissDialog)).resolves.toEqual({
      code: 1,
      signal: null,
      elapsedMs: 0,
    })
  })
})
