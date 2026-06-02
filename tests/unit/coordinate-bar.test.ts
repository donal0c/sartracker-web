import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { CoordinateBar } from '../../src/components/coordinate-bar'

describe('CoordinateBar', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
  })

  it('keeps operator coordinates visible without low-use CRS cells', () => {
    render(React.createElement(CoordinateBar, { latitude: 52.274681, longitude: -9.530912 }))

    expect(text('[data-testid="coordinate-display"]')).toContain('52.274681')
    expect(text('[data-testid="coordinate-display"]')).not.toContain('Map CRS')
    expect(text('[data-testid="coordinate-display"]')).not.toContain('Work CRS')
    expect(query('[data-testid="open-coordinate-converter"]')).not.toBeNull()
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

function query(selector: string): Element | null {
  return document.querySelector(selector)
}

function text(selector: string): string {
  const element = query(selector)
  if (element === null) {
    throw new Error(`Expected ${selector} to exist.`)
  }
  return element.textContent ?? ''
}
