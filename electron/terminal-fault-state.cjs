'use strict'

/**
 * Tracks the one process-wide response to a terminal fault.
 *
 * A startup failure or fatal runtime fault decides whether the process exits,
 * relaunches, or stays open. Once a response withholds relaunch, or keeps the
 * process open so the single-instance lock protects a profile whose diagnostic
 * writer may still be live, no later fault, quit request, or second launch may
 * undo that decision.
 *
 * Phases:
 * - `none`: no terminal fault has been handled in this session.
 * - `startup-failure`: the startup failure response owns process exit.
 * - `responding`: a fatal runtime response is collecting evidence.
 * - `relaunching`: the fatal response is relaunching and exiting.
 * - `relaunch-withheld`: relaunch was withheld; a quit may exit but must not
 *   mark the session clean.
 * - `writer-unreaped`: the process holds the lock and must not exit normally.
 */
function createTerminalFaultState() {
  let phase = 'none'
  let notice = null

  return Object.freeze({
    /** Claims process exit for a startup failure unless a fault response already owns it. */
    beginStartupFailure() {
      if (phase !== 'none') return false
      phase = 'startup-failure'
      return true
    },
    /** Claims the fatal response; false when another response or hold already owns the process. */
    beginFatalResponse() {
      if (phase !== 'none') return false
      phase = 'responding'
      return true
    },
    /** Records that the fatal response is relaunching and exiting the process. */
    markRelaunching() {
      if (phase === 'responding') phase = 'relaunching'
    },
    /** Withholds automatic relaunch without weakening an existing lock hold. */
    withholdRelaunch(nextNotice) {
      const frozenNotice = freezeNotice(nextNotice)
      if (phase === 'writer-unreaped') return
      phase = 'relaunch-withheld'
      notice = frozenNotice
    },
    /** Keeps the process and its single-instance lock because a writer may still be live. */
    holdForUnreapedWriter(nextNotice) {
      const frozenNotice = freezeNotice(nextNotice)
      phase = 'writer-unreaped'
      notice = frozenNotice
    },
    /** Returns the current phase for diagnostics and tests. */
    get phase() {
      return phase
    },
    /** Returns the operator notice to repeat to a second launch, or null. */
    get notice() {
      return notice
    },
    /** True only while no terminal fault has been handled in this session. */
    allowsCleanExitMarker() {
      return phase === 'none'
    },
    /** True when an ordinary quit request must not start teardown at all. */
    blocksQuit() {
      return phase === 'startup-failure'
        || phase === 'responding'
        || phase === 'relaunching'
        || phase === 'writer-unreaped'
    },
  })
}

/** Validates and freezes one operator notice. */
function freezeNotice(value) {
  if (typeof value?.title !== 'string' || value.title.trim() === ''
    || typeof value.message !== 'string' || value.message.trim() === '') {
    throw new Error('A terminal fault hold requires an operator notice title and message.')
  }
  return Object.freeze({ title: value.title, message: value.message })
}

module.exports = { createTerminalFaultState }
