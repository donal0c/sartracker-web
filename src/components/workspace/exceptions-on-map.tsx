import { useMapTargetStore } from '../../features/map/map-target-store'
import { selectExceptionsForMap, type PersonRow } from '../../features/workspace/people-model'

const MAX_EXCEPTIONS_ON_MAP = 3

/** With People closed, whoever needs a look is still named on the map, in words. */
export function ExceptionsOnMap(props: { readonly people: readonly PersonRow[]; readonly onShowAll: () => void }) {
  const queueTarget = useMapTargetStore((state) => state.queueTarget)
  const exceptions = selectExceptionsForMap(props.people)
  if (exceptions.length === 0) return null
  const extra = exceptions.length - MAX_EXCEPTIONS_ON_MAP
  return (
    <div className="ws-exceptions" data-map-interaction-boundary="true" data-testid="ws-exceptions">
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
