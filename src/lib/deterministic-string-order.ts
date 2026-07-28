/**
 * Compares strings by JavaScript code-unit order without consulting the host
 * locale or ICU data.
 */
export function compareStringsByCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
