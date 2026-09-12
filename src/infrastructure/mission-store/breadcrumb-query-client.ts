import type { MissionStore } from './tauri-mission-store'

type QueryResult = Awaited<ReturnType<NonNullable<MissionStore['listBreadcrumbPositions']>>>
type ScalarRow = Record<string, string | number | boolean | null>
const MAX_BREADCRUMB_ROW_FIELDS = 4_096
const MAX_BREADCRUMB_STRING_FIELD_CODE_UNITS = 8 * 1_024 * 1_024
const MAX_BREADCRUMB_ROW_STRING_CODE_UNITS = 64 * 1_024 * 1_024

export type BreadcrumbQueryTransport = {
  readonly startBreadcrumbQuery: (input: { missionId: string; perDeviceLimit: number; requestId: string }) => Promise<unknown>
  readonly readBreadcrumbQueryFrame: (input: { requestId: string; snapshotId: string; sequence: number }) => Promise<unknown>
  readonly finishBreadcrumbQuery: (input: { requestId: string; snapshotId: string }) => Promise<unknown>
  readonly cancelBreadcrumbQuery: (input: { requestId: string; snapshotId?: string }) => Promise<boolean>
}

/** Checks protocol envelopes without trusting values copied through the bridge. */
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid breadcrumb transport object.')
  return value as Record<string, unknown>
}

/** Reconstructs explicit exceptional-number tags without coercing stored values. */
function decodeRecord(record: Record<string, unknown>): { kind: unknown; value: ScalarRow } {
  const value = object(record.value)
  if (Object.values(value).some((entry) => entry !== null && !['string', 'number', 'boolean'].includes(typeof entry))) {
    throw new Error('Invalid breadcrumb scalar record.')
  }
  if (record.exceptionalNumbers !== undefined) {
    if (!Array.isArray(record.exceptionalNumbers)) throw new Error('Invalid breadcrumb number tags.')
    const seen = new Set<string>()
    for (const entry of record.exceptionalNumbers) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !Object.hasOwn(value, entry[0]) || value[entry[0]] !== null || seen.has(entry[0])) {
        throw new Error('Invalid breadcrumb number tag.')
      }
      const numbers: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity, '-0': -0 }
      if (typeof entry[1] !== 'string' || !Object.hasOwn(numbers, entry[1])) throw new Error('Unknown breadcrumb number tag.')
      seen.add(entry[0])
      Object.defineProperty(value, entry[0], { value: numbers[entry[1]], enumerable: true, writable: true, configurable: true })
    }
  }
  return { kind: record.kind, value: value as ScalarRow }
}

/** Decodes bounded JSON tokens directly into one final row, never a whole-row string. */
export function createBreadcrumbRecordDecoder(
  accept: (record: { kind: unknown; value: ScalarRow }) => void,
  options: { readonly maxRowStringCodeUnits?: number } = {},
) {
  const maxRowStringCodeUnits = options.maxRowStringCodeUnits ?? MAX_BREADCRUMB_ROW_STRING_CODE_UNITS
  if (!Number.isSafeInteger(maxRowStringCodeUnits) || maxRowStringCodeUnits < 0
    || maxRowStringCodeUnits > MAX_BREADCRUMB_ROW_STRING_CODE_UNITS) {
    throw new Error('Invalid breadcrumb row string budget.')
  }
  let row: ScalarRow | null = null
  let rowKind: unknown
  let stringKey: string | null = null
  let stringLength = 0
  let stringReceivedLength = 0
  let declaredRowCodeUnits = 0
  let fieldCount = 0
  let assignedFieldCount = 0
  /** Refuses missing string fragments before advancing to another storage field. */
  function finishString() {
    if (row !== null && stringKey !== null && stringReceivedLength !== stringLength) {
      throw new Error('Breadcrumb string field is incomplete.')
    }
    stringKey = null
    stringLength = 0
    stringReceivedLength = 0
  }
  /** Assigns a unique storage column, including names such as __proto__. */
  function assign(key: string, value: ScalarRow[string], reservedStringCodeUnits = typeof value === 'string' ? value.length : 0) {
    if (row === null || Object.hasOwn(row, key)) throw new Error('Duplicate or misplaced breadcrumb field.')
    if (assignedFieldCount >= fieldCount) throw new Error('Breadcrumb row field count exceeds its declared field count.')
    const codeUnits = key.length + reservedStringCodeUnits
    if (declaredRowCodeUnits > maxRowStringCodeUnits - codeUnits) {
      throw new Error(`Breadcrumb row aggregate string data exceeds the ${maxRowStringCodeUnits}-code-unit limit.`)
    }
    Object.defineProperty(row, key, { value, enumerable: true, configurable: true, writable: true })
    assignedFieldCount += 1
    declaredRowCodeUnits += codeUnits
  }
  return {
    /** Consumes one bounded token and publishes only complete reconstructed rows. */
    acceptLine(line: string) {
      if (line.length > 16_384) throw new Error('Breadcrumb parse record exceeds its bound.')
      const record = object(JSON.parse(line))
      if (record.kind === 'rowStart') {
        if (row !== null || !['position', 'deviceTotal', 'deviceSelection'].includes(String(record.rowKind))
          || !Number.isSafeInteger(record.fieldCount) || (record.fieldCount as number) < 1
        ) {
          throw new Error('Invalid breadcrumb row start.')
        }
        if ((record.fieldCount as number) > MAX_BREADCRUMB_ROW_FIELDS) {
          throw new Error(`Breadcrumb row field count exceeds the ${MAX_BREADCRUMB_ROW_FIELDS}-field limit.`)
        }
        row = {}
        rowKind = record.rowKind
        fieldCount = record.fieldCount as number
        stringKey = null
        stringLength = 0
        stringReceivedLength = 0
        declaredRowCodeUnits = 0
        assignedFieldCount = 0
      } else if (record.kind === 'stringStart') {
        finishString()
        if (typeof record.key !== 'string' || record.key.length > 1_024 || !Number.isSafeInteger(record.length)
          || (record.length as number) < 0) {
          throw new Error('Invalid breadcrumb string field.')
        }
        if ((record.length as number) > MAX_BREADCRUMB_STRING_FIELD_CODE_UNITS) {
          throw new Error(`Breadcrumb string field exceeds the ${MAX_BREADCRUMB_STRING_FIELD_CODE_UNITS}-code-unit limit.`)
        }
        assign(record.key, '', record.length as number)
        stringKey = record.key
        stringLength = record.length as number
        stringReceivedLength = 0
      } else if (record.kind === 'stringChunk') {
        if (row === null || stringKey === null || typeof record.value !== 'string' || record.value.length > 1_024
          || record.value.length === 0 || record.offset !== stringReceivedLength
          || stringReceivedLength + record.value.length > stringLength) {
          throw new Error('Invalid breadcrumb string fragment.')
        }
        row[stringKey] = `${row[stringKey]}${record.value}`
        stringReceivedLength += record.value.length
      } else if (record.kind === 'field') {
        finishString()
        const field = decodeRecord(record).value
        const keys = Object.keys(field)
        if (keys.length !== 1) throw new Error('Invalid breadcrumb field record.')
        assign(keys[0]!, field[keys[0]!]!)
        stringKey = null
      } else if (record.kind === 'rowEnd') {
        finishString()
        if (row === null || Object.keys(row).length !== fieldCount) throw new Error('Invalid breadcrumb row end or field count.')
        accept({ kind: rowKind, value: row })
        row = null
        stringKey = null
      } else {
        if (row !== null) throw new Error('Incomplete breadcrumb fragmented row.')
        accept(decodeRecord(record))
      }
    },
    /** Refuses a terminal frame ending inside a fragmented row. */
    finish() {
      if (row !== null) throw new Error('Breadcrumb fragmented row is incomplete.')
    },
  }
}

/** Builds canonical results in mainworld; partial rows never cross contextBridge again. */
export function createBreadcrumbQueryClient(raw: BreadcrumbQueryTransport): Required<Pick<MissionStore, 'listBreadcrumbPositions' | 'cancelBreadcrumbQuery' | 'subscribeBreadcrumbQueryProgress'>> {
  const active = new Map<string, { cancelled: boolean; snapshotId?: string }>()
  const listeners = new Map<string, (progress: { receivedPositions: number; totalPositions: number }) => void>()
  /** Reports listener failures without exposing listener-owned error content. */
  const publishProgress = (requestId: string, progress: { receivedPositions: number; totalPositions: number }) => {
    const listener = listeners.get(requestId)
    if (listener === undefined) return
    try {
      listener(progress)
    } catch {
      console.warn('Breadcrumb query progress listener failed; transfer continues.')
    }
  }
  return {
    subscribeBreadcrumbQueryProgress(requestId, listener) {
      listeners.set(requestId, listener)
      return () => { if (listeners.get(requestId) === listener) listeners.delete(requestId) }
    },
    async listBreadcrumbPositions(missionId, perDeviceLimit, suppliedId) {
      const requestId = suppliedId ?? `breadcrumb-${crypto.randomUUID()}`
      if (active.has(requestId)) throw new Error('Breadcrumb query request ID is already active.')
      const state: { cancelled: boolean; snapshotId?: string } = { cancelled: false }
      active.set(requestId, state)
      /** Prevents a late frame or finish from publishing after cancellation. */
      const checkCancelled = () => {
        if (state.cancelled) throw new DOMException('Breadcrumb query was cancelled.', 'AbortError')
      }
      let snapshotId: string | undefined
      try {
        const manifest = object(await raw.startBreadcrumbQuery({ missionId, perDeviceLimit, requestId }))
        checkCancelled()
        if (typeof manifest.snapshotId !== 'string' || manifest.snapshotId.length < 1 || manifest.snapshotId.length > 100
          || manifest.missionId !== missionId) throw new Error('Breadcrumb query snapshot identity is invalid.')
        snapshotId = manifest.snapshotId
        state.snapshotId = snapshotId
        const keys = ['positionCount', 'deviceTotalCount', 'deviceSelectionCount', 'droppedPositionCount'] as const
        if (manifest.version !== 1 || keys.some((key) => !Number.isSafeInteger(manifest[key]) || (manifest[key] as number) < 0)) {
          throw new Error('Invalid breadcrumb query manifest.')
        }
        const counts = keys.slice(0, 3).map((key) => manifest[key] as number)
        const kinds = ['position', 'deviceTotal', 'deviceSelection']
        const rows: ScalarRow[][] = [[], [], []]
        let reportedPositions = 0
        publishProgress(requestId, { receivedPositions: 0, totalPositions: counts[0]! })
        let kindIndex = 0
        let pending = ''
        const decoder = createBreadcrumbRecordDecoder((record) => {
          while (kindIndex < 3 && rows[kindIndex]!.length === counts[kindIndex]) kindIndex += 1
          if (kindIndex === 3 || record.kind !== kinds[kindIndex]) throw new Error('Breadcrumb query record count or order is invalid.')
          if (kindIndex === 0) {
            if (!Object.hasOwn(record.value, 'mission_id') || typeof record.value.mission_id !== 'string') {
              throw new Error('Malformed breadcrumb position row: missing or invalid mission_id.')
            }
            if (record.value.mission_id !== missionId) throw new Error('Breadcrumb query snapshot belongs to another mission.')
          }
          rows[kindIndex]!.push(record.value)
        })
        for (let sequence = 0; ; sequence += 1) {
          checkCancelled()
          const frame = object(await raw.readBreadcrumbQueryFrame({ requestId, snapshotId, sequence }))
          checkCancelled()
          if (frame.snapshotId !== snapshotId || frame.sequence !== sequence || typeof frame.payload !== 'string' || frame.payload.length > 32_768
            || typeof frame.done !== 'boolean' || (frame.payload.length === 0 && !frame.done)) {
            throw new Error('Invalid breadcrumb query frame.')
          }
          pending += frame.payload
          let end: number
          while ((end = pending.indexOf('\n')) >= 0) {
            decoder.acceptLine(pending.slice(0, end))
            pending = pending.slice(end + 1)
          }
          if (pending.length > 16_384) throw new Error('Breadcrumb parse record exceeds its bound.')
          if (rows[0]!.length !== reportedPositions) {
            reportedPositions = rows[0]!.length
            publishProgress(requestId, { receivedPositions: reportedPositions, totalPositions: counts[0]! })
          }
          if (frame.done) break
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        decoder.finish()
        if (pending.length !== 0 || rows.some((list, index) => list.length !== counts[index])) throw new Error('Breadcrumb query transfer is incomplete.')
        await raw.finishBreadcrumbQuery({ requestId, snapshotId })
        checkCancelled()
        return { positions: rows[0], deviceTotals: rows[1], deviceSelections: rows[2],
          droppedPositionCount: manifest.droppedPositionCount } as unknown as QueryResult
      } catch (error) {
        try {
          await raw.cancelBreadcrumbQuery({ requestId, ...(snapshotId === undefined ? {} : { snapshotId }) })
        } catch {
          // Teardown can invalidate the sender; preserve the original query failure.
        }
        throw error
      } finally {
        if (active.get(requestId) === state) active.delete(requestId)
        listeners.delete(requestId)
      }
    },
    async cancelBreadcrumbQuery(requestId) {
      const state = active.get(requestId)
      if (state !== undefined) state.cancelled = true
      return raw.cancelBreadcrumbQuery({ requestId, ...(state?.snapshotId === undefined ? {} : { snapshotId: state.snapshotId }) })
    },
  }
}
