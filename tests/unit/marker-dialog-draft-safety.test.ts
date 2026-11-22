import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MarkerDialog } from '../../src/components/marker-dialog'
import { MAX_CASUALTY_TREATMENT_LOG_BYTES } from '../../src/features/markers/marker-draft'
import { useMarkerStore } from '../../src/features/markers/marker-store'
import { casualtyDraft, createMarkerDialogRuntime } from './marker-dialog-runtime-fixture'

const UPDATE = 'Gave 2 puffs salbutamol 14:05'

describe('marker dialog draft safety [DON-348 M-69]', () => {
  let host: HTMLDivElement
  let root: Root
  let runtime: Awaited<ReturnType<typeof createMarkerDialogRuntime>>

  beforeEach(async () => {
    runtime = await createMarkerDialogRuntime()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root.render(React.createElement(MarkerDialog)))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    useMarkerStore.setState(useMarkerStore.getInitialState())
  })

  it('adds a pending treatment update to the real save payload', async () => {
    openCasualty()
    typeUpdate(UPDATE)
    const pendingNote = query('marker-treatment-pending-note')?.textContent

    await act(async () => click('marker-save-btn'))

    expect(runtime.upsertMarker).toHaveBeenCalledOnce()
    expect(runtime.upsertMarker.mock.calls[0]?.[0].treatment).toContain(UPDATE)
    expect(pendingNote).toMatch(/added on Save/i)
    expect(query('marker-dialog')).toBeNull()
  })

  it('starts casualty B with an empty update box after saving casualty A', async () => {
    openCasualty()
    typeUpdate(UPDATE)
    await act(async () => click('marker-save-btn'))

    act(() => runtime.controller.beginCreateFromDraft(casualtyDraft('Casualty B')))

    expect(updateInput().value).toBe('')
    expect(query('marker-treatment-pending-note')).toBeNull()
  })

  it('keeps a pending update intact and refuses persistence when appending exceeds the log budget', async () => {
    act(() => runtime.controller.beginCreateFromDraft({
      ...casualtyDraft(),
      treatment: 'a'.repeat(MAX_CASUALTY_TREATMENT_LOG_BYTES - 10),
    }))
    typeUpdate(UPDATE)

    await act(async () => click('marker-save-btn'))

    expect(runtime.upsertMarker).not.toHaveBeenCalled()
    expect(query('marker-dialog')).not.toBeNull()
    expect(updateInput().value).toBe(UPDATE)
    expect(host.textContent).toMatch(/New Treatment Update could not be added/i)
    expect(host.textContent).toMatch(/shorten/i)
  })

  it.each(['backdrop', 'Escape', 'Close', 'Cancel'])(
    'asks before discarding an appended, unsaved treatment update via %s',
    (method) => {
      openCasualty()
      typeUpdate(UPDATE)
      click('marker-treatment-append-btn')
      expect(updateInput().value).toBe('')

      requestClose(method)

      expect(query('marker-dialog')).not.toBeNull()
      expect(query('marker-discard-confirmation')?.textContent).toMatch(/unsaved treatment updates will be lost/i)
      expect(document.activeElement).toBe(query('marker-discard-keep-btn'))
      expect(runtime.upsertMarker).not.toHaveBeenCalled()
      click('marker-discard-keep-btn')
      expect(query('marker-discard-confirmation')).toBeNull()
      expect(treatmentInput().value).toContain(UPDATE)

      requestClose(method)
      click('marker-discard-confirm-btn')
      expect(query('marker-dialog')).toBeNull()
      expect(runtime.upsertMarker).not.toHaveBeenCalled()
    },
  )

  it('treats Escape during discard confirmation as Keep editing', () => {
    openCasualty()
    typeUpdate(UPDATE)
    requestClose('Escape')
    expect(query('marker-discard-confirmation')).not.toBeNull()

    requestClose('Escape')

    expect(query('marker-dialog')).not.toBeNull()
    expect(query('marker-discard-confirmation')).toBeNull()
    expect(updateInput().value).toBe(UPDATE)
    expect(document.activeElement).toBe(query('marker-close-btn'))
  })

  it.each(['backdrop', 'Escape'])('closes a clean dialog immediately via %s', (method) => {
    openCasualty()
    requestClose(method)
    expect(query('marker-dialog')).toBeNull()
    expect(runtime.upsertMarker).not.toHaveBeenCalled()
  })

  it('compares coordinate values and clears dirty state when an edit is reverted', () => {
    const draft = casualtyDraft()
    act(() => runtime.controller.beginCreateFromDraft(draft))
    act(() => runtime.controller.updateDraft({
      name: 'Changed name',
      coordinates: { ...draft.coordinates },
    }))
    requestClose('Close')
    expect(query('marker-discard-confirmation')).not.toBeNull()
    click('marker-discard-keep-btn')
    act(() => runtime.controller.updateDraft({ name: draft.name }))
    requestClose('Close')
    expect(query('marker-dialog')).toBeNull()
  })

  it('remounts local confirmations when a new create session replaces the current one', () => {
    openCasualty()
    typeUpdate(UPDATE)
    requestClose('Close')
    expect(query('marker-discard-confirmation')).not.toBeNull()
    act(() => runtime.controller.beginCreateFromDraft(casualtyDraft('Casualty B')))
    expect(query('marker-discard-confirmation')).toBeNull()
    expect(updateInput().value).toBe('')
  })

  it('resets a failed Add Update message when another create draft opens directly', () => {
    act(() => runtime.controller.beginCreateFromDraft({
      ...casualtyDraft(),
      treatment: 'a'.repeat(MAX_CASUALTY_TREATMENT_LOG_BYTES - 10),
    }))
    typeUpdate(UPDATE)
    click('marker-treatment-append-btn')
    expect(host.textContent).toMatch(/524288 UTF-8 bytes or fewer/i)

    act(() => runtime.controller.beginCreateFromDraft(casualtyDraft('Casualty B')))

    expect(host.textContent).not.toMatch(/524288 UTF-8 bytes or fewer/i)
    expect(updateInput().value).toBe('')
  })

  it('resets retire confirmation when the same marker is opened in a new session', async () => {
    openCasualty()
    await act(async () => click('marker-save-btn'))
    act(() => runtime.controller.beginEdit('marker-1'))
    click('marker-delete-btn')
    expect(query('marker-delete-confirmation')).not.toBeNull()

    act(() => runtime.controller.beginEdit('marker-1'))

    expect(query('marker-delete-confirmation')).toBeNull()
    expect(query('marker-delete-btn')).not.toBeNull()
  })

  it('retains pending text after a persistence failure and includes it exactly once on retry', async () => {
    openCasualty()
    typeUpdate(UPDATE)
    runtime.upsertMarker.mockRejectedValueOnce(new Error('database busy'))
    await act(async () => click('marker-save-btn'))
    expect(query('marker-dialog')).not.toBeNull()
    expect(updateInput().value).toBe(UPDATE)
    expect(host.textContent).toContain('database busy')

    await act(async () => click('marker-save-btn'))

    expect(runtime.upsertMarker).toHaveBeenCalledTimes(2)
    expect(runtime.upsertMarker.mock.calls[1]?.[0].treatment?.split(UPDATE)).toHaveLength(2)
    expect(query('marker-dialog')).toBeNull()
  })

  /** Opens a valid casualty through the real runtime. */
  function openCasualty(): void {
    act(() => runtime.controller.beginCreateFromDraft(casualtyDraft()))
  }

  /** Finds one rendered test target. */
  function query(testId: string): Element | null {
    return host.querySelector(`[data-testid="${testId}"]`)
  }

  /** Reads the controlled pending update field. */
  function updateInput(): HTMLTextAreaElement {
    return query('marker-treatment-update-input') as HTMLTextAreaElement
  }

  /** Reads the unsaved accumulated log. */
  function treatmentInput(): HTMLTextAreaElement {
    return query('marker-treatment-log-input') as HTMLTextAreaElement
  }

  /** Types through React's native textarea event boundary. */
  function typeUpdate(value: string): void {
    const input = updateInput()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  /** Clicks a button and flushes synchronous React updates. */
  function click(testId: string): void {
    const button = query(testId)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${testId}`)
    act(() => button.click())
  }

  /** Exercises each operator dismissal path at the rendered dialog boundary. */
  function requestClose(method: string): void {
    if (method === 'Escape') {
      const panel = host.querySelector('[role="dialog"]')
      act(() => panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    } else if (method === 'backdrop') {
      act(() => (host.querySelector('button[aria-label="Close dialog"]') as HTMLButtonElement).click())
    } else if (method === 'Cancel') {
      const button = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === 'Cancel')
      act(() => button?.click())
    } else {
      click('marker-close-btn')
    }
  }
})
