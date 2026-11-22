// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resumeRecoveredMission } from '../../scripts/mission-recovery.mjs'

/**
 * A stand-in for the packaged app window: which recovery prompt is on screen,
 * and what a click on its Resume button does.
 */
function fakePage(initial: { dialog?: boolean; card?: boolean }, onResume: (state: { dialog: boolean; card: boolean }) => void) {
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

describe('packaged mission recovery helper [DON-353]', () => {
  it('resumes through the new Resume card', async () => {
    const { page, clicks } = fakePage({ card: true }, (state) => { state.card = false })
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 })).resolves.toBe('card')
    expect(clicks).toEqual(['card'])
  })

  it('resumes through the older recovery dialog', async () => {
    const { page, clicks } = fakePage({ dialog: true }, (state) => { state.dialog = false })
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 })).resolves.toBe('dialog')
    expect(clicks).toEqual(['dialog'])
  })

  it('fails loudly when neither prompt appears, rather than skipping recovery', async () => {
    const { page, clicks } = fakePage({}, () => undefined)
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 }))
      .rejects.toThrow(/neither the Resume card nor the recovery dialog appeared/)
    expect(clicks).toEqual([])
  })

  it('fails when the prompt is still shown after Resume', async () => {
    const { page } = fakePage({ card: true }, () => undefined)
    await expect(resumeRecoveredMission(page, { timeoutMs: 50 })).rejects.toThrow(/still shown after Resume/)
  })

  it('lets the caller own the click', async () => {
    const seen: string[] = []
    const { page, clicks } = fakePage({ card: true }, (state) => { state.card = false })
    await resumeRecoveredMission(page, { timeoutMs: 50, click: async (button, surface) => { seen.push(surface); await button.click() } })
    expect(seen).toEqual(['card'])
    expect(clicks).toEqual(['card'])
  })
})
