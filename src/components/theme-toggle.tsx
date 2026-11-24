import { useEffect, useState } from 'react'

import { applyTheme, clearThemeReadFailure, readAppliedTheme, saveTheme, themeReadFailed, type ThemeName } from '../lib/theme-preference'

/** Switches between the light default and the dark night theme, and reports unavailable preference storage. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(readAppliedTheme)
  const [error, setError] = useState(false)
  const [startupReadFailed, setStartupReadFailed] = useState(themeReadFailed)
  useEffect(() => { applyTheme(theme) }, [theme])
  const light = theme === 'light'
  return <div className="flex items-center gap-2">
    <button className="sar-button px-3 py-2 text-xs font-bold" data-testid="theme-toggle" aria-pressed={light} onClick={() => {
      const next: ThemeName = light ? 'standard' : 'light'
      setTheme(next)
      const saved = saveTheme(next)
      setError(!saved)
      if (saved) { clearThemeReadFailure(); setStartupReadFailed(false) }
    }} title={light ? 'Switch to the dark theme for night use' : 'Switch to the light theme'} type="button">Theme: {light ? 'Light' : 'Dark'}</button>
    {startupReadFailed && <span role="status" className="text-xs text-amber-200">Could not read the saved theme at startup, so SAR Tracker opened in Light.</span>}
    {error && <span role="alert" className="text-xs text-amber-200">Theme applied; could not save for next launch.</span>}
  </div>
}
