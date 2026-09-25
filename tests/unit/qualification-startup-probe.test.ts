import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  C01_STORE_LOCK_READY_TIMEOUT_MS,
  boundedX11SearchTimeoutMs,
  runBoundedX11DiagnosticCommand,
  serializeHeldGateObservationError,
  x11ErrorDialogAcknowledgementPoint,
  isWindowInVisibleX11Search,
  isNoVisibleX11WindowSearchResult,
  isSarTrackerStartupWindowClass,
  isStartupDialogWindowName,
  releaseCrashLogWriteHold,
  releaseCrashLogWriteHoldForCleanup,
  startupDialogWindowSearchArguments,
  x11StartupFailureCloseButtonCenter,
  waitForDialogDismissal,
  waitForOwnedProcessOrTimeout,
  waitForOwnedProcessExitAfterDialog,
} from '../../scripts/qualification/startup-probe.mjs'
import {
  C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS,
  C01_HELD_GATE_TIMEOUT_MS,
} from '../../scripts/qualification/startup-receipts.mjs'

describe('C01 held-gate product exit observation', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('releases a held crash-log write even when the product never created crashes/', async () => {
    const profile = mkdtempSync(path.join(os.tmpdir(), 'c01-hold-release-'))
    try {
      const releasePath = path.join(profile, 'crashes', '.c01-crash-write-release')
      await releaseCrashLogWriteHold({ releasePath })
      expect(existsSync(releasePath)).toBe(true)
      await expect(releaseCrashLogWriteHold({ releasePath })).resolves.toBeUndefined()
    } finally {
      rmSync(profile, { force: true, recursive: true })
    }
  })

  it('never lets a failed hold release skip owned-process cleanup', async () => {
    const release = vi.fn(async () => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
    })
    await expect(releaseCrashLogWriteHoldForCleanup({ releasePath: '/x' }, release)).resolves.toBe(false)
    await expect(releaseCrashLogWriteHoldForCleanup({ releasePath: '/x' }, async () => undefined))
      .resolves.toBe(true)
  })

  it('keeps lock-holder readiness and product-exit observation budgets independent', () => {
    expect(C01_STORE_LOCK_READY_TIMEOUT_MS).toBe(5_000)
    expect(C01_HELD_GATE_TIMEOUT_MS).toBe(20_000)
    expect(C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS).toBe(20_000)
  })

  it('confirms the native dialog is no longer visible after the dismissal click', async () => {
    let monotonicNow = 0
    let visibleChecks = 0
    const isDialogVisible = vi.fn(async () => {
      visibleChecks += 1
      return visibleChecks < 2
    })

    await expect(waitForDialogDismissal(isDialogVisible, 100, {
      now: () => monotonicNow,
      wait: async (milliseconds) => { monotonicNow += milliseconds },
    })).resolves.toBe(50)
    expect(isDialogVisible).toHaveBeenCalledTimes(2)
    expect(monotonicNow).toBeGreaterThan(0)
  })

  it('does not report dismissal while the native dialog remains visible', async () => {
    let monotonicNow = 0
    await expect(waitForDialogDismissal(async () => true, 100, {
      now: () => monotonicNow,
      wait: async (milliseconds) => { monotonicNow += milliseconds },
    })).rejects.toThrow('C01 could not confirm the startup error dialog closed after the dismissal click.')
    expect(monotonicNow).toBe(100)
  })

  it('does not accept a hidden-window observation that completes after its deadline', async () => {
    let monotonicNow = 0
    const isDialogVisible = vi.fn(async (timeoutMs: number) => {
      expect(timeoutMs).toBe(100)
      monotonicNow = 101
      return false
    })

    await expect(waitForDialogDismissal(isDialogVisible, 100, {
      now: () => monotonicNow,
    })).rejects.toThrow('C01 could not confirm the startup error dialog closed after the dismissal click.')
    expect(isDialogVisible).toHaveBeenCalledOnce()
  })

  it('recognizes xdotool search exit 1 with no output as no visible dialog', () => {
    expect(isNoVisibleX11WindowSearchResult({ code: 1, stdout: '', stderr: '' })).toBe(true)
    expect(isNoVisibleX11WindowSearchResult({
      code: 1,
      stdout: '',
      stderr: 'X Error: BadWindow during X_QueryTree for a window that closed during the search',
    })).toBe(true)
    expect(isNoVisibleX11WindowSearchResult({ code: 1, stdout: '', stderr: 'Cannot open display' })).toBe(false)
    expect(isNoVisibleX11WindowSearchResult({ code: 0, stdout: '', stderr: '' })).toBe(false)
    expect(isNoVisibleX11WindowSearchResult({
      code: null, signal: 'SIGKILL', killed: true, stdout: '', stderr: '',
    })).toBe(false)
    expect(isNoVisibleX11WindowSearchResult({
      code: null, signal: 'SIGPIPE', killed: true, stdout: '', stderr: '',
    })).toBe(false)
  })

  it('recognizes both pre-readiness and post-readiness startup dialog titles', () => {
    expect(isStartupDialogWindowName('Error')).toBe(true)
    expect(isStartupDialogWindowName('SAR Tracker could not start')).toBe(true)
    expect(isStartupDialogWindowName('SAR Tracker')).toBe(false)
    expect(isStartupDialogWindowName('Other application error')).toBe(false)
  })

  it('recognizes Linux Electron class casing for the SAR Tracker startup window', () => {
    expect(isSarTrackerStartupWindowClass('WM_CLASS(STRING) = "sartracker-web", "sartracker-web"')).toBe(true)
    expect(isSarTrackerStartupWindowClass('WM_CLASS(STRING) = "sartracker-web", "Sartracker-web"')).toBe(true)
    expect(isSarTrackerStartupWindowClass('WM_CLASS(STRING) = "other-app", "Other App"')).toBe(false)
  })

  it('builds a valid visible-window search with both startup fault titles', () => {
    expect(startupDialogWindowSearchArguments()).toEqual([
      'search', '--onlyvisible', '--name', '^(Error|SAR Tracker could not start)$',
    ])
  })

  it.each(['SIGKILL', 'SIGPIPE'])('does not confirm dialog dismissal when the X11 query ends with %s', async (signal) => {
    const queryError = Object.assign(new Error('xdotool query failed'), {
      code: null,
      signal,
      killed: true,
      stdout: '',
      stderr: '',
    })
    const isDialogVisible = vi.fn(async () => { throw queryError })

    await expect(waitForDialogDismissal(isDialogVisible, 100)).rejects.toBe(queryError)
    expect(isDialogVisible).toHaveBeenCalledOnce()
  })

  it('treats an empty successful visibility search as invalid evidence', () => {
    expect(() => isWindowInVisibleX11Search('', '501'))
      .toThrow('C01 X11 visible-window search returned no window IDs.')
    expect(() => isWindowInVisibleX11Search('not-a-window-id', '501'))
      .toThrow('C01 X11 visible-window search returned malformed window IDs.')
    expect(isWindowInVisibleX11Search('501\n', '501')).toBe(true)
    expect(isWindowInVisibleX11Search('502\n', '501')).toBe(false)
  })

  it('uses only the remaining dismissal window for each X11 query', () => {
    expect(boundedX11SearchTimeoutMs(1_750)).toBe(1_750)
    expect(boundedX11SearchTimeoutMs(2_500)).toBe(2_000)
    expect(boundedX11SearchTimeoutMs(0)).toBe(1)
  })

  it('targets the center of the native dialog acknowledgement row for observed Linux sizes', () => {
    expect(x11ErrorDialogAcknowledgementPoint(652, 180)).toEqual({ x: 326, y: 163 })
    expect(x11ErrorDialogAcknowledgementPoint(613, 146)).toEqual({ x: 306, y: 129 })
    expect(() => x11ErrorDialogAcknowledgementPoint(0, 180)).toThrow('C01 refusal dialog geometry is too small.')
    expect(() => x11ErrorDialogAcknowledgementPoint(652, 16)).toThrow('C01 refusal dialog geometry is too small.')
  })

  it('targets the close button in the post-readiness startup fault window', () => {
    expect(x11StartupFailureCloseButtonCenter(620, 360)).toEqual({ x: 310, y: 316 })
    expect(() => x11StartupFailureCloseButtonCenter(0, 360))
      .toThrow('C01 startup fault window geometry is too small.')
  })

  it('bounds diagnostic X11 commands and preserves timeout details without treating them as absence', async () => {
    const queryError = Object.assign(new Error('X11 query timed out'), {
      code: null,
      signal: 'SIGKILL',
      killed: true,
      stdout: '',
      stderr: '',
    })
    const execute = vi.fn(async () => { throw queryError })

    await expect(runBoundedX11DiagnosticCommand(
      'xdotool', startupDialogWindowSearchArguments(), 300, execute,
    )).resolves.toMatchObject({
      command: 'xdotool',
      timeoutMs: 300,
      code: null,
      signal: 'SIGKILL',
      killed: true,
      stdout: '',
      stderr: '',
    })
    expect(execute).toHaveBeenCalledWith(
      'xdotool', startupDialogWindowSearchArguments(),
      { timeout: 300, killSignal: 'SIGKILL' },
    )
  })

  it('retains sanitized command failure details for held-gate diagnosis', () => {
    const error = Object.assign(new Error('Command failed in /tmp/private-profile'), {
      code: 'ETIMEDOUT',
      signal: 'SIGKILL',
      killed: true,
      stdout: 'partial /tmp/private-profile output',
      stderr: 'X server unavailable',
    })

    expect(serializeHeldGateObservationError(error, '/tmp/private-profile')).toEqual({
      message: 'Command failed in [disposable-profile]',
      code: 'ETIMEDOUT',
      signal: 'SIGKILL',
      killed: true,
      stdout: 'partial [disposable-profile] output',
      stderr: 'X server unavailable',
    })
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

  it('uses a monotonic clock for the held-gate response deadline', async () => {
    let monotonicNow = 0.25
    let wallClockNow = 100_000
    vi.spyOn(performance, 'now').mockImplementation(() => monotonicNow)
    vi.spyOn(Date, 'now').mockImplementation(() => wallClockNow)
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
    })

    const observation = await waitForOwnedProcessOrTimeout(child, 20_000, undefined, {
      findDialog: async () => null,
      wait: async (milliseconds) => {
        monotonicNow += milliseconds
        if (monotonicNow === 100.25) wallClockNow -= 15_000
        else wallClockNow += milliseconds
      },
    })

    expect(observation).toEqual({
      timedOut: true,
      elapsedMs: 20_000,
      dialogWindowId: null,
      dialogObservedAtMs: null,
    })
    expect(monotonicNow).toBe(20_000.25)
    expect(Number.isSafeInteger(observation.elapsedMs)).toBe(true)
  })

  it('records fractional monotonic dialog times as integer receipt milliseconds', async () => {
    let monotonicNow = 100.25
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
    })

    const observation = await waitForOwnedProcessOrTimeout(child, 20_000, 100.25, {
      now: () => monotonicNow,
      findDialog: async () => {
        monotonicNow = 1_234.56
        return '501'
      },
    })

    expect(observation).toMatchObject({
      timedOut: false,
      elapsedMs: 1_134,
      dialogWindowId: '501',
      dialogObservedAtMs: 1_134,
    })
    expect(Number.isSafeInteger(observation.dialogObservedAtMs)).toBe(true)
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

  it('measures exit time from the monotonic instant the dialog was confirmed closed', async () => {
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
    })
    let monotonicNow = 120
    const exitObservation = waitForOwnedProcessExitAfterDialog(
      child,
      12_000,
      async () => 100,
      () => monotonicNow,
    )

    await vi.advanceTimersByTimeAsync(250)
    monotonicNow = 350
    child.exitCode = 1
    child.emit('exit', 1, null)

    await expect(exitObservation).resolves.toEqual({
      code: 1,
      signal: null,
      elapsedMs: 250,
    })
  })
})
