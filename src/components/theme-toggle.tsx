import { useEffect, useState } from 'react'

import { applyTheme, readTheme, saveTheme, type ThemeName } from '../lib/theme-preference'

/** Switches between the dark and light themes and reports unavailable preference storage. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(readTheme)
  const [error, setError] = useState(false)
  useEffect(() => { applyTheme(theme) }, [theme])
  const light = theme === 'light'
  return <div className="flex items-center gap-2">
    <button className="sar-button px-3 py-2 text-xs font-bold" data-testid="theme-toggle" aria-pressed={light} onClick={() => {
      const next: ThemeName = light ? 'standard' : 'light'
      setTheme(next)
      setError(!saveTheme(next))
    }} title={light ? 'Switch to the dark theme' : 'Switch to the light theme'} type="button">Theme: {light ? 'Light' : 'Dark'}</button>
    {error && <span role="alert" className="text-xs text-amber-200">Theme applied; could not save for next launch.</span>}
  </div>
}
