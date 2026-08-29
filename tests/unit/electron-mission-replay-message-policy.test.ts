import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { assertReplayResultBounded } = require(
  '../../electron/mission-replay-message-policy.cjs',
) as {
  assertReplayResultBounded(result: unknown, trackLimit: number): void
}

describe('mission replay worker message policy [DON-278]', () => {
  it('accepts one ordinary bounded replay page', () => {
    expect(() => assertReplayResultBounded({
      tracks: [],
      objects: [{ state: { name: 'Area Alpha' } }],
      limitations: [],
      participants: [],
      groupMembership: [],
    }, 100)).not.toThrow()
  })

  it('rejects an oversized result before the worker posts it to main', () => {
    expect(() => assertReplayResultBounded({
      tracks: [],
      objects: [{ state: { geometry: 'x'.repeat(700_000) } }],
      limitations: [],
      participants: [],
      groupMembership: [],
    }, 100)).toThrow(/byte budget/i)
  })
})
