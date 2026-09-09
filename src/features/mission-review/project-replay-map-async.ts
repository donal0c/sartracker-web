import type { MissionReplayReadResult, MissionReplayTrackRecord } from '../../infrastructure/mission-store/tauri-mission-store'

export type ReplayMapProjection = { readonly blob: Blob; readonly bounds: readonly [number, number, number, number] | null }

/** Feeds bounded batches to a disposable worker without blocking current-position rendering. */
export async function projectReplayMapAsync(tracks: readonly MissionReplayTrackRecord[], objects: MissionReplayReadResult['objects'], isCurrent: () => boolean): Promise<ReplayMapProjection> {
  const worker = new Worker(new URL('./replay-map-worker.ts', import.meta.url), { type: 'module' })
  /** Waits for each worker acknowledgement before admitting another batch. */
  const send = (message: unknown, finish = false): Promise<ReplayMapProjection | null> => new Promise((resolve, reject) => {
    const cancellation = setInterval(() => {
      if (!isCurrent()) { cleanup(); reject(new Error('Replay map request was superseded.')) }
    }, 50)
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Replay map worker timed out. Re-seek the selected time.')) }, 30_000)
    /** Releases every wait handle on acknowledgement, cancellation, or failure. */
    function cleanup(): void { clearInterval(cancellation); clearTimeout(timeout); worker.onmessage = null; worker.onerror = null }
    worker.onmessage = (event: MessageEvent<ReplayMapProjection & { ready?: boolean; error?: string }>) => {
      cleanup()
      if (event.data.error) reject(new Error(event.data.error))
      else if (!finish && event.data.ready === true) resolve(null)
      else if (finish && event.data.blob instanceof Blob && (event.data.bounds === null ||
        (Array.isArray(event.data.bounds) && event.data.bounds.length === 4 && event.data.bounds.every(Number.isFinite)))) resolve(event.data)
      else reject(new Error('Replay map worker returned invalid evidence.'))
    }
    worker.onerror = () => { cleanup(); reject(new Error('Replay map worker failed. Re-seek the selected time.')) }
    try { worker.postMessage(message) } catch (error) { cleanup(); reject(error) }
  })
  try {
    for (let offset = 0; offset < tracks.length; offset += 500) {
      if (!isCurrent()) throw new Error('Replay map request was superseded.')
      await send({ tracks: tracks.slice(offset, offset + 500) })
    }
    for (const object of objects) {
      if (!isCurrent()) throw new Error('Replay map request was superseded.')
      await send({ objects: [object] })
    }
    const result = await send({ finish: true }, true)
    if (result === null) throw new Error('Replay map worker did not return evidence.')
    return result
  } finally { worker.terminate() }
}
