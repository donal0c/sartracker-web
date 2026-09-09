import { useEffect, useState } from 'react'

import { readTheme, THEME_KEY } from '../lib/theme-preference'

/** Offers a persisted high-contrast variant and reports unavailable preference storage. */
export function ThemeToggle() {
  const [contrast, setContrast] = useState(readTheme)
  const [error, setError] = useState(false)
  useEffect(() => { document.documentElement.dataset.theme = contrast ? 'high-contrast' : 'standard' }, [contrast])
  return <div className="flex items-center gap-2">
    <button className="sar-button px-3 py-2 text-xs font-bold" data-testid="theme-toggle" aria-pressed={contrast} onClick={() => {
      const next = !contrast
      setContrast(next)
      try { window.localStorage.setItem(THEME_KEY, String(next)); setError(false) }
      catch { setError(true) }
    }} type="button">Theme: {contrast ? 'High contrast' : 'Standard'}</button>
    {error && <span role="alert" className="text-xs text-amber-200">Theme applied; could not save for next launch.</span>}
  </div>
}
