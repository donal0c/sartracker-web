import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { DefaultParticipantGroupField } from '../../src/components/default-participant-group-field'

const GROUPS = [
  { group_id: '7', name: 'KMRT', parent_group_id: null },
  { group_id: '9', name: 'Other team', parent_group_id: null },
]
let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.() })

/** Renders the field and returns its select element. */
function mount(props: React.ComponentProps<typeof DefaultParticipantGroupField>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  act(() => root.render(<DefaultParticipantGroupField {...props} />))
  return host
}

it('offers None and each Traccar group, and saves the chosen group with its name [DON-296]', () => {
  const onChange = vi.fn()
  const host = mount({ value: null, groups: GROUPS, onChange })
  const select = host.querySelector<HTMLSelectElement>('[data-testid="settings-default-participant-group"]')!
  expect([...select.options].map((option) => option.textContent)).toEqual(['None (nothing pre-ticked)', 'KMRT', 'Other team'])

  act(() => {
    select.value = '7'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(onChange).toHaveBeenLastCalledWith({ groupId: '7', name: 'KMRT' })

  act(() => {
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(onChange).toHaveBeenLastCalledWith(null)
})

it('keeps a saved group the server no longer lists, and says so [DON-296]', () => {
  const host = mount({ value: { groupId: '3', name: 'Old team' }, groups: GROUPS, onChange: vi.fn() })
  const select = host.querySelector<HTMLSelectElement>('[data-testid="settings-default-participant-group"]')!
  expect(select.value).toBe('3')
  expect(host.textContent).toContain('Old team (not on the tracking server now)')
})

it('explains how to choose when no groups have been read yet [DON-296]', () => {
  const host = mount({ value: null, groups: [], onChange: vi.fn() })
  expect(host.textContent).toContain('Connect to Traccar to list its groups')
})
