import { APP_VERSION_BASE, APP_VERSION_BUILD_ID } from './version.generated'

/**
 * Normalized baseline application version from repository metadata.
 */
export const APP_VERSION_BASELINE: string = APP_VERSION_BASE || '0.1.0'

/**
 * Raw build identifier appended during build time (for example: run.42.sha.abc123).
 */
export const APP_VERSION_BUILD_TAG: string = normalizeString(APP_VERSION_BUILD_ID) || 'local'

/**
 * Human-readable version string exposed in diagnostics and operator UI.
 */
export const APP_VERSION: string = buildAppVersion({
  appVersionBase: APP_VERSION_BASELINE,
  buildTag: APP_VERSION_BUILD_TAG,
})

/**
 * Builds a semver-style display version with optional build metadata.
 */
export function buildAppVersion(params: { readonly appVersionBase: string; readonly buildTag?: string }): string {
  const version = normalizeString(params.appVersionBase)
  const buildTag = normalizeString(params.buildTag ?? '')

  if (buildTag === '' || buildTag === 'local') {
    return version
  }

  return `${version}+${buildTag}`
}

function normalizeString(value: string): string {
  return value.trim()
}
