import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ColorPaletteInput, SAR_PALETTE } from '../../src/components/color-palette-input'

let container: HTMLElement
let root: Root

function renderPalette(value: string, onChange: (color: string) => void) {
  act(() => {
    root.render(
      React.createElement(ColorPaletteInput, {
        value,
        onChange,
        testId: 'test-color',
      }),
    )
  })
}

describe('ColorPaletteInput', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders all SAR palette swatches', () => {
    renderPalette('#FF0000', vi.fn())

    const swatches = container.querySelector('[data-testid="test-color-swatches"]')
    expect(swatches?.querySelectorAll('button')).toHaveLength(SAR_PALETTE.length)
  })

  it('marks the currently selected swatch as aria-checked', () => {
    renderPalette('#00B8FF', vi.fn())

    const swatch = container.querySelector('[data-testid="test-color-swatch-00B8FF"]')
    expect(swatch?.getAttribute('aria-checked')).toBe('true')

    const otherSwatch = container.querySelector('[data-testid="test-color-swatch-FF0000"]')
    expect(otherSwatch?.getAttribute('aria-checked')).toBe('false')
  })

  it('calls onChange when a swatch is clicked', () => {
    const onChange = vi.fn()
    renderPalette('#FF0000', onChange)

    const swatch = container.querySelector('[data-testid="test-color-swatch-00B8FF"]')
    act(() => { swatch?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

    expect(onChange).toHaveBeenCalledWith('#00B8FF')
  })

  it('updates the value when a valid hex is typed', () => {
    const onChange = vi.fn()
    renderPalette('#FF0000', onChange)

    const hexInput = container.querySelector('[data-testid="test-color-hex"]') as HTMLInputElement
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )!.set!
      nativeInputValueSetter.call(hexInput, '#AABBCC')
      hexInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('#AABBCC')
  })

  it('accepts hex without # prefix and normalizes to uppercase', () => {
    const onChange = vi.fn()
    renderPalette('#FF0000', onChange)

    const hexInput = container.querySelector('[data-testid="test-color-hex"]') as HTMLInputElement
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )!.set!
      nativeInputValueSetter.call(hexInput, 'aabbcc')
      hexInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('#AABBCC')
  })

  it('rejects invalid hex values and does not call onChange', () => {
    const onChange = vi.fn()
    renderPalette('#FF0000', onChange)

    const hexInput = container.querySelector('[data-testid="test-color-hex"]') as HTMLInputElement
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      )!.set!
      nativeInputValueSetter.call(hexInput, 'not-a-color')
      hexInput.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders a preview swatch showing the current colour', () => {
    renderPalette('#8B5CF6', vi.fn())

    const preview = container.querySelector('[data-testid="test-color-preview"]') as HTMLElement
    expect(preview).toBeTruthy()
    expect(preview.style.backgroundColor).toBeTruthy()
  })

  it('exposes SAR_PALETTE with 12 high-contrast operational colours', () => {
    expect(SAR_PALETTE).toHaveLength(12)
    SAR_PALETTE.forEach((color) => {
      expect(color).toMatch(/^#[0-9A-F]{6}$/)
    })
  })
})
