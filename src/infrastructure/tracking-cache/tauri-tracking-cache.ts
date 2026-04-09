import { invoke } from '@tauri-apps/api/core'

export type TrackingCache = {
  readonly read: () => Promise<string | null>
  readonly write: (contents: string) => Promise<string>
}

/**
 * Creates the Tauri-backed tracking cache adapter.
 */
export function createTauriTrackingCache(): TrackingCache {
  return {
    read: () => invoke<string | null>('read_tracking_cache'),
    write: (contents) => invoke<string>('write_tracking_cache', { contents }),
  }
}
