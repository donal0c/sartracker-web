import type { AppSettingsDraft } from '../../features/settings/settings-types'
import { MAX_WEATHER_LINKS } from '../../features/settings/settings-validation'
import {
  SettingsGroup,
  TextField,
} from './settings-fields'
import {
  updateDraft,
  type SettingsDraftSetter,
  type SettingsValidationErrors,
} from '../../features/settings/settings-draft-edit'

type WeatherLinksSectionProps = {
  readonly draft: AppSettingsDraft
  readonly setDraft: SettingsDraftSetter
  readonly validationErrors: SettingsValidationErrors
}

/**
 * Weather links: named external pages opened from the Weather menu in the top
 * bar. SAR Tracker never fetches or forecasts weather itself.
 */
export function WeatherLinksSection({ draft, setDraft, validationErrors }: WeatherLinksSectionProps) {
  return (
    <SettingsGroup
      title="Weather links"
      description="External weather pages, opened in your web browser from the Weather menu. Only http and https addresses are allowed. SAR Tracker does not fetch, parse, or forecast weather."
    >
      {draft.weather.links.length === 0 ? (
        <div
          className="border border-dashed border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-4 py-3 text-sm text-stone-300"
          data-testid="weather-links-empty"
        >
          No weather links configured. Add named links such as Met Éireann for quick access from the top mast.
        </div>
      ) : (
        <div className="space-y-4">
          {draft.weather.links.map((link, index) => (
            <div
              className="grid gap-3 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-3 md:grid-cols-[1fr_1.6fr_auto]"
              key={index}
            >
              <TextField
                label="Name"
                testId={`weather-link-name-${index}`}
                value={link.name}
                error={validationErrors[`weather.links.${index}.name`]}
                onChange={(value) =>
                  updateDraft(setDraft, (current) => ({
                    ...current,
                    weather: {
                      links: current.weather.links.map((existing, linkIndex) =>
                        linkIndex === index ? { ...existing, name: value } : existing,
                      ),
                    },
                  }))
                }
              />
              <TextField
                label="External URL"
                testId={`weather-link-url-${index}`}
                value={link.url}
                error={validationErrors[`weather.links.${index}.url`]}
                onChange={(value) =>
                  updateDraft(setDraft, (current) => ({
                    ...current,
                    weather: {
                      links: current.weather.links.map((existing, linkIndex) =>
                        linkIndex === index ? { ...existing, url: value } : existing,
                      ),
                    },
                  }))
                }
              />
              <button
                className="sar-button self-end px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
                data-testid={`weather-link-remove-${index}`}
                onClick={() =>
                  updateDraft(setDraft, (current) => ({
                    ...current,
                    weather: {
                      links: current.weather.links.filter((_, linkIndex) => linkIndex !== index),
                    },
                  }))
                }
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {validationErrors['weather.links'] ? (
        <p className="text-xs font-semibold text-rose-300">{validationErrors['weather.links']}</p>
      ) : null}
      <button
        className="sar-button px-4 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
        data-testid="weather-link-add"
        disabled={draft.weather.links.length >= MAX_WEATHER_LINKS}
        onClick={() =>
          updateDraft(setDraft, (current) => ({
            ...current,
            weather: { links: [...current.weather.links, { name: '', url: '' }] },
          }))
        }
        type="button"
      >
        Add Weather Link
      </button>
    </SettingsGroup>
  )
}
