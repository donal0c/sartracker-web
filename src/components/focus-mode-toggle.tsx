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
      aria-label={active ? 'Exit Focus Mode Plus' : 'Enter Focus Mode Plus'}
      aria-pressed={active}
      className={className}
      data-testid="focus-mode-toggle"
      onClick={() => toggle()}
      type="button"
    >
      {compact ? (
        <>
          <span className="sar-mast-label-full">{active ? 'Exit Focus' : 'Focus Mode'}</span>
          <span aria-hidden="true" className="sar-mast-label-short">
            {active ? 'Exit' : 'Focus'}
          </span>
        </>
      ) : active ? (
        'Exit Focus Mode Plus'
      ) : (
        'Enter Focus Mode Plus'
      )}
    </button>
  )
}
