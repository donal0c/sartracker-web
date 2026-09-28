import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminIdentityField } from '../../src/components/admin-identity-field'
import type { AdminRosterStatus } from '../../src/features/mission/use-governance-admin-roster'

describe('AdminIdentityField [DON-281]', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('offers the Settings route only once the roster has loaded empty', () => {
    const onOpen = vi.fn()
    render({ rosterStatus: 'ready', adminRoster: [], onOpen })
    const notice = query('admin-roster-empty-notice')
    expect(notice?.textContent).toContain('No Admin Roster members are configured')
    expect(notice?.textContent).toContain('Settings → Mission Defaults → Admin roster')
    expect(select().disabled).toBe(true)
    expect(select().textContent).toBe('No admins configured')

    act(() => (query('admin-roster-open-settings') as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it.each<[AdminRosterStatus, string]>([
    ['loading', 'Loading admin roster…'],
    ['idle', 'Loading admin roster…'],
    ['error', 'Admin roster unavailable'],
  ])('never presents a %s roster as "no admins configured"', (rosterStatus, label) => {
    render({ rosterStatus, adminRoster: [] })
    expect(select().textContent).toBe(label)
    expect(query('admin-roster-empty-notice')).toBeNull()
  })

  it('disables the Settings route while a governance action is in flight', () => {
    const onOpen = vi.fn()
    render({ rosterStatus: 'ready', adminRoster: [], governanceBusy: true, onOpen })
    const button = query('admin-roster-open-settings') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('shows configured admins without the empty-roster route', () => {
    render({ rosterStatus: 'ready', adminRoster: ['Ops Lead', 'Incident Controller'], selectedAdmin: 'Ops Lead' })
    expect(select().disabled).toBe(false)
    expect(select().value).toBe('Ops Lead')
    expect([...select().options].map((option) => option.value)).toEqual(['Ops Lead', 'Incident Controller'])
    expect(query('admin-roster-empty-notice')).toBeNull()
  })

  function render(options: {
    readonly rosterStatus: AdminRosterStatus
    readonly adminRoster: readonly string[]
    readonly selectedAdmin?: string
    readonly governanceBusy?: boolean
    readonly onOpen?: () => void
  }): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(
        <AdminIdentityField
          adminRoster={options.adminRoster}
          governanceBusy={options.governanceBusy ?? false}
          onOpenAdminRosterSettings={options.onOpen ?? (() => undefined)}
          rosterStatus={options.rosterStatus}
          selectedAdmin={options.selectedAdmin ?? ''}
          setSelectedAdmin={() => undefined}
          testId="identity"
        />,
      )
    })
  }

  function query(testId: string): Element | null {
    return host?.querySelector(`[data-testid="${testId}"]`) ?? null
  }

  function select(): HTMLSelectElement {
    return query('identity') as HTMLSelectElement
  }
})
