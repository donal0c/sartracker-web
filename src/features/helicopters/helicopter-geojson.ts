import type { FeatureCollection, Point } from 'geojson'

import type {
  Helicopter,
  HelicopterSlotKey,
} from '../../infrastructure/mission-store/tauri-mission-store'

const SLOT_COLORS: Record<HelicopterSlotKey, string> = {
  slot_1: '#f43f5e',
  slot_2: '#34d399',
  slot_3: '#38bdf8',
  slot_4: '#d946ef',
}

export function createHelicopterFeatureCollection(
  helicopters: readonly Helicopter[],
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: helicopters.map((helicopter) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [helicopter.lon, helicopter.lat] as [number, number],
      },
      properties: {
        helicopterId: helicopter.id,
        slotKey: helicopter.slot_key,
        callSign: helicopter.call_sign,
        heading: helicopter.heading ?? 0,
        iconId: `helicopter-${helicopter.slot_key}`,
        color: SLOT_COLORS[helicopter.slot_key],
      },
    })),
  }
}
