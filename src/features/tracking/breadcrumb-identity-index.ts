import type { NormalizedTrackingPosition } from './tracking-types'
import { createTrackingPositionIdentityKey } from './tracking-position-identity'

const IDENTITIES_PER_BLOCK = 1_024
const BITS_PER_WORD = 32
const WORDS_PER_BLOCK = IDENTITIES_PER_BLOCK / BITS_PER_WORD
const BYTES_PER_BLOCK = WORDS_PER_BLOCK * Uint32Array.BYTES_PER_ELEMENT

export type BreadcrumbIdentityStorageStats = {
  readonly identityCount: number
  readonly numericBlockCount: number
  readonly numericBlockBytes: number
  readonly fallbackIdentityCount: number
}

export type BreadcrumbIdentityIndex = {
  readonly add: (position: NormalizedTrackingPosition) => boolean
  readonly delete: (position: NormalizedTrackingPosition) => boolean
  readonly has: (position: NormalizedTrackingPosition) => boolean
  readonly getStorageStats: () => BreadcrumbIdentityStorageStats
}

/**
 * Creates an exact breadcrumb identity index whose numeric Traccar IDs use
 * sparse bit blocks instead of one JavaScript string allocation per fix.
 *
 * Traccar position IDs are positive safe integers after normalization. Legacy
 * mission rows have no upstream ID, so their coordinate identities use the
 * small fallback set until the reconciliation sweep upgrades them.
 */
export function createBreadcrumbIdentityIndex(): BreadcrumbIdentityIndex {
  const numericBlocks = new Map<number, Uint32Array>()
  const fallbackIdentities = new Set<string>()
  let numericIdentityCount = 0

  const has = (position: NormalizedTrackingPosition): boolean => {
    const numericIdentity = parseNumericSourceIdentity(position.id)
    if (numericIdentity === null) {
      return fallbackIdentities.has(createTrackingPositionIdentityKey(position))
    }

    const location = getNumericIdentityLocation(numericIdentity)
    const block = numericBlocks.get(location.blockIndex)
    if (block === undefined) {
      return false
    }
    return (block[location.wordIndex]! & location.bitMask) !== 0
  }

  const add = (position: NormalizedTrackingPosition): boolean => {
    const numericIdentity = parseNumericSourceIdentity(position.id)
    if (numericIdentity === null) {
      const sizeBefore = fallbackIdentities.size
      fallbackIdentities.add(createTrackingPositionIdentityKey(position))
      return fallbackIdentities.size !== sizeBefore
    }

    const location = getNumericIdentityLocation(numericIdentity)
    let block = numericBlocks.get(location.blockIndex)
    if (block === undefined) {
      block = new Uint32Array(WORDS_PER_BLOCK)
      numericBlocks.set(location.blockIndex, block)
    }
    if ((block[location.wordIndex]! & location.bitMask) !== 0) {
      return false
    }

    block[location.wordIndex] = block[location.wordIndex]! | location.bitMask
    numericIdentityCount += 1
    return true
  }

  const deleteIdentity = (position: NormalizedTrackingPosition): boolean => {
    const numericIdentity = parseNumericSourceIdentity(position.id)
    if (numericIdentity === null) {
      return fallbackIdentities.delete(createTrackingPositionIdentityKey(position))
    }

    const location = getNumericIdentityLocation(numericIdentity)
    const block = numericBlocks.get(location.blockIndex)
    if (
      block === undefined ||
      (block[location.wordIndex]! & location.bitMask) === 0
    ) {
      return false
    }

    block[location.wordIndex] = block[location.wordIndex]! & ~location.bitMask
    numericIdentityCount -= 1
    if (block.every((word) => word === 0)) {
      numericBlocks.delete(location.blockIndex)
    }
    return true
  }

  return {
    add,
    delete: deleteIdentity,
    has,
    getStorageStats: () => ({
      identityCount: numericIdentityCount + fallbackIdentities.size,
      numericBlockCount: numericBlocks.size,
      numericBlockBytes: numericBlocks.size * BYTES_PER_BLOCK,
      fallbackIdentityCount: fallbackIdentities.size,
    }),
  }
}

type NumericIdentityLocation = {
  readonly blockIndex: number
  readonly wordIndex: number
  readonly bitMask: number
}

function parseNumericSourceIdentity(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function getNumericIdentityLocation(identity: number): NumericIdentityLocation {
  const blockIndex = Math.floor(identity / IDENTITIES_PER_BLOCK)
  const offset = identity - blockIndex * IDENTITIES_PER_BLOCK
  const wordIndex = Math.floor(offset / BITS_PER_WORD)
  const bitIndex = offset % BITS_PER_WORD
  return {
    blockIndex,
    wordIndex,
    bitMask: 1 << bitIndex,
  }
}
