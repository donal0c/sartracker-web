// @vitest-environment node
import { describe, expect, it } from 'vitest'
import teamMissionChecks, { clickMap } from '../../scripts/team-smoke/checks/team-mission.mjs'
import { keepFindings, NotTested, ProductFailure } from '../../scripts/team-smoke/lib/results.mjs'

/** A page whose map canvas click fails or succeeds, with a given element on top. */
function fakePage(clickError: Error | null, cover: string | null) {
  const clicks: Array<Record<string, unknown>> = []
  const canvas = {
    first: () => canvas,
    click: async (options: Record<string, unknown>) => {
      clicks.push(options)
      if (clickError !== null) throw clickError
    },
    evaluate: async () => cover,
  }
  return { page: { locator: () => canvas }, clicks }
}

describe('team-mission map clicks', () => {
  it('clicks with Playwright waiting and passes the button through', async () => {
    const { page, clicks } = fakePage(null, 'ws-exceptions')
    await clickMap(page as never, { x: 10, y: 20 }, { button: 'right' })
    expect(clicks).toEqual([{ position: { x: 10, y: 20 }, timeout: 15_000, button: 'right' }])
  })

  it('names the cover as NOT TESTED when the click still fails on a covered point', async () => {
    const { page } = fakePage(new Error('locator.click: Timeout 15000ms exceeded.'), 'ws-exception-3018')
    const error = await clickMap(page as never, { x: 680, y: 240 }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(NotTested)
    expect((error as Error).message).toContain('"ws-exception-3018"')
  })

  it('keeps the original error when nothing covers the point', async () => {
    const original = new Error('locator.click: Target closed')
    const { page } = fakePage(original, null)
    await expect(clickMap(page as never, { x: 1, y: 1 })).rejects.toBe(original)
  })
})

describe('team-mission keeps product failures when a later step cannot run', () => {
  it('turns a tool stop after a finding into a FAIL that names both', () => {
    const error = keepFindings(['Measure after relaunch recorded 0 measurements, expected 1'], new NotTested('map point (360, 460) is covered by "ws-exceptions"'))
    expect(error).toBeInstanceOf(ProductFailure)
    expect((error as Error).message).toContain('recorded 0 measurements')
    expect((error as Error).message).toContain('covered by "ws-exceptions"')
  })

  it('leaves the error alone with no findings, or when it is already a FAIL', () => {
    const notTested = new NotTested('covered')
    expect(keepFindings([], notTested)).toBe(notTested)
    const failure = new ProductFailure('archive did not complete')
    expect(keepFindings(['earlier'], failure)).toBe(failure)
  })

  it('applies to the team-mission run: Measure failed, then the delete point was covered', async () => {
    const check = teamMissionChecks.find((entry: { id: string }) => entry.id === 'team-mission')
    const scenario = async (_ctx: unknown, findings: string[]) => {
      findings.push('Measure after relaunch recorded 0 measurements, expected 1')
      throw new NotTested('map point (360, 460) is covered by "ws-exceptions"')
    }
    const error = await check.run.call({ ...check, scenario }, {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProductFailure)
    expect((error as Error).message).toContain('recorded 0 measurements')
  })
})
