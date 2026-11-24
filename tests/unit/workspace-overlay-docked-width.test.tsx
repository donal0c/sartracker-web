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

function render(reviewOpen: boolean, devicesOpen: boolean, onClose: { review?: () => void; devices?: () => void } = {}): void {
  act(() => root.render(createElement('div', null,
    createElement(WorkspaceOverlay, { open: reviewOpen, docked: true, labelledBy: 'review', maxWidth: 'max-w-xl', onClose: onClose.review ?? (() => {}), children: 'Review' }),
    createElement(WorkspaceOverlay, { open: devicesOpen, docked: true, labelledBy: 'devices', maxWidth: 'max-w-md', onClose: onClose.devices ?? (() => {}), children: 'Devices' }),
  )))
}

const pressEscapeOnPage = () => act(() => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
})

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

it('closes only the most recently opened dock on one Escape [DON-368]', () => {
  const review = vi.fn()
  const devices = vi.fn()
  render(true, false, { review, devices })
  render(true, true, { review, devices })

  pressEscapeOnPage()
  expect(devices).toHaveBeenCalledOnce()
  expect(review).not.toHaveBeenCalled()
})

it('closes Review, not All devices, when Review was docked last [DON-368]', () => {
  const review = vi.fn()
  const devices = vi.fn()
  render(false, true, { review, devices })
  render(true, true, { review, devices })

  pressEscapeOnPage()
  expect(review).toHaveBeenCalledOnce()
  expect(devices).not.toHaveBeenCalled()
})

it('draws the most recently opened dock on top [DON-368]', () => {
  render(false, true)
  render(true, true)
  const zOf = (label: string) => Number((document.querySelector(`[aria-labelledby="${label}"]`)?.parentElement as HTMLElement).style.zIndex)
  expect(zOf('review')).toBeGreaterThan(zOf('devices'))
})
