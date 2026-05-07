import { useFocusModeStore } from '../features/focus-mode/focus-mode-store'

type FocusModeToggleProps = {
  readonly className?: string
  readonly compact?: boolean
}

/**
 * Renders the explicit Focus Mode Plus enter/exit control.
 */
export function FocusModeToggle({ className = '', compact = false }: FocusModeToggleProps) {
  const active = useFocusModeStore((state) => state.active)
  const toggle = useFocusModeStore((state) => state.toggle)

  return (
    <button
      aria-pressed={active}
      className={className}
      data-testid="focus-mode-toggle"
      onClick={() => toggle()}
      type="button"
    >
      {active
        ? compact ? 'Exit Focus' : 'Exit Focus Mode Plus'
        : compact ? 'Focus Mode' : 'Enter Focus Mode Plus'}
    </button>
  )
}
