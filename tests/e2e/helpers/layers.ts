import { expect, type Page } from '@playwright/test'

/**
 * Unfolds every heading in the Layers panel, as the old Expand All button did.
 * The new Layers panel (DON-341) has no Expand All; each heading opens on its own.
 */
export async function expandAllLayers(page: Page): Promise<void> {
  const tree = page.getByTestId('layer-tree')
  await expect(tree).toBeVisible()
  const folded = tree.locator('[data-testid^="layer-expand-"]', { hasText: '▸' })
  for (let opened = 0; opened < 500; opened += 1) {
    if (await folded.count() === 0) return
    await folded.first().click()
  }
  throw new Error('Layers still had folded headings after 500 clicks.')
}
