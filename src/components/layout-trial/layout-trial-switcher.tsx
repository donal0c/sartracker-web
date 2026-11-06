import { useLayoutTrialStore } from '../../features/layout-trial/layout-trial-store'

const VERSION_LABELS = [
  { id: 'a', label: 'A', detail: 'Panel on the right' },
  { id: 'b', label: 'B', detail: 'People on the left' },
  { id: 'c', label: 'C', detail: 'Map first' },
  { id: 'current', label: 'Today', detail: 'Current screen' },
] as const

/** Test-only strip for flipping between versions on the same mission. */
export function LayoutTrialSwitcher() {
  const enabled = useLayoutTrialStore((state) => state.enabled)
  const choice = useLayoutTrialStore((state) => state.choice)
  const setChoice = useLayoutTrialStore((state) => state.setChoice)
  if (!enabled) return null
  return (
    <nav aria-label="Try a layout" className="trial-switcher" data-testid="layout-trial-switcher">
      <span>Trying layouts (test only):</span>
      {VERSION_LABELS.map((version) => (
        <button
          aria-pressed={choice === version.id}
          data-testid={`layout-trial-${version.id}`}
          key={version.id}
          onClick={() => setChoice(version.id)}
          type="button"
        >
          <strong>{version.label}</strong> {version.detail}
        </button>
      ))}
    </nav>
  )
}
