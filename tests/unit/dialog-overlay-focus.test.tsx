// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DialogOverlay } from '../../src/components/dialog-overlay'

let host: HTMLDivElement
let opener: HTMLButtonElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  opener = document.createElement('button')
  document.body.append(opener, host)
  opener.focus()
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  opener.remove()
  vi.restoreAllMocks()
})

it('owns keyboard focus on commit so immediate Escape reaches only the dialog', () => {
  const close = vi.fn()
  const outside = vi.fn()
  document.addEventListener('keydown', outside)
  /** Represents an input arriving as soon as the committed overlay can be observed. */
  function ImmediateKeyboard() {
    useLayoutEffect(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }, [])
    return createElement(DialogOverlay, { open: true, labelledBy: 'heading', onClose: close, testId: 'dialog',
      children: createElement('button', { id: 'heading' }, 'Close') })
  }
  try {
    act(() => root.render(createElement(ImmediateKeyboard)))
    expect(close).toHaveBeenCalledOnce()
    expect(outside).not.toHaveBeenCalled()
    expect(host.contains(document.activeElement)).toBe(true)
  } finally {
    document.removeEventListener('keydown', outside)
  }
})

it('returns focus to the opener when the committed dialog closes', () => {
  const props = { labelledBy: 'heading', onClose: vi.fn(), testId: 'dialog',
    children: createElement('button', { id: 'heading' }, 'Close') }
  act(() => root.render(createElement(DialogOverlay, { ...props, open: true })))
  expect(host.contains(document.activeElement)).toBe(true)
  act(() => root.render(createElement(DialogOverlay, { ...props, open: false })))
  expect(document.activeElement).toBe(opener)
})
