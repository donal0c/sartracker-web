import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { getBundleBudget } from '../build/bundle-budgets.js'

const assetsDir = path.resolve('dist/assets')
const entries = await readdir(assetsDir)
const oversizedAssets = []

for (const entry of entries) {
  if (!entry.endsWith('.js') && !entry.endsWith('.css')) {
    continue
  }

  const assetPath = path.join(assetsDir, entry)
  const assetStats = await stat(assetPath)
  const budget = getBundleBudget(entry)

  if (assetStats.size > budget.maxBytes) {
    oversizedAssets.push({
      name: entry,
      size: assetStats.size,
      maxBytes: budget.maxBytes,
      reason: budget.reason,
    })
  }
}

if (oversizedAssets.length > 0) {
  const details = oversizedAssets
    .map(
      (asset) =>
        `${asset.name} is ${asset.size} bytes (budget ${asset.maxBytes}). ${asset.reason}`,
    )
    .join('\n')

  throw new Error(`Bundle size budget exceeded:\n${details}`)
}

console.log('Bundle size budgets passed.')
