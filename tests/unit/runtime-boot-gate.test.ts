import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommandMast, RuntimeBootGate, RuntimeSafetyBanner } from '../../src/App'
import { useAutosaveStatusStore } from '../../src/features/persistence/autosave-status-store'
import { runtimeFaultReloadTarget } from '../../src/features/runtime/runtime-fault-reload'

describe('RuntimeBootGate', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    useAutosaveStatusStore.getState().reset()
  })

  it('surfaces an autosave warning in the command mast when backup sync is failing', () => {
    useAutosaveStatusStore.getState().markSyncFailed({
      reason: 'mission-finish',
      message: 'disk full',
      now: new Date('2026-05-16T09:00:00.000Z'),
    })

    render(
      React.createElement(CommandMast, {
        status: 'ready',
        runtimeMode: 'electron',
        onOpenDiagnostics: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    )

    const warning = document.querySelector('[data-testid="autosave-warning"]')
    expect(warning).not.toBeNull()
    expect(warning?.textContent).toContain('Autosave warning')
    expect(warning?.getAttribute('title')).toContain('Autosave failing')
    expect(warning?.getAttribute('aria-label')).toContain('Autosave failing')
    expect(warning?.getAttribute('role')).toBe('status')
  })

  it('labels hosted browser mode as session-only testing instead of green operational readiness', () => {
    render(
      React.createElement(CommandMast, {
        status: 'ready',
        runtimeMode: 'hosted-browser',
        onOpenDiagnostics: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    )

    expect(document.querySelector('[data-testid="system-status-value"]')?.textContent).toBe(
      'Browser test',
    )
    expect(document.querySelector('[data-testid="system-status-detail"]')?.textContent).toBe(
      'Session storage only',
    )
    expect(document.querySelector('[data-testid="system-status-value"]')?.className).toContain(
      'text-amber-300',
    )
  })

  it('surfaces lifecycle backup failures as a persistent alert outside the mast', () => {
    useAutosaveStatusStore.getState().markSyncFailed({
      reason: 'mission-finish',
      message: 'backup volume unavailable',
      now: new Date('2026-05-16T09:00:00.000Z'),
    })

    render(
      React.createElement(RuntimeSafetyBanner, {
        browserTestingMode: false,
        focusModeActive: false,
      }),
    )

    const alert = document.querySelector('[data-testid="lifecycle-backup-failure-banner"]')
    expect(alert).not.toBeNull()
    expect(alert?.getAttribute('role')).toBe('alert')
    expect(alert?.textContent).toContain('Lifecycle backup failed')
    expect(alert?.textContent).toContain('mission finish')
    expect(alert?.textContent).toContain('backup volume unavailable')
    expect(alert?.querySelector('button')).toBeNull()
  })

  it('shows a calm preparing state during runtime startup', () => {
    render(
      React.createElement(RuntimeBootGate, {
        phase: 'booting',
        error: null,
        onReload: vi.fn(),
      }),
    )

    expect(document.querySelector('[data-testid="runtime-booting-shell"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Preparing operational runtime')
    expect(document.body.textContent).toContain('Loading mission, tracking, and map services...')
  })

  it('shows the startup fault and reload action when boot fails', () => {
    const onReload = vi.fn()

    render(
      React.createElement(RuntimeBootGate, {
        phase: 'failed',
        error: 'SQLite mission store unavailable.',
        onReload,
      }),
    )

    const button = document.querySelector('button')
    expect(document.querySelector('[data-testid="runtime-failed-shell"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Runtime startup failed')
    expect(document.body.textContent).toContain('SQLite mission store unavailable.')
    expect(document.body.textContent).toContain('copy or screenshot this fault message')
    expect(button?.textContent).toContain('Reload clean runtime')
    expect(document.activeElement).toBe(button)
    expect(document.querySelector('[aria-live="assertive"]')).not.toBeNull()
    button?.click()
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('builds a clean fault reload URL without browser harness flags', () => {
    expect(
      runtimeFaultReloadTarget(
        'https://sartracker.example/app/?missionHarness=1&liveTracking=1#fault',
      ),
    ).toBe('https://sartracker.example/app/')
  })

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})
