/** Recognize only the explicit network-blocking contract, never a local asset failure. */
export function isExpectedBlockedReplayRequest(url, failure) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
      && failure === 'net::ERR_BLOCKED_BY_CLIENT'
  } catch {
    return false
  }
}
