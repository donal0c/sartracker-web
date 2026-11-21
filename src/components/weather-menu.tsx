import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { WeatherLinkSettings } from '../features/settings/settings-types'
import { loadAppSettings } from '../infrastructure/settings-store/tauri-settings-store'
import { openExternalUrl } from '../infrastructure/url-opener/open-external-url'

const MENU_WIDTH_PX = 288
const VIEWPORT_MARGIN_PX = 8

type MenuPosition = { readonly top: number; readonly left: number }

/**
 * Compact top-bar menu for operator-configured external weather pages.
 *
 * The menu renders in a portal on the document body, fixed below its trigger:
 * the top bar clips anything that overflows it, which once left the menu
 * invisible and its links unclickable on every runtime [DON-340]. A link that
 * cannot be opened says why in the menu instead of failing silently.
 */
export function WeatherMenu() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [links, setLinks] = useState<readonly WeatherLinkSettings[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const place = () => {
      const trigger = triggerRef.current
      if (trigger === null) return
      setPosition(menuPositionBelow(trigger.getBoundingClientRect(), window.innerWidth))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) === true || triggerRef.current?.contains(target) === true) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <div className="relative flex min-w-0 border-r border-[var(--sar-line)]">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open weather links menu"
        className="sar-mast-button w-full"
        data-testid="weather-menu-trigger"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          setOpen(true)
          setOpenError(null)
          void loadWeatherLinks()
        }}
        ref={triggerRef}
        type="button"
      >
        <span className="sar-mast-label-full">Weather</span>
        <span aria-hidden="true" className="sar-mast-label-short">
          Wx
        </span>
      </button>
      {open && position !== null
        ? createPortal(
            <div
              aria-label="External weather links"
              className="fixed z-[70] border border-[var(--sar-line)] bg-[var(--sar-panel)] p-3 text-sm shadow-2xl"
              data-testid="weather-menu"
              ref={menuRef}
              role="menu"
              style={{ top: position.top, left: position.left, width: MENU_WIDTH_PX }}
            >
              <p className="sar-section-label text-amber-300">External Weather Links</p>
              <p className="sar-helper-text mt-1">
                Opens configured websites in your web browser. No weather data is fetched by SAR Tracker.
              </p>
              {loading ? (
                <p className="mt-3 text-sm text-stone-300">Loading weather links...</p>
              ) : error !== null ? (
                <p className="mt-3 text-sm font-semibold text-rose-300" role="alert">{error}</p>
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
                      onClick={() => void handleOpen(link)}
                      role="menuitem"
                      type="button"
                    >
                      <span className="truncate">{link.name}</span>
                      <span aria-hidden="true" className="ml-3 text-amber-300">Open</span>
                    </button>
                  ))}
                </div>
              )}
              {openError !== null ? (
                <p
                  className="mt-3 border border-rose-400/60 bg-rose-950/60 px-3 py-2 text-xs font-semibold text-rose-100"
                  data-testid="weather-menu-open-error"
                  role="alert"
                >
                  {openError}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )

  /** Reads the saved weather links each time the menu opens. */
  async function loadWeatherLinks(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const settings = await loadAppSettings()
      setLinks(settings.weather.links)
    } catch (loadError) {
      setError(`Weather links could not be loaded: ${toErrorMessage(loadError)}`)
      setLinks([])
    } finally {
      setLoading(false)
    }
  }

  /** Opens one link in the system browser, keeping the menu open with the reason if it fails. */
  async function handleOpen(link: WeatherLinkSettings): Promise<void> {
    setOpenError(null)
    try {
      await openExternalUrl(link.url)
      setOpen(false)
    } catch (openFailure) {
      console.error('Weather link could not be opened.', openFailure)
      setOpenError(`${link.name || 'The weather link'} could not be opened: ${toErrorMessage(openFailure)}`)
    }
  }
}

/**
 * Places the menu below its trigger, right-aligned to it, and kept inside the
 * window on narrow screens.
 */
function menuPositionBelow(trigger: DOMRect, viewportWidth: number): MenuPosition {
  const preferredLeft = trigger.right - MENU_WIDTH_PX
  const maxLeft = Math.max(VIEWPORT_MARGIN_PX, viewportWidth - MENU_WIDTH_PX - VIEWPORT_MARGIN_PX)
  return {
    top: trigger.bottom + 4,
    left: Math.min(Math.max(preferredLeft, VIEWPORT_MARGIN_PX), maxLeft),
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
