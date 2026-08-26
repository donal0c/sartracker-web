import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createCoverageTileUrl,
  registerCoverageTileProtocol,
} from '../../src/features/tracking/coverage-tile-protocol'

describe('Candidate B MapLibre protocol [DON-276]', () => {
  afterEach(() => Reflect.deleteProperty(window, 'sartrackerElectron'))

  it('parses a revision-bound period URL and returns worker PBF bytes', async () => {
    const addProtocol = vi.fn()
    const readCoverageTile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { missionStore: { readCoverageTile } },
    })
    const unregister = registerCoverageTileProtocol({
      addProtocol,
      removeProtocol: vi.fn(),
    })
    const [, loader] = addProtocol.mock.calls[0]!
    const url = createCoverageTileUrl('mission-1', 'outing\u0000outing/1', 'revision-7')

    await expect(loader({ url: url.replace('{z}', '8').replace('{x}', '121').replace('{y}', '83') }))
      .resolves.toEqual({ data: Uint8Array.from([1, 2, 3]).buffer })
    expect(readCoverageTile).toHaveBeenCalledWith({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing/1',
      revisionDigest: 'revision-7',
      z: 8,
      x: 121,
      y: 83,
    }, expect.any(String))

    unregister()
  })

  it('binds every renderer tile request to its mission identity', async () => {
    const addProtocol = vi.fn()
    const readCoverageTile = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]))
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { missionStore: { readCoverageTile } },
    })
    registerCoverageTileProtocol({ addProtocol, removeProtocol: vi.fn() })
    const [, loader] = addProtocol.mock.calls[0]!
    const createMissionTileUrl = createCoverageTileUrl as unknown as (
      missionId: string,
      periodKey: string,
      revisionDigest: string,
    ) => string
    const url = createMissionTileUrl(
      'mission/2',
      'outing\u0000outing/1',
      'revision-7',
    )

    await loader({ url: url.replace('{z}', '8').replace('{x}', '121').replace('{y}', '83') })

    expect(readCoverageTile).toHaveBeenCalledWith({
      missionId: 'mission/2',
      periodKey: 'outing\u0000outing/1',
      revisionDigest: 'revision-7',
      z: 8,
      x: 121,
      y: 83,
    }, expect.any(String))
  })

  it('reports an active revision failure so Complete can be revoked', async () => {
    const addProtocol = vi.fn()
    const onFailure = vi.fn()
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        missionStore: {
          readCoverageTile: vi.fn().mockRejectedValue(new Error('worker unavailable')),
        },
      },
    })
    registerCoverageTileProtocol({ addProtocol, removeProtocol: vi.fn() }, onFailure)
    const [, loader] = addProtocol.mock.calls[0]!
    const url = createCoverageTileUrl(
      'mission-1',
      'outing\u0000outing-1',
      'revision-8',
      'activation-stage-8',
    )

    await expect(loader({
      url: url.replace('{z}', '8').replace('{x}', '121').replace('{y}', '83'),
    })).rejects.toThrow(/worker unavailable/)
    expect(onFailure).toHaveBeenCalledWith({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-8',
      activationId: 'activation-stage-8',
      message: 'Coverage tile delivery failed.',
    })
    expect(window.sartrackerElectron?.missionStore.readCoverageTile).toHaveBeenCalledWith({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-8',
      z: 8,
      x: 121,
      y: 83,
    }, expect.any(String))
  })

  it('accepts a current empty PBF without reporting renderer failure', async () => {
    const addProtocol = vi.fn()
    const onFailure = vi.fn()
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { missionStore: { readCoverageTile: vi.fn().mockResolvedValue(new Uint8Array()) } },
    })
    registerCoverageTileProtocol({ addProtocol, removeProtocol: vi.fn() }, onFailure)
    const [, loader] = addProtocol.mock.calls[0]!
    const url = createCoverageTileUrl('mission-1', 'outing\u0000empty', 'revision-empty')

    await expect(loader({
      url: url.replace('{z}', '8').replace('{x}', '0').replace('{y}', '0'),
    })).resolves.toEqual({ data: new ArrayBuffer(0) })
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('cancels an obsolete MapLibre tile read without reporting renderer failure', async () => {
    const addProtocol = vi.fn()
    const onFailure = vi.fn()
    let resolveRead: ((value: Uint8Array) => void) | undefined
    const readCoverageTile = vi.fn(() => new Promise<Uint8Array>((resolve) => {
      resolveRead = resolve
    }))
    const cancelCoverageTileRead = vi.fn().mockResolvedValue(true)
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { missionStore: { readCoverageTile, cancelCoverageTileRead } },
    })
    registerCoverageTileProtocol({ addProtocol, removeProtocol: vi.fn() }, onFailure)
    const [, loader] = addProtocol.mock.calls[0]!
    const abortController = new AbortController()
    const url = createCoverageTileUrl('mission-1', 'outing\u0000outing-1', 'revision-8')

    const loading = loader({
      url: url.replace('{z}', '8').replace('{x}', '121').replace('{y}', '83'),
    }, abortController)
    abortController.abort()

    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    const requestId = readCoverageTile.mock.calls[0]?.[1]
    expect(requestId).toEqual(expect.any(String))
    expect(cancelCoverageTileRead).toHaveBeenCalledWith(requestId)
    expect(onFailure).not.toHaveBeenCalled()
    resolveRead?.(new Uint8Array([1]))
  })

  it('does not start a tile read that MapLibre already cancelled', async () => {
    const addProtocol = vi.fn()
    const readCoverageTile = vi.fn().mockResolvedValue(new Uint8Array([1]))
    const cancelCoverageTileRead = vi.fn().mockResolvedValue(false)
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { missionStore: { readCoverageTile, cancelCoverageTileRead } },
    })
    registerCoverageTileProtocol({ addProtocol, removeProtocol: vi.fn() })
    const [, loader] = addProtocol.mock.calls[0]!
    const abortController = new AbortController()
    abortController.abort()
    const url = createCoverageTileUrl('mission-1', 'outing\u0000outing-1', 'revision-8')

    await expect(loader({
      url: url.replace('{z}', '8').replace('{x}', '121').replace('{y}', '83'),
    }, abortController)).rejects.toMatchObject({ name: 'AbortError' })
    expect(readCoverageTile).not.toHaveBeenCalled()
    expect(cancelCoverageTileRead).not.toHaveBeenCalled()
  })
})
