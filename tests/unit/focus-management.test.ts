// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import {
  focusFirstElement,
  getFocusableElements,
  restoreFocus,
  trapTabKey,
} from '../../src/lib/focus-management'

describe('focus management', () => {
  it('returns enabled tabbable controls in DOM order', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button disabled>Disabled</button>
      <button id="first">First</button>
      <a id="link" href="/map">Link</a>
      <input id="input" />
      <button aria-hidden="true">Hidden</button>
      <button tabindex="-1">Skipped</button>
    `

    expect(getFocusableElements(container).map((element) => element.id)).toEqual([
      'first',
      'link',
      'input',
    ])
  })

  it('focuses the first actionable control or the container fallback', () => {
    const container = document.createElement('div')
    container.tabIndex = -1
    container.innerHTML = '<button id="first">First</button>'
    document.body.append(container)

    focusFirstElement(container)

    expect(document.activeElement).toBe(container.querySelector('#first'))
    container.remove()
  })

  it('wraps Tab from the last control back to the first', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="first">First</button>
      <button id="last">Last</button>
    `
    document.body.append(container)
    const first = container.querySelector<HTMLElement>('#first')!
    const last = container.querySelector<HTMLElement>('#last')!
    last.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    trapTabKey(event, container)

    expect(preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(first)
    container.remove()
  })

  it('wraps Shift+Tab from the first control back to the last', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <button id="first">First</button>
      <button id="last">Last</button>
    `
    document.body.append(container)
    const first = container.querySelector<HTMLElement>('#first')!
    const last = container.querySelector<HTMLElement>('#last')!
    first.focus()
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
    })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    trapTabKey(event, container)

    expect(preventDefault).toHaveBeenCalled()
    expect(document.activeElement).toBe(last)
    container.remove()
  })

  it('restores focus only when the opener is still attached', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const next = document.createElement('button')
    document.body.append(next)
    next.focus()

    restoreFocus(opener)
    expect(document.activeElement).toBe(opener)

    opener.remove()
    restoreFocus(opener)
    expect(document.activeElement).not.toBe(opener)

    next.remove()
  })
})
