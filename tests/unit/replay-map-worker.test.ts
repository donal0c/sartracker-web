import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

/** Loads the real worker entrypoint with its browser message boundary under test control. */
async function worker() {
  const scope = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage: vi.fn() }
  vi.stubGlobal('self', scope)
  await import('../../src/features/mission-review/replay-map-worker')
  return { send: (data: unknown) => scope.onmessage!(new MessageEvent('message', { data })), replies: scope.postMessage }
}

it('returns the true bounds and per-object limitations without losing valid track data', async () => {
  const subject = await worker()
  subject.send({ tracks: [{ evidence_id: 'a', source_type: 'traccar_fix', track_id: 'x', lat: 52, lon: -9, effective_at: '2026-09-09T10:00:00Z' }] })
  subject.send({ objects: [{ object_type: 'drawing', object_id: 'bad', operation: 'created', state: { type: 'alien', geometry_json: '{' } }] })
  expect(subject.replies).toHaveBeenLastCalledWith({ ready: true })
  subject.send({ finish: true })
  expect(subject.replies).toHaveBeenLastCalledWith({ blob: expect.any(Blob), bounds: [-9, 52, -9, 52],
    limitations: [expect.objectContaining({ evidenceId: 'bad' })] })
})

it('returns null bounds for a valid empty replay', async () => {
  const subject = await worker()
  subject.send({ finish: true })
  expect(subject.replies).toHaveBeenLastCalledWith({ blob: expect.any(Blob), bounds: null, limitations: [] })
})

it('reports a malformed transport message as a worker error', async () => {
  const subject = await worker()
  subject.send(null)
  expect(subject.replies).toHaveBeenLastCalledWith({ error: expect.any(String) })
})
