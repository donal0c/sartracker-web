import { describe, expect, it } from 'vitest'

import {
  getEffectiveDrawingTypeVisibility,
  getEffectiveGpxTracksVisible,
  getEffectiveHelicopterSlotVisibility,
  getEffectiveMarkerTypeVisibility,
  getEffectiveMeasurementsVisible,
  getEffectiveTrackingVisible,
} from '../../src/features/layers/effective-overlay-visibility'
import type { LayerGroupVisibility } from '../../src/features/layers/layer-visibility-store'

const ALL_GROUPS_VISIBLE: LayerGroupVisibility = {
  tracking: true,
  helicopters: true,
  mapTools: true,
  gpxTracks: true,
}

describe('effective overlay visibility', () => {
  it('hides all map-tools overlays when the parent group is hidden', () => {
    const hiddenMapTools: LayerGroupVisibility = {
      ...ALL_GROUPS_VISIBLE,
      mapTools: false,
    }

    expect(
      getEffectiveMarkerTypeVisibility(hiddenMapTools, {
        ipp_lkp: true,
        clue: true,
        hazard: false,
        casualty: true,
      }),
    ).toEqual({
      ipp_lkp: false,
      clue: false,
      hazard: false,
      casualty: false,
    })

    expect(
      getEffectiveDrawingTypeVisibility(hiddenMapTools, {
        line: true,
        search_area: true,
        range_ring: true,
        bearing_line: true,
        search_sector: true,
        text_label: true,
      }),
    ).toEqual({
      line: false,
      search_area: false,
      range_ring: false,
      bearing_line: false,
      search_sector: false,
      text_label: false,
    })

    expect(getEffectiveMeasurementsVisible(hiddenMapTools, true)).toBe(false)
  })

  it('preserves child-specific settings when parent groups remain visible', () => {
    expect(
      getEffectiveMarkerTypeVisibility(ALL_GROUPS_VISIBLE, {
        ipp_lkp: true,
        clue: false,
        hazard: true,
        casualty: false,
      }),
    ).toEqual({
      ipp_lkp: true,
      clue: false,
      hazard: true,
      casualty: false,
    })

    expect(
      getEffectiveDrawingTypeVisibility(ALL_GROUPS_VISIBLE, {
        line: true,
        search_area: false,
        range_ring: true,
        bearing_line: false,
        search_sector: true,
        text_label: false,
      }),
    ).toEqual({
      line: true,
      search_area: false,
      range_ring: true,
      bearing_line: false,
      search_sector: true,
      text_label: false,
    })

    expect(getEffectiveMeasurementsVisible(ALL_GROUPS_VISIBLE, true)).toBe(true)
  })

  it('hides tracking, helicopter, and gpx overlays when their parent groups are hidden', () => {
    expect(
      getEffectiveTrackingVisible({
        ...ALL_GROUPS_VISIBLE,
        tracking: false,
      }),
    ).toBe(false)

    expect(
      getEffectiveHelicopterSlotVisibility(
        {
          ...ALL_GROUPS_VISIBLE,
          helicopters: false,
        },
        {
          slot_1: true,
          slot_2: true,
          slot_3: false,
          slot_4: true,
        },
      ),
    ).toEqual({
      slot_1: false,
      slot_2: false,
      slot_3: false,
      slot_4: false,
    })

    expect(
      getEffectiveGpxTracksVisible({
        ...ALL_GROUPS_VISIBLE,
        gpxTracks: false,
      }),
    ).toBe(false)
  })
})
