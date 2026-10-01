import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// DON-299 class 1 (escape analysis of DON-295 and DON-118): a value saved in
// localStorage or per-mission layer state must never decide what is tracked
// or recorded. These modules own recording; none of them may reach a stored
// view preference, however indirectly.
const RECORDING_ENTRY_POINTS = [
  'src/features/tracking/start-tracking-runtime.ts',
  'src/features/tracking/polling-manager.ts',
  'src/features/tracking/breadcrumb-history-reconciler.ts',
  'src/features/participants/start-participant-runtime.ts',
  'src/features/participants/participant-backfill-runtime.ts',
]

// Stored view preferences: what is shown, never what is recorded.
const VIEW_STATE_MODULES = [
  'src/features/layers/layer-visibility-store.ts',
  'src/features/layers/layer-visibility-service.ts',
  'src/features/layers/layer-tree-ui-store.ts',
  'src/features/focus-mode/focus-mode-store.ts',
  'src/features/tracking/tracking-style-store.ts',
  'src/lib/map-preferences.ts',
  'src/lib/coordinate-preferences.ts',
  'src/lib/theme-preference.ts',
]

const IMPORT_PATTERN = /(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu

/** Resolves a relative TypeScript import to its source file, if it is one. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = path.normalize(path.join(path.dirname(fromFile), specifier))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (/\.tsx?$/u.test(candidate) && existsSync(candidate)) return candidate
  }
  return null
}

/** Walks the static import graph and returns the chain to the first forbidden module. */
function findPathToViewState(entry: string): readonly string[] | null {
  const forbidden = new Set(VIEW_STATE_MODULES.map((file) => path.normalize(file)))
  const parents = new Map<string, string | null>([[entry, null]])
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (forbidden.has(file)) {
      const chain = [file]
      for (let parent = parents.get(file) ?? null; parent !== null; parent = parents.get(parent) ?? null) chain.unshift(parent)
      return chain
    }
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      if (/^\s*import\s+type\s/u.test(match[0])) continue
      const resolved = resolveImport(file, match[1] ?? match[2]!)
      if (resolved !== null && !parents.has(resolved)) {
        parents.set(resolved, file)
        queue.push(resolved)
      }
    }
  }
  return null
}

describe('recording never depends on stored view state [DON-299]', () => {
  it.each(RECORDING_ENTRY_POINTS)('%s cannot reach a stored view preference', (entry) => {
    expect(existsSync(entry)).toBe(true)
    expect(findPathToViewState(path.normalize(entry))).toBeNull()
  })

  it('detects a forbidden dependency when one exists', () => {
    expect(findPathToViewState(path.normalize('src/features/tracking/sync-tracking-overlay.ts'))).not.toBeNull()
  })
})
