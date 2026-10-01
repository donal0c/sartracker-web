import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import type { CrashRecoveryState } from '../../src/types/electron-bridge'

const fake = vi.hoisted(() => ({
  crashState: { uncleanShutdown: true, lastCrash: null } as CrashRecoveryState,
}))
vi.mock('../../src/infrastructure/support-report/tauri-support-report-store', () => ({
  readCrashRecoveryState: async () => fake.crashState,
}))

import { DiagnosticsWorkspace } from '../../src/components/diagnostics-workspace'
import { useDiagnosticsStore } from '../../src/features/diagnostics/diagnostics-store'
import { useDiagnosticsWorkspaceStore } from '../../src/features/diagnostics/diagnostics-workspace-store'

let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.() })

/** Opens Diagnostics with a stub controller and the given previous-session state. */
async function openDiagnostics(state: CrashRecoveryState) {
  fake.crashState = state
  useDiagnosticsStore.setState({ controller: { load: async () => undefined } as never })
  useDiagnosticsWorkspaceStore.setState({ open: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<DiagnosticsWorkspace />))
  await act(async () => undefined)
  return document.body
}

it('uses the agreed wording after a genuine unexpected shutdown [DON-284]', async () => {
  const body = await openDiagnostics({ uncleanShutdown: true, lastCrash: null })

  const notice = body.querySelector('[data-testid="diagnostics-crash-recovery-notice"]')
  expect(notice?.textContent).toContain(
    'SAR Tracker did not close normally last time. Saved mission data is intact; anything still being written in the last moments may be missing. Check the most recent trails and notes.',
  )
  expect(notice?.textContent).not.toMatch(/was lost/iu)
})

it('shows no shutdown notice after a clean quit [DON-284]', async () => {
  const body = await openDiagnostics({ uncleanShutdown: false, lastCrash: null })

  expect(body.querySelector('[data-testid="diagnostics-crash-recovery-notice"]')).toBeNull()
})
