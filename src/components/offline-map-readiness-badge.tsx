import type { OfflineMapReadiness } from '../features/map/offline-map-readiness'
import type { OfflineMapCoverage } from '../features/map/offline-map-coverage'

type OfflineMapReadinessBadgeProps = {
  readonly coverage?: OfflineMapCoverage
  readonly onCheckCoverage?: () => void
  readonly readiness: OfflineMapReadiness
}

const TONE_CLASSES: Record<OfflineMapReadiness['tone'], string> = {
  danger: 'border-rose-300/75 bg-stone-950/96 text-rose-50',
  neutral: 'border-stone-400/70 bg-stone-950/96 text-stone-100',
  success: 'border-emerald-300/70 bg-stone-950/96 text-emerald-100',
  warning: 'border-amber-300/75 bg-stone-950/96 text-amber-100',
}

const COVERAGE_TONE_CLASSES: Record<OfflineMapCoverage['tone'], string> = {
  danger: 'border-rose-300/65 bg-rose-950/75 text-rose-50',
  neutral: 'border-stone-400/60 bg-black/65 text-stone-100',
  success: 'border-emerald-300/65 bg-emerald-950/75 text-emerald-100',
  warning: 'border-amber-300/65 bg-amber-950/75 text-amber-100',
}

/**
 * Shows whether viewed map tiles are available for field-offline reuse.
 */
export function OfflineMapReadinessBadge({
  coverage,
  onCheckCoverage,
  readiness,
}: OfflineMapReadinessBadgeProps) {
  const checking = coverage?.status === 'checking'

  return (
    <div
      aria-live="polite"
      className={`pointer-events-auto max-w-full border px-3 py-2 text-xs shadow-xl shadow-black/50 ${TONE_CLASSES[readiness.tone]}`}
      data-testid="offline-map-readiness"
    >
      <p className="font-semibold">{readiness.label}</p>
      <p className="mt-0.5 text-[11px] opacity-95">{readiness.detail}</p>
      {coverage !== undefined && onCheckCoverage !== undefined ? (
        <div
          className={`mt-2 border px-2 py-2 ${COVERAGE_TONE_CLASSES[coverage.tone]}`}
          data-testid="offline-map-coverage"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{coverage.label}</p>
            <button
              className="border border-current/60 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
              data-testid="check-offline-map-coverage"
              disabled={checking}
              onClick={onCheckCoverage}
              type="button"
            >
              {checking ? 'Checking' : 'Check View'}
            </button>
          </div>
          <p className="mt-1 text-[11px] opacity-95">{coverage.detail}</p>
        </div>
      ) : null}
    </div>
  )
}
