// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPublicCiMetadata } from '../../scripts/qualification/public-ci-metadata.mjs'

const api = 'https://api.github.com/repos/donal0c/sartracker-web/actions'
const run = { id: 123, path: '.github/workflows/electron-release.yml', run_attempt: 1 }
const artifact = { id: 456 }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Supply transport responses only; provenance validation remains the caller's responsibility. */
function responses(...values: unknown[]) {
  const fetcher = vi.fn()
  for (const value of values) fetcher.mockResolvedValueOnce(Response.json(value))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

describe('fresh public CI metadata transport', () => {
  it('fetches fixed public endpoints without credentials or CLI and never reuses a response', async () => {
    const fetcher = responses(run, artifact, { ...run, run_attempt: 2 }, artifact)
    expect(await readPublicCiMetadata(123, 456)).toEqual({ run, artifact, jobs: [] })
    expect((await readPublicCiMetadata(123, 456)).run.run_attempt).toBe(2)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${api}/runs/123`, `${api}/artifacts/456`, `${api}/runs/123`, `${api}/artifacts/456`,
    ])
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', cache: 'no-store' })
      expect(options.headers).not.toHaveProperty('Authorization')
      expect(options.headers).not.toHaveProperty('authorization')
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it.each([0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, '123/../../releases'])('rejects invalid endpoint identity %s before networking', async (id) => {
    const fetcher = responses()
    await expect(readPublicCiMetadata(id, 456)).rejects.toThrow(/identit/i)
    await expect(readPublicCiMetadata(123, id)).rejects.toThrow(/identit/i)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([301, 302, 401, 403, 404, 429, 500])('fails closed on HTTP %s without retry or credential fallback', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('untrusted body', { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(readPublicCiMetadata(123, 456)).rejects.toThrow(`HTTP ${status}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects an unexpected final response URL', async () => {
    const response = Response.json(run)
    Object.defineProperty(response, 'url', { value: 'https://example.com/metadata' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    await expect(readPublicCiMetadata(123, 456)).rejects.toThrow(/origin|URL/)
  })

  it('rejects malformed JSON without exposing response content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE-RESPONSE')))
    await expect(readPublicCiMetadata(123, 456)).rejects.toThrow('Invalid public CI metadata JSON.')
  })

  it('bounds the streamed response even without Content-Length and cancels it', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(readPublicCiMetadata(123, 456)).rejects.toThrow(/size bound/)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('passes a bounded shared deadline to every request and propagates timeout failure', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const fetcher = responses(run, artifact)
    await readPublicCiMetadata(123, 456)
    expect(timeout).toHaveBeenCalledWith(120_000)
    expect(fetcher.mock.calls[0][1].signal).toBe(fetcher.mock.calls[1][1].signal)
    fetcher.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    await expect(readPublicCiMetadata(123, 456)).rejects.toThrow('timed out')
  })

  it('retrieves all job pages from fixed endpoints for validation-workflow reruns', async () => {
    const rerun = { ...run, path: '.github/workflows/electron-linux-validation.yml', run_attempt: 2 }
    const jobs = Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }))
    const fetcher = responses(rerun, artifact, { total_count: 101, jobs: jobs.slice(0, 100) }, { total_count: 101, jobs: jobs.slice(100) })
    expect((await readPublicCiMetadata(123, 456)).jobs).toEqual(jobs)
    expect(fetcher.mock.calls.slice(2).map(([url]) => url)).toEqual([
      `${api}/runs/123/jobs?filter=all&per_page=100&page=1`,
      `${api}/runs/123/jobs?filter=all&per_page=100&page=2`,
    ])
  })

  it.each([
    { total_count: 101, jobs: [{ id: 1 }] },
    { total_count: 1, jobs: [] },
    { total_count: 2, jobs: [{ id: 1 }, { id: 1 }] },
    { total_count: 10001, jobs: [] },
    { jobs: [] },
  ])('rejects incomplete, duplicated or unbounded job history %j', async (page) => {
    responses({ ...run, path: '.github/workflows/electron-linux-validation.yml', run_attempt: 2 }, artifact, page)
    await expect(readPublicCiMetadata(123, 456)).rejects.toThrow(/job/)
  })
})
