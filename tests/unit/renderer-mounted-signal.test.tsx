// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RendererMountedSignal } from '../../src/features/runtime/renderer-mounted-signal'

/** A screen that fails while rendering, as a broken first screen would. */
function BrokenScreen(): never {
  throw new Error('first screen failed')
}

describe('renderer mounted signal [DON-354]', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('tells the main process once the first screen has mounted', async () => {
    const signalRendererMounted = vi.fn()
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <React.StrictMode>
          <p>Map</p>
          <RendererMountedSignal bridge={{ signalRendererMounted }} />
        </React.StrictMode>,
      )
    })

    expect(signalRendererMounted).toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('stays silent when the first screen fails to render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const signalRendererMounted = vi.fn()
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)

    await expect(act(async () => {
      root.render(
        <>
          <BrokenScreen />
          <RendererMountedSignal bridge={{ signalRendererMounted }} />
        </>,
      )
    })).rejects.toThrow('first screen failed')

    expect(signalRendererMounted).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('does nothing outside the desktop app', async () => {
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)

    await act(async () => {
      root.render(<RendererMountedSignal bridge={undefined} />)
    })

    expect(container.innerHTML).toBe('')
    act(() => root.unmount())
  })
})
