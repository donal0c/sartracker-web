// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { confirmResumedMission, resumeRecoveredMission } from '../../scripts/mission-recovery.mjs'

type PromptState = { dialog: boolean; card: boolean }

/**
 * A stand-in for the packaged app window: which recovery prompt is on screen,
 * and what a click on its Resume button does.
 */
function fakePage(initial: { dialog?: boolean; card?: boolean }, onResume: (state: PromptState) => void) {
  const state = { dialog: initial.dialog === true, card: initial.card === true }
  const clicks: string[] = []
  const button = (name: string) => ({
    click: async () => { clicks.push(name); onResume(state) },
  })
  const page = {
    getByTestId: (id: string) => {
      if (id === 'mission-recovery-dialog') {
        return { isVisible: async () => state.dialog, getByRole: () => button('dialog') }
      }
      if (id === 'start-screen-resume') return { isVisible: async () => state.card }
      if (id === 'start-screen-resume-btn') return button('card')
      throw new Error(`unexpected test id ${id}`)
    },
    waitForTimeout: async () => undefined,
  }
  return { page, clicks }
}

/**
 * A stand-in for the app window after Resume: what the store's bridge reports
 * as the active mission, and the renderer's mission phase.
 */
function fakeRecoveredPage(
  mission: { id: string; status: string } | null,
  rendererPhase: string | null,
) {
  return {
    evaluate: async () => mission,
    locator: (selector: string) => ({
      count: async () => (rendererPhase !== null && selector.includes(`data-mission-phase="${rendererPhase}"`) ? 1 : 0),
    }),
    waitForTimeout: async () => undefined,
  }
}

describe('packaged mission recovery helper [DON-353]', () => {
  it('resumes through the Resume card', async () => {
    const { page, clicks } = fakePage({ card: true }, (state) => { state.card = false })
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 })).resolves.toBe('card')
    expect(clicks).toEqual(['card'])
  })

  it('does not accept the classic recovery dialog unless the caller asks for it', async () => {
    const { page, clicks } = fakePage({ dialog: true }, (state) => { state.dialog = false })
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 }))
      .rejects.toThrow(/Resume card did not appear/)
    expect(clicks).toEqual([])
  })

  it('accepts the classic recovery dialog only with the explicit legacy flag', async () => {
    const { page, clicks } = fakePage({ dialog: true }, (state) => { state.dialog = false })
    await expect(resumeRecoveredMission(page, { timeoutMs: 50, legacyDialog: true })).resolves.toBe('dialog')
    expect(clicks).toEqual(['dialog'])
  })

  it('fails loudly when no prompt appears, rather than skipping recovery', async () => {
    const { page, clicks } = fakePage({}, () => undefined)
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 }))
      .rejects.toThrow(/Resume card did not appear/)
    await expect(resumeRecoveredMission(page, { timeoutMs: 50, legacyDialog: true }))
      .rejects.toThrow(/neither the Resume card nor the recovery dialog appeared/)
    expect(clicks).toEqual([])
  })

  it('fails when the prompt is still shown after Resume', async () => {
    const { page } = fakePage({ card: true }, () => undefined)
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 })).rejects.toThrow(/still shown after Resume/)
  })

  it('fails when Resume swaps the card for the recovery dialog', async () => {
    const swap = (state: PromptState) => { state.card = false; state.dialog = true }
    await expect(resumeRecoveredMission(fakePage({ card: true }, swap).page, { timeoutMs: 50 }))
      .rejects.toThrow(/still shown after Resume/)
    await expect(resumeRecoveredMission(fakePage({ card: true }, swap).page, { timeoutMs: 50, legacyDialog: true }))
      .rejects.toThrow(/still shown after Resume/)
  })

  it('lets the caller own the click', async () => {
    const seen: string[] = []
    const { page, clicks } = fakePage({ card: true }, (state) => { state.card = false })
    await resumeRecoveredMission(page, { timeoutMs: 50, click: async (button, surface) => { seen.push(surface); await button.click() } })
    expect(seen).toEqual(['card'])
    expect(clicks).toEqual(['card'])
  })
})

describe('confirming the resumed mission [DON-353]', () => {
  it('accepts the same mission, running in the store and in the renderer', async () => {
    const page = fakeRecoveredPage({ id: 'mission-1', status: 'active' }, 'active')
    await expect(confirmResumedMission(page, 'mission-1', { timeoutMs: 50 }))
      .resolves.toEqual({ id: 'mission-1', status: 'active' })
  })

  it('rejects a different mission than the one interrupted', async () => {
    const page = fakeRecoveredPage({ id: 'mission-2', status: 'active' }, 'active')
    await expect(confirmResumedMission(page, 'mission-1', { timeoutMs: 50 }))
      .rejects.toThrow(/recovered mission mission-2, expected mission-1/)
  })

  it('rejects a recovery that left the mission paused', async () => {
    const page = fakeRecoveredPage({ id: 'mission-1', status: 'paused' }, 'paused')
    await expect(confirmResumedMission(page, 'mission-1', { timeoutMs: 50 }))
      .rejects.toThrow(/not running.*store status paused/)
  })

  it('rejects a recovery with no active mission at all', async () => {
    const page = fakeRecoveredPage(null, null)
    await expect(confirmResumedMission(page, 'mission-1', { timeoutMs: 50 }))
      .rejects.toThrow(/not running.*no active mission/)
  })

  it('rejects a store that says running while the renderer does not', async () => {
    const page = fakeRecoveredPage({ id: 'mission-1', status: 'active' }, 'paused')
    await expect(confirmResumedMission(page, 'mission-1', { timeoutMs: 50 }))
      .rejects.toThrow(/renderer.*not show the mission running/)
  })
})
