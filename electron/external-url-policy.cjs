'use strict'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Parses one saved weather link into its origin, or null when the saved value
 * is not a usable http/https address.
 *
 * @param {unknown} url the saved weather link URL
 * @returns {string | null}
 */
function weatherLinkOrigin(url) {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url.trim())
    return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed.origin : null
  } catch {
    return null
  }
}

/**
 * Decides whether the renderer may open a URL in the system browser. Only
 * http/https addresses on the same scheme, host and port as a weather link
 * saved in Settings are allowed, so a compromised renderer cannot use the
 * external-link bridge to open arbitrary sites or local files [DON-340].
 *
 * @param {unknown} inputUrl the URL the renderer asked to open
 * @param {ReadonlyArray<{ url: unknown }>} weatherLinks the saved weather links
 * @returns {string} the normalised URL to open
 * @throws {Error} with an operator-readable reason when the URL is refused
 */
function resolveAllowedWeatherUrl(inputUrl, weatherLinks) {
  const trimmed = typeof inputUrl === 'string' ? inputUrl.trim() : ''
  if (trimmed === '') {
    throw new Error('A web address is required to open a weather link.')
  }

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:/i.test(trimmed)) {
      throw new Error('Weather links must use http or https.')
    }
    throw new Error('The weather link is not a valid web address.')
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Weather links must use http or https.')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Weather links must not contain a user name or password.')
  }

  const allowedOrigins = new Set(
    (Array.isArray(weatherLinks) ? weatherLinks : [])
      .map((link) => weatherLinkOrigin(link?.url))
      .filter((origin) => origin !== null),
  )
  if (!allowedOrigins.has(parsed.origin)) {
    throw new Error('This address is not one of the weather links saved in Settings, so it was not opened.')
  }

  return parsed.href
}

module.exports = { resolveAllowedWeatherUrl }
