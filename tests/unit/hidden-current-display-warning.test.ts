// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import { useTrackingHeadline, type TrackingHeadline } from '../../src/features/workspace/tracking-headline'

/** Renders the live tracking headline (the top bar's status) and returns what it says. */
function readHeadline(): TrackingHeadline {
  const seen: TrackingHeadline[] = []
  const Probe = ({ report }: { report: (headline: TrackingHeadline) => void }) => { report(useTrackingHeadline()); return null }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Probe, { report: (headline) => seen.push(headline) })))
  act(() => root.unmount())
  const last = seen.at(-1)
  if (last === undefined) throw new Error('The tracking headline did not render.')
  return last
}

it('names hidden locations in the tracking headline without inventing current fixes [DON-353]', () => {
  const previous = useLayerVisibilityStore.getState()
  const tracking = useTrackingStore.getState()
  try {
    useTrackingStore.setState({ snapshot: { devices: [], positions: [], breadcrumbs: [] } })
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['no-fix'], groupVisibility: { ...previous.groupVisibility, tracking: true } })
    const one = readHeadline()
    expect(one.issues).toContain("1 person's location hidden on the map")
    expect(one.issues.join(' ')).not.toMatch(/current location/iu)

    useLayerVisibilityStore.setState({ hiddenDeviceIds: [], groupVisibility: { ...previous.groupVisibility, tracking: false } })
    expect(readHeadline().issues).toContain('All locations hidden on the map')
  } finally {
    useLayerVisibilityStore.setState(previous)
    useTrackingStore.setState(tracking)
  }
})
