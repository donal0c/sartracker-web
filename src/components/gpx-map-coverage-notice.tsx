import { useRef } from 'react'

import { useGpxStore } from '../features/gpx/gpx-store'
import { GPX_NOTICE_RESERVE_VAR, usePublishMapOverlayHeight } from './map-overlay-space'

/** The notice's height plus its gap, as the room Map Tools leaves above the map scale. */
const formatNoticeReserve = (heightPx: number) => `calc(${heightPx}px + 0.5rem)`

/**
 * Tells the operator, on the map itself, when it does not show every imported GPX track or could not be
 * refreshed. A track is never silently absent from the map [DON-350] [M-87]. It sits just above the map
 * scale, which grows with the coordinate bar, and Map Tools stops above it (DON-369). It shows at most two
 * lines, so a long list of file names cannot push the map warnings up; the whole text is its title and is read
 * out in full.
 */
export function GpxMapCoverageNotice() {
  const notice = useGpxStore((state) => state.mapCoverageNotice)
  const noticeRef = useRef<HTMLDivElement>(null)
  usePublishMapOverlayHeight(noticeRef, GPX_NOTICE_RESERVE_VAR, formatNoticeReserve)
  if (notice === null) return null
  return (
    <div
      aria-live="polite"
      className="sar-gpx-map-coverage-notice pointer-events-auto absolute left-4 z-[15] max-w-[min(24rem,calc(100%-2rem))] border border-amber-300/80 bg-stone-950/95 px-3 py-1.5 text-[11px] font-bold text-amber-100 shadow-lg shadow-black/40 line-clamp-2"
      data-testid="gpx-map-coverage-notice"
      ref={noticeRef}
      role="status"
      title={notice}
    >
      {notice}
    </div>
  )
}
