// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { PersistentTrackingHealth } from '../../src/components/persistent-tracking-health'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'

it('describes hidden device display choices without inventing current fixes', () => {
  const previous = useLayerVisibilityStore.getState()
  const tracking = useTrackingStore.getState()
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['no-fix'], groupVisibility: { ...previous.groupVisibility, tracking: true } })
    useTrackingStore.setState({ snapshot: { devices: [], positions: [], breadcrumbs: [] } })
    act(() => root.render(createElement(PersistentTrackingHealth)))
    expect(host.textContent).toContain('Current-location display disabled for 1 device')
    expect(host.textContent).not.toContain('1 current location hidden')
  } finally {
    act(() => root.unmount())
    useLayerVisibilityStore.setState(previous)
    useTrackingStore.setState(tracking)
  }
})
