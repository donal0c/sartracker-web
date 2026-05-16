/**
 * Returns the clean URL used after a startup fault, stripping harness/deep-link state.
 */
export function runtimeFaultReloadTarget(currentHref: string): string {
  const url = new URL(currentHref)
  url.search = ''
  url.hash = ''

  return url.toString()
}

/**
 * Reloads the startup fault shell into a clean operational URL.
 */
export function reloadRuntimeFaultShell(): void {
  window.location.assign(runtimeFaultReloadTarget(window.location.href))
}
