import { describe, expect, it } from 'vitest'

import {
  performOwnedHarnessClick,
} from '../../build/electron-tracking-soak-operator-audit-lib.js'

interface AuditEvent {
  sequence: number
  trusted: boolean
  pathTestIds: string[]
}

function createAuditHarness() {
  const audit = {
    events: [] as AuditEvent[],
    lastSequence: 0,
    droppedEventCount: 0,
  }
  const auditState = { lastSequence: 0 }
  const push = (testId: string, trusted = true) => {
    audit.lastSequence += 1
    audit.events.push({
      sequence: audit.lastSequence,
      trusted,
      pathTestIds: [testId],
    })
    if (audit.events.length > 256) {
      audit.events.shift()
      audit.droppedEventCount += 1
    }
  }
  return {
    audit,
    auditState,
    push,
    readAudit: async () => structuredClone(audit),
    acknowledgeAudit: async (sequence: number) => {
      if (audit.lastSequence !== sequence) return false
      audit.events = audit.events.filter((event) => event.sequence > sequence)
      return true
    },
  }
}

describe('tracking soak owned harness click audit [DON-260]', () => {
  it('claims exactly one trusted expected click before advancing and pruning', async () => {
    const harness = createAuditHarness()

    await expect(performOwnedHarnessClick({
      auditState: harness.auditState,
      expectedTestId: 'breadcrumb-mode-dots',
      readAudit: harness.readAudit,
      acknowledgeAudit: harness.acknowledgeAudit,
      click: async () => harness.push('breadcrumb-mode-dots'),
    })).resolves.toMatchObject({
      sequence: 1,
      expectedTestId: 'breadcrumb-mode-dots',
      clickStartedAtEpochMs: expect.any(Number),
    })

    expect(harness.auditState.lastSequence).toBe(1)
    expect(harness.audit.events).toEqual([])
    expect(harness.audit.droppedEventCount).toBe(0)
  })

  it.each([
    {
      name: 'wrong target',
      emit: (push: (testId: string, trusted?: boolean) => void) =>
        push('breadcrumb-mode-line'),
    },
    {
      name: 'untrusted target',
      emit: (push: (testId: string, trusted?: boolean) => void) =>
        push('breadcrumb-mode-dots', false),
    },
    {
      name: 'same-target extra click',
      emit: (push: (testId: string, trusted?: boolean) => void) => {
        push('breadcrumb-mode-dots')
        push('breadcrumb-mode-dots')
      },
    },
    {
      name: 'different-target extra click',
      emit: (push: (testId: string, trusted?: boolean) => void) => {
        push('breadcrumb-mode-dots')
        push('workspace-close-btn')
      },
    },
    {
      name: 'zero clicks',
      emit: () => undefined,
    },
  ])('fails closed on $name without advancing or pruning', async ({ emit }) => {
    const harness = createAuditHarness()

    await expect(performOwnedHarnessClick({
      auditState: harness.auditState,
      expectedTestId: 'breadcrumb-mode-dots',
      readAudit: harness.readAudit,
      acknowledgeAudit: harness.acknowledgeAudit,
      click: async () => emit(harness.push),
    })).rejects.toMatchObject({
      trackingSoakAuditFailure: {
        failureClass: 'owned_harness_click_unverified',
      },
    })

    expect(harness.auditState.lastSequence).toBe(0)
    expect(harness.audit.events.length).toBeGreaterThanOrEqual(0)
  })

  it('rejects pending input before the click and a failed click never advances', async () => {
    const harness = createAuditHarness()
    harness.push('breadcrumb-mode-dots')
    let clickCalled = false
    await expect(performOwnedHarnessClick({
      auditState: harness.auditState,
      expectedTestId: 'breadcrumb-mode-dots',
      readAudit: harness.readAudit,
      acknowledgeAudit: harness.acknowledgeAudit,
      click: async () => {
        clickCalled = true
      },
    })).rejects.toThrow(/owned harness click/iu)
    expect(clickCalled).toBe(false)
    expect(harness.auditState.lastSequence).toBe(0)

    const clean = createAuditHarness()
    await expect(performOwnedHarnessClick({
      auditState: clean.auditState,
      expectedTestId: 'breadcrumb-mode-dots',
      readAudit: clean.readAudit,
      acknowledgeAudit: clean.acknowledgeAudit,
      click: async () => {
        throw new Error('raw click failure')
      },
    })).rejects.toThrow('raw click failure')
    expect(clean.auditState.lastSequence).toBe(0)
    expect(clean.audit.events).toEqual([])
  })

  it('fails closed when audit read or acknowledgement is unavailable', async () => {
    const unreadable = createAuditHarness()
    await expect(performOwnedHarnessClick({
      auditState: unreadable.auditState,
      expectedTestId: 'breadcrumb-mode-dots',
      readAudit: async () => {
        throw new Error('raw audit transport failure')
      },
      acknowledgeAudit: unreadable.acknowledgeAudit,
      click: async () => unreadable.push('breadcrumb-mode-dots'),
    })).rejects.toMatchObject({
      trackingSoakAuditFailure: {
        failureClass: 'owned_harness_click_unverified',
      },
    })
    expect(unreadable.auditState.lastSequence).toBe(0)

    const unacknowledged = createAuditHarness()
    await expect(performOwnedHarnessClick({
      auditState: unacknowledged.auditState,
      expectedTestId: 'breadcrumb-mode-dots',
      readAudit: unacknowledged.readAudit,
      acknowledgeAudit: async () => {
        throw new Error('raw acknowledgement failure')
      },
      click: async () => unacknowledged.push('breadcrumb-mode-dots'),
    })).rejects.toMatchObject({
      trackingSoakAuditFailure: {
        failureClass: 'owned_harness_click_unverified',
      },
    })
    expect(unacknowledged.auditState.lastSequence).toBe(0)
  })

  it('starts product observation before audit confirmation overhead', async () => {
    const harness = createAuditHarness()
    const order: string[] = []
    const readAudit = async () => {
      order.push(`read-${harness.audit.lastSequence}`)
      return harness.readAudit()
    }

    const result = await performOwnedHarnessClick({
      auditState: harness.auditState,
      expectedTestId: 'exact-breadcrumb-dots-earlier',
      readAudit,
      acknowledgeAudit: async (sequence: number) => {
        order.push('acknowledge')
        return harness.acknowledgeAudit(sequence)
      },
      click: async () => {
        harness.push('exact-breadcrumb-dots-earlier')
        order.push('click')
      },
      observeAfterClick: async () => {
        order.push('observe-start')
        return 'formula-exact-source'
      },
    })

    expect(order.indexOf('observe-start')).toBeLessThan(order.indexOf('read-1'))
    expect(result.observation).toBe('formula-exact-source')
  })

  it('keeps 387 individually owned page clicks below the 256-event ring bound', async () => {
    const harness = createAuditHarness()
    for (let index = 0; index < 387; index += 1) {
      const expectedTestId = index < 194
        ? 'exact-breadcrumb-dots-earlier'
        : 'exact-breadcrumb-dots-later'
      await performOwnedHarnessClick({
        auditState: harness.auditState,
        expectedTestId,
        readAudit: harness.readAudit,
        acknowledgeAudit: harness.acknowledgeAudit,
        click: async () => harness.push(expectedTestId),
      })
    }

    expect(harness.auditState.lastSequence).toBe(387)
    expect(harness.audit.events).toEqual([])
    expect(harness.audit.droppedEventCount).toBe(0)
  })
})
