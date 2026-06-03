import type { OfficialMapId } from '../../lib/map-config'

export type OfficialMapSourceStatus = 'not_configured' | 'configured' | 'missing' | 'invalid'

export type OfficialMapSourceMetadata = {
  readonly status: OfficialMapSourceStatus
  readonly username: string
  readonly availableSources: readonly OfficialMapId[]
  readonly serviceCount: number
  readonly message: string
}

const SOURCE_PATTERNS: readonly { readonly id: OfficialMapId; readonly pattern: RegExp }[] = [
  { id: 'official_discovery_topo', pattern: /\bdiscovery\b/i },
  { id: 'official_premium_basemap', pattern: /\bbasemap_premium\b/i },
  { id: 'official_aerial_imagery', pattern: /\bortho\b/i },
  {
    id: 'official_high_resolution_imagery',
    pattern: /\bNational_High_Resolution_Imagery\b/i,
  },
] as const

/**
 * Extracts safe MapGenie source metadata from the team-provided details file.
 * The password is deliberately not returned or persisted.
 */
export function parseMapGenieSourceDetails(contents: string): OfficialMapSourceMetadata {
  const username = extractFirstMatch(contents, /^Username:\s*(\S+)/im)
  const availableSources = SOURCE_PATTERNS
    .filter((source) => source.pattern.test(contents))
    .map((source) => source.id)
  const hasDiscovery = availableSources.includes('official_discovery_topo')
  const status: OfficialMapSourceStatus = hasDiscovery ? 'configured' : 'invalid'

  return {
    status,
    username,
    availableSources,
    serviceCount: availableSources.length,
    message: hasDiscovery
      ? 'Official Discovery Topo source configured.'
      : 'MapGenie source file is missing the Discovery Topo service.',
  }
}

function extractFirstMatch(contents: string, pattern: RegExp): string {
  return pattern.exec(contents)?.[1] ?? ''
}
