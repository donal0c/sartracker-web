import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type WeatherLink = { readonly name: string; readonly url: string }
const { resolveAllowedWeatherUrl } = require('../../electron/external-url-policy.cjs') as {
  resolveAllowedWeatherUrl: (inputUrl: unknown, weatherLinks: readonly WeatherLink[]) => string
}

const LINKS: readonly WeatherLink[] = [
  { name: 'Met Éireann', url: 'https://www.met.ie/forecasts/kerry' },
  { name: 'Mountain forecast', url: 'http://forecast.example.org/' },
]

describe('external weather URL policy [DON-340]', () => {
  it('allows a saved weather link and other pages on its host', () => {
    expect(resolveAllowedWeatherUrl('https://www.met.ie/forecasts/kerry', LINKS)).toBe('https://www.met.ie/forecasts/kerry')
    expect(resolveAllowedWeatherUrl(' https://www.met.ie/warnings ', LINKS)).toBe('https://www.met.ie/warnings')
    expect(resolveAllowedWeatherUrl('http://forecast.example.org/today', LINKS)).toBe('http://forecast.example.org/today')
  })

  it('rejects hosts that are not saved weather links', () => {
    expect(() => resolveAllowedWeatherUrl('https://evil.example.com/', LINKS)).toThrow(/not one of the weather links saved in Settings/)
    expect(() => resolveAllowedWeatherUrl('https://met.ie.evil.example.com/', LINKS)).toThrow(/not one of the weather links/)
  })

  it('rejects a changed scheme or port on a saved host', () => {
    expect(() => resolveAllowedWeatherUrl('http://www.met.ie/forecasts/kerry', LINKS)).toThrow(/not one of the weather links/)
    expect(() => resolveAllowedWeatherUrl('https://www.met.ie:8443/', LINKS)).toThrow(/not one of the weather links/)
  })

  it('rejects schemes other than http and https', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'smb://share/x']) {
      expect(() => resolveAllowedWeatherUrl(url, LINKS)).toThrow(/http or https/)
    }
  })

  it('rejects empty, malformed, non-string and credential-bearing URLs', () => {
    expect(() => resolveAllowedWeatherUrl('', LINKS)).toThrow(/required/)
    expect(() => resolveAllowedWeatherUrl(undefined, LINKS)).toThrow(/required/)
    expect(() => resolveAllowedWeatherUrl(42, LINKS)).toThrow(/required/)
    expect(() => resolveAllowedWeatherUrl('https://', LINKS)).toThrow(/not a valid web address/)
    expect(() => resolveAllowedWeatherUrl('https://user:pass@www.met.ie/', LINKS)).toThrow(/user name or password/)
  })

  it('rejects everything when no weather links are saved, and ignores unsafe saved links', () => {
    expect(() => resolveAllowedWeatherUrl('https://www.met.ie/', [])).toThrow(/not one of the weather links/)
    expect(() => resolveAllowedWeatherUrl('https://www.met.ie/', [{ name: 'x', url: 'javascript:alert(1)' }, { name: 'y', url: 'not a url' }])).toThrow(/not one of the weather links/)
  })
})
