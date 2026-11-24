import { useLayoutEffect, useRef } from 'react'

import { useMapTargetStore } from '../../features/map/map-target-store'
import { selectExceptionsForMap, type PersonRow } from '../../features/workspace/people-model'

const MAX_EXCEPTIONS_ON_MAP = 3
/**
 * Height of the warnings on the map. Their top is set in CSS from the live
 * alarm height, so CSS works out their bottom and nothing measured goes stale
 * when the alarm moves them.
 */
export const EXCEPTIONS_HEIGHT_VAR = '--ws-exceptions-height'

/** With People closed, whoever needs a look is still named on the map, in words. */
export function ExceptionsOnMap(props: { readonly people: readonly PersonRow[]; readonly onShowAll: () => void }) {
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const exceptions = selectExceptionsForMap(props.people)
  const listRef = useRef<HTMLDivElement>(null)
  const shown = exceptions.length > 0

  // Map Tools starts below these warnings, so its open panels never cover
  // them and they never cover its controls (DON-368).
  useLayoutEffect(() => {
    const list = listRef.current
    const scope = list?.parentElement
    if (!shown || list === null || scope === null || scope === undefined) return undefined
    const publish = () => scope.style.setProperty(EXCEPTIONS_HEIGHT_VAR, `${list.offsetHeight}px`)
    publish()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish)
    observer?.observe(list)
    return () => {
      observer?.disconnect()
      scope.style.removeProperty(EXCEPTIONS_HEIGHT_VAR)
    }
  }, [shown])

  if (!shown) return null
  const extra = exceptions.length - MAX_EXCEPTIONS_ON_MAP
  return (
    <div className="ws-exceptions" data-map-interaction-boundary="true" data-testid="ws-exceptions" ref={listRef}>
      {exceptions.slice(0, MAX_EXCEPTIONS_ON_MAP).map((person) => (
        <button
          data-testid={`ws-exception-${person.deviceId}`}
          disabled={person.latitude === null || person.longitude === null}
          key={person.deviceId}
          onClick={() => { if (person.latitude !== null && person.longitude !== null) queueTarget(person.latitude, person.longitude, person.name) }}
          title="Go to this person on the map"
          type="button"
        >
          <strong>⚠ {person.name}</strong> {person.statusText}
        </button>
      ))}
      {extra > 0 ? <button data-testid="ws-exceptions-more" onClick={props.onShowAll} type="button"><strong>+{extra} more</strong></button> : null}
    </div>
  )
}
