import { useState } from 'react'

import type { WeatherLinkSettings } from '../features/settings/settings-types'
import { loadAppSettings } from '../infrastructure/settings-store/tauri-settings-store'
import { openExternalUrl } from '../infrastructure/url-opener/open-external-url'

/** Menu for operator-configured external weather resources. */
export function WeatherMenu() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [links, setLinks] = useState<readonly WeatherLinkSettings[]>([])
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="relative flex min-w-0 border-r border-[var(--sar-line)]">
      <button
        aria-expanded={open}
        aria-label="Open weather links menu"
        className="sar-mast-button w-full"
        data-testid="weather-menu-trigger"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          setOpen(true)
          void loadWeatherLinks()
        }}
        type="button"
      >
        <span className="sar-mast-label-full">Weather</span>
        <span aria-hidden="true" className="sar-mast-label-short">
          Wx
        </span>
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-72 border border-[var(--sar-line)] bg-[var(--sar-panel)] p-3 text-sm shadow-2xl"
          data-testid="weather-menu"
        >
          <p className="sar-section-label text-amber-300">External Weather Links</p>
          <p className="sar-helper-text mt-1">
            Opens configured websites in a new tab. No weather data is fetched by SAR Tracker.
          </p>
          {loading ? (
            <p className="mt-3 text-sm text-stone-300">Loading weather links...</p>
          ) : error !== null ? (
            <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p>
          ) : links.length === 0 ? (
            <p className="mt-3 text-sm text-stone-300">
              No weather links configured. Add named weather URLs in Settings.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {links.map((link, index) => (
                <button
                  className="sar-button flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-bold text-stone-100"
                  data-testid={`weather-link-open-${index}`}
                  key={`${link.name}-${link.url}`}
                  onClick={() => void openExternalUrl(link.url)}
                  type="button"
                >
                  <span className="truncate">{link.name}</span>
                  <span aria-hidden="true" className="ml-3 text-amber-300">Open</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )

  async function loadWeatherLinks(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const settings = await loadAppSettings()
      setLinks(settings.weather.links)
    } catch (loadError) {
      setError(toErrorMessage(loadError))
      setLinks([])
    } finally {
      setLoading(false)
    }
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
