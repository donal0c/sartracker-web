import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createTerminalFaultState } = require('../../electron/terminal-fault-state.cjs') as {
  readonly createTerminalFaultState: () => TerminalFaultState
}

type Notice = { readonly title: string; readonly message: string }
type TerminalFaultState = {
  readonly beginStartupFailure: () => boolean
  readonly beginFatalResponse: () => boolean
  readonly markRelaunching: () => void
  readonly withholdRelaunch: (notice: Notice) => void
  readonly holdForUnreapedWriter: (notice: Notice) => void
  readonly phase: string
  readonly notice: Notice | null
  readonly allowsCleanExitMarker: () => boolean
  readonly blocksQuit: () => boolean
}

const WITHHELD = { title: 'SAR Tracker could not restart safely', message: 'Relaunch withheld.' }
const UNREAPED = { title: 'SAR Tracker could not close safely', message: 'Writer still live.' }

describe('terminal fault state', () => {
  it('lets exactly one fatal response own the process', () => {
    const state = createTerminalFaultState()

    expect(state.allowsCleanExitMarker()).toBe(true)
    expect(state.blocksQuit()).toBe(false)
    expect(state.beginFatalResponse()).toBe(true)
    expect(state.beginFatalResponse()).toBe(false)
    expect(state.blocksQuit()).toBe(true)
    state.markRelaunching()
    expect(state.phase).toBe('relaunching')
    expect(state.beginFatalResponse()).toBe(false)
  })

  it('keeps a withheld relaunch from ever marking the session clean', () => {
    const state = createTerminalFaultState()
    state.beginFatalResponse()
    state.withholdRelaunch(WITHHELD)

    expect(state.phase).toBe('relaunch-withheld')
    expect(state.notice).toEqual(WITHHELD)
    expect(state.allowsCleanExitMarker()).toBe(false)
    expect(state.blocksQuit()).toBe(false)
    expect(state.beginFatalResponse()).toBe(false)
    state.markRelaunching()
    expect(state.phase).toBe('relaunch-withheld')
  })

  it('never downgrades an unreaped-writer lock hold', () => {
    const state = createTerminalFaultState()
    state.beginFatalResponse()
    state.holdForUnreapedWriter(UNREAPED)
    state.withholdRelaunch(WITHHELD)
    state.markRelaunching()

    expect(state.phase).toBe('writer-unreaped')
    expect(state.notice).toEqual(UNREAPED)
    expect(state.blocksQuit()).toBe(true)
    expect(state.allowsCleanExitMarker()).toBe(false)
  })

  it('keeps a fatal fault from taking over an in-progress startup failure', () => {
    const state = createTerminalFaultState()

    expect(state.beginStartupFailure()).toBe(true)
    expect(state.beginFatalResponse()).toBe(false)
    expect(state.beginStartupFailure()).toBe(false)
    expect(state.blocksQuit()).toBe(true)
    state.holdForUnreapedWriter(UNREAPED)
    expect(state.phase).toBe('writer-unreaped')
  })

  it('refuses a hold without an operator notice', () => {
    const state = createTerminalFaultState()

    expect(() => state.holdForUnreapedWriter({ title: '', message: 'x' })).toThrow(/operator notice/u)
    expect(() => state.withholdRelaunch({ title: 'x', message: ' ' })).toThrow(/operator notice/u)
  })
})
