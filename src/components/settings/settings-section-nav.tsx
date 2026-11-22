import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '../../features/settings/settings-sections'

type SettingsSectionNavProps = {
  readonly activeSection: SettingsSectionId
  readonly errorCounts: Readonly<Record<SettingsSectionId, number>>
  readonly onSelect: (section: SettingsSectionId) => void
}

/**
 * The Settings menu: one button per section, the open one marked, and a red
 * count on any section whose errors block saving.
 */
export function SettingsSectionNav({ activeSection, errorCounts, onSelect }: SettingsSectionNavProps) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--sar-line)] px-3 py-3 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r"
      data-testid="settings-section-nav"
    >
      {SETTINGS_SECTIONS.map((section) => {
        const active = section.id === activeSection
        const errors = errorCounts[section.id]
        return (
          <button
            aria-current={active ? 'page' : undefined}
            className={`flex min-w-max items-center justify-between gap-3 border px-3 py-2.5 text-left text-[12px] font-bold uppercase tracking-wider transition md:min-w-0 ${
              active
                ? 'border-amber-300/50 bg-amber-500/15 text-amber-100'
                : 'border-transparent text-stone-300 hover:border-[var(--sar-line)] hover:text-stone-100'
            }`}
            data-testid={`settings-section-${section.id}`}
            key={section.id}
            onClick={() => onSelect(section.id)}
            title={section.description}
            type="button"
          >
            <span>{section.label}</span>
            {errors > 0 ? (
              <span
                aria-label={`${errors} ${errors === 1 ? 'error' : 'errors'}`}
                className="min-w-5 border border-rose-400/60 bg-rose-950/70 px-1.5 text-center text-[11px] text-rose-100"
                data-testid={`settings-section-${section.id}-errors`}
              >
                {errors}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
