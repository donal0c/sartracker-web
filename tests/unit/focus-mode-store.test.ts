// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  persistFocusMode,
  readStoredFocusMode,
} from '../../src/features/focus-mode/focus-mode-store'

describe('focus-mode-store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to inactive when no preference is stored', () => {
    expect(readStoredFocusMode()).toBe(false)
  })

  it('persists active state for reload recovery', () => {
    persistFocusMode(true)

    expect(readStoredFocusMode()).toBe(true)
  })

  it('persists inactive state when focus mode is exited', () => {
    persistFocusMode(true)
    persistFocusMode(false)

    expect(readStoredFocusMode()).toBe(false)
  })
})
