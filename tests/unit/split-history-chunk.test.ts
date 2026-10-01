import { describe, expect, it, vi } from 'vitest'

import {
  HISTORY_PIECE_ROW_BUDGET,
  historyFailureChangedStore,
  persistHistoryChunkInPieces,
  splitHistoryChunk,
} from '../../src/features/tracking/split-history-chunk'
import type { TrackingHistoryChunkPersistenceInput } from '../../src/features/tracking/polling-manager'

const START = Date.parse('2026-10-01T00:00:00.000Z')

/** A 2 h initial-history chunk from a 1 Hz device, as the soak's walker produces. */
function oneHertzChunk(rows: number, overrides: Partial<TrackingHistoryChunkPersistenceInput> = {}): TrackingHistoryChunkPersistenceInput {
  return {
    phase: 'initial', expectedMissionId: 'mission-1', deviceId: 'walker-1',
    historyFrom: '2026-10-01T00:00:00.000Z',
    reconciledUntil: '2026-10-01T02:00:00.000Z',
    positions: Array.from({ length: rows }, (_, index) => position(`p-${index}`, START + index * 1000)),
    ...overrides,
  }
}

function position(id: string, at: number) {
  return {
    id, device_id: 'walker-1', lat: 52, lon: -9, altitude: null, speed: null, battery: null, accuracy: null,
    timestamp: new Date(at).toISOString(), source: null, data_origin: 'live' as const,
    cache_age_seconds: null, device_cache_stale: false,
  }
}

describe('history chunks split into bounded pieces [DON-313]', () => {
  it('cuts a 7,200-row chunk into ordered pieces whose checkpoints chain exactly', () => {
    const chunk = oneHertzChunk(7_200)
    const pieces = splitHistoryChunk(chunk)

    expect(pieces.length).toBe(Math.ceil(7_200 / HISTORY_PIECE_ROW_BUDGET))
    expect(pieces.every((piece) => piece.positions.length <= HISTORY_PIECE_ROW_BUDGET)).toBe(true)
    expect(pieces.flatMap((piece) => piece.positions.map((p) => p.id))).toEqual(chunk.positions.map((p) => p.id))
    // The first piece makes the same claim as the chunk, only ending earlier.
    expect(pieces[0]!.reconciledFrom).toBe(chunk.reconciledFrom)
    for (const [index, piece] of pieces.entries()) {
      expect(piece.historyFrom).toBe(chunk.historyFrom)
      const last = piece.positions.at(-1)!.timestamp
      // Each piece claims only up to its own last fix (chunks are inclusive).
      expect(piece.reconciledUntil).toBe(index === pieces.length - 1 ? chunk.reconciledUntil : last)
      if (index > 0) expect(piece.reconciledFrom).toBe(pieces[index - 1]!.reconciledUntil)
    }
  })

  it('never separates fixes that share a timestamp', () => {
    const chunk = oneHertzChunk(0)
    const positions = Array.from({ length: 300 }, (_, index) => position(`p-${index}`, START + Math.floor(index / 3) * 1000))
    const pieces = splitHistoryChunk({ ...chunk, positions })

    for (let index = 1; index < pieces.length; index += 1) {
      expect(pieces[index]!.positions[0]!.timestamp > pieces[index - 1]!.positions.at(-1)!.timestamp).toBe(true)
    }
    expect(pieces.flatMap((piece) => piece.positions)).toHaveLength(300)
  })

  it('orders fixes by time before cutting, keeping the chunk whole when it fits', () => {
    const chunk = oneHertzChunk(10)
    const reversed = { ...chunk, positions: [...chunk.positions].reverse() }
    expect(splitHistoryChunk(reversed)).toEqual([reversed])
  })

  it('stops at a failed piece, reports the chunk failed, and leaves earlier pieces truthfully stored', async () => {
    const chunk = oneHertzChunk(1_000)
    const pieces = splitHistoryChunk(chunk)
    const failure = new Error('disk unavailable')
    const persistPiece = vi.fn()
      .mockResolvedValueOnce({ changed: true })
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ changed: true })
    const yieldBetweenPieces = vi.fn().mockResolvedValue(undefined)

    await expect(persistHistoryChunkInPieces(chunk, persistPiece, yieldBetweenPieces)).rejects.toBe(failure)

    expect(persistPiece.mock.calls.map(([piece]) => piece)).toEqual(pieces.slice(0, 2))
    expect(pieces[0]!.reconciledUntil).toBe(pieces[0]!.positions.at(-1)!.timestamp)
  })

  it('yields between pieces and reports a change if any piece changed', async () => {
    const chunk = oneHertzChunk(600)
    const persistPiece = vi.fn()
      .mockResolvedValueOnce({ changed: false })
      .mockResolvedValue({ changed: true })
    const yieldBetweenPieces = vi.fn().mockResolvedValue(undefined)

    await expect(persistHistoryChunkInPieces(chunk, persistPiece, yieldBetweenPieces)).resolves.toEqual({ changed: true })
    expect(persistPiece).toHaveBeenCalledTimes(3)
    expect(yieldBetweenPieces).toHaveBeenCalledTimes(2)
  })

  it('marks a failure that follows a stored change, so the trail is still refreshed', async () => {
    const chunk = oneHertzChunk(600)
    const failure = new Error('disk unavailable')
    const persistPiece = vi.fn().mockResolvedValueOnce({ changed: true }).mockRejectedValueOnce(failure)

    const outcome = persistHistoryChunkInPieces(chunk, persistPiece, async () => undefined)

    await expect(outcome).rejects.toBe(failure)
    expect(historyFailureChangedStore(failure)).toBe(true)
    expect(historyFailureChangedStore(new Error('unrelated'))).toBe(false)
  })

  it('keeps an oversized group of fixes sharing one instant together, so no cursor overclaims', () => {
    const chunk = oneHertzChunk(0)
    const positions = [
      ...Array.from({ length: 10 }, (_, index) => position(`early-${index}`, START + index * 1000)),
      ...Array.from({ length: 300 }, (_, index) => position(`same-${index}`, START + 60_000)),
      ...Array.from({ length: 10 }, (_, index) => position(`late-${index}`, START + 120_000 + index * 1000)),
    ]
    const pieces = splitHistoryChunk({ ...chunk, positions })

    const sameInstant = pieces.filter((piece) => piece.positions.some((p) => p.id.startsWith('same-')))
    expect(sameInstant).toHaveLength(1)
    expect(sameInstant[0]!.positions.filter((p) => p.id.startsWith('same-'))).toHaveLength(300)
  })

  it('splits unsorted input in time order', () => {
    const chunk = oneHertzChunk(600)
    const shuffled = { ...chunk, positions: [...chunk.positions].reverse() }
    const pieces = splitHistoryChunk(shuffled)
    expect(pieces.flatMap((piece) => piece.positions.map((p) => p.id))).toEqual(chunk.positions.map((p) => p.id))
    expect(pieces[0]!.reconciledUntil).toBe(chunk.positions[HISTORY_PIECE_ROW_BUDGET - 1]!.timestamp)
  })

  it('keeps a malformed chunk whole so the store rejects it atomically (DON-254)', () => {
    const inverted = oneHertzChunk(600, { reconciledUntil: '2026-09-30T23:00:00.000Z' })
    expect(splitHistoryChunk(inverted)).toEqual([inverted])
    const beyondCursor = oneHertzChunk(600, { reconciledUntil: '2026-10-01T00:05:00.000Z' })
    expect(splitHistoryChunk(beyondCursor)).toEqual([beyondCursor])
    const beforeStart = oneHertzChunk(600, { reconciledFrom: '2026-10-01T00:01:00.000Z' })
    expect(splitHistoryChunk(beforeStart)).toEqual([beforeStart])
  })
})
