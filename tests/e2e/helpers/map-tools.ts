import { expect, type Page } from '@playwright/test'

/**
 * Arms one Map Tools tool, then folds the toolbar so it no longer covers the
 * map. In the new layout (DON-341) the map starts at the left edge, so the
 * open toolbar sits over the points the tests click. Folding keeps the tool
 * armed; the folded toolbar still names it and shows its hint.
 */
export async function armMapTool(page: Page, tool: string): Promise<void> {
  const expand = page.getByTestId('drawing-toolbar-expand')
  if (await expand.isVisible()) await expand.click()
  await page.getByTestId(`drawing-tool-${tool}`).click({ force: true })
  const collapse = page.getByTestId('drawing-toolbar-collapse')
  if (await collapse.isVisible()) await collapse.click()
  await expect(page.getByTestId('drawing-toolbar-expand')).toBeVisible()
}
