// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { DOCKED_PANEL_WIDTH_VAR, WorkspaceOverlay } from '../../src/components/workspace-overlay'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // jsdom has no layout: each docked panel reports the width its class names.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.className.includes('max-w-xl') ? 576 : this.className.includes('max-w-md') ? 448 : 0
    return { width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty(DOCKED_PANEL_WIDTH_VAR)
})

function render(reviewOpen: boolean, devicesOpen: boolean): void {
  act(() => root.render(createElement('div', null,
    createElement(WorkspaceOverlay, { open: reviewOpen, docked: true, labelledBy: 'review', maxWidth: 'max-w-xl', onClose: () => {}, children: 'Review' }),
    createElement(WorkspaceOverlay, { open: devicesOpen, docked: true, labelledBy: 'devices', maxWidth: 'max-w-md', onClose: () => {}, children: 'Devices' }),
  )))
}

const published = () => document.documentElement.style.getPropertyValue(DOCKED_PANEL_WIDTH_VAR)

it('keeps the map beside All devices when docked Review closes [DON-368]', () => {
  render(true, true)
  expect(published()).toBe('576px')

  render(false, true)
  expect(published()).toBe('448px')

  render(false, false)
  expect(published()).toBe('')
})

it('keeps the map beside Review when docked All devices closes first [DON-368]', () => {
  render(true, true)
  render(true, false)
  expect(published()).toBe('576px')
})
