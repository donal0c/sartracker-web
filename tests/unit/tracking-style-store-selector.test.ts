import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_BREADCRUMB_SIZE,
  useTrackingStylePreferences,
  useTrackingStyleStore,
} from '../../src/features/tracking/tracking-style-store'

describe('useTrackingStylePreferences', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    useTrackingStyleStore.setState(useTrackingStyleStore.getInitialState())
  })

  it('returns the persisted tracking style through a stable selector-safe hook', () => {
    useTrackingStyleStore.setState({
      breadcrumbSize: 7,
      deviceColors: {
        alpha: '#F97316',
      },
    })

    render(React.createElement(TrackingStyleProbe))

    expect(host?.textContent).toBe(`alpha:#F97316|size:7`)
  })

  it('uses the default style when no operator preferences exist', () => {
    render(React.createElement(TrackingStyleProbe))

    expect(host?.textContent).toBe(`alpha:none|size:${DEFAULT_BREADCRUMB_SIZE}`)
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

function TrackingStyleProbe(): React.ReactElement {
  const trackingStyle = useTrackingStylePreferences()
  const alphaColor = trackingStyle.deviceColors.alpha ?? 'none'

  return React.createElement(
    'output',
    null,
    `alpha:${alphaColor}|size:${trackingStyle.breadcrumbSize}`,
  )
}
