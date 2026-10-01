/**
 * MapLibre reports a WebGL creation error as a JSON object; keep only the
 * readable message and the browser's own status text.
 */
export function describeRendererFailure(reason: string): string {
  try {
    const parsed: unknown = JSON.parse(reason)
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed && typeof parsed.message === 'string') {
      const status = 'statusMessage' in parsed && typeof parsed.statusMessage === 'string' && parsed.statusMessage !== ''
        ? ` (${parsed.statusMessage})`
        : ''
      return `${parsed.message}${status}`
    }
  } catch {
    // Not JSON: the reason is already plain text.
  }
  return reason
}
