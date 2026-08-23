import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startTrackingSoakMockServer } from '../../build/electron-tracking-soak-mock-server.js'
import { createTraccarClient } from '../../src/features/tracking/traccar-client'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('deterministic tracking soak mock server [DON-246]', () => {
  it('serves authenticated groups, grouped devices, stable current fixes, and compressed breadcrumbs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-server-'))
    temporaryDirectories.push(directory)
    const server = await startTrackingSoakMockServer({
      statePath: path.join(directory, 'state.json'),
      baseTimeMs: Date.parse('2026-02-01T00:00:00.000Z'),
      intervalMs: 5_000,
      deviceCount: 32,
      movingDeviceCount: 8,
      productionPollsPerBatch: 180,
      maximumBatches: 2,
    })

    try {
      const session = await fetch(`${server.baseUrl}/api/session`, { method: 'POST' })
      expect(session.status).toBe(200)
      expect(session.headers.get('set-cookie')).toContain('JSESSIONID=tracking-soak')

      const unauthorized = await fetch(`${server.baseUrl}/api/devices`)
      expect(unauthorized.status).toBe(401)

      const headers = { Cookie: 'JSESSIONID=tracking-soak' }
      const groups = await fetch(`${server.baseUrl}/api/groups`, { headers }).then((response) => response.json())
      const devices = await fetch(`${server.baseUrl}/api/devices`, { headers }).then((response) => response.json())
      const current = await fetch(`${server.baseUrl}/api/positions`, { headers }).then((response) => response.json())
      const firstBatchWindow = new URLSearchParams({
        deviceId: '1',
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-02-01T00:14:55.000Z',
      })
      const stationaryWindow = new URLSearchParams({
        deviceId: '32',
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-02-01T00:14:55.000Z',
      })
      const moving = await fetch(
        `${server.baseUrl}/api/positions?${firstBatchWindow}`,
        { headers },
      ).then((response) => response.json())
      const stationary = await fetch(
        `${server.baseUrl}/api/positions?${stationaryWindow}`,
        { headers },
      ).then((response) => response.json())

      expect(groups).toEqual([{ id: 101, name: 'Synthetic Mission Team', groupId: 0 }])
      expect(devices).toHaveLength(32)
      expect(devices.every((device: { groupId: number }) => device.groupId === 101)).toBe(true)
      expect(current).toHaveLength(24)
      expect(moving).toHaveLength(180)
      expect(moving[0]?.fixTime).toBe('2026-02-01T00:00:00.000Z')
      expect(stationary).toEqual([])
      expect(new Set(moving.map((position: { id: number }) => position.id)).size).toBe(180)
      expect(server.snapshot()).toMatchObject({
        completedBatches: 1,
        deviceRequests: 1,
        baseTime: '2026-02-01T00:00:00.000Z',
        intervalMs: 5_000,
      })
      const durable = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
      expect(durable).toMatchObject({
        completedBatches: 1,
        deviceRequests: 1,
        baseTime: '2026-02-01T00:00:00.000Z',
        intervalMs: 5_000,
      })

      const client = createTraccarClient({
        baseUrl: server.baseUrl,
        email: 'synthetic',
        password: 'synthetic',
        maxRetries: 0,
      })
      await client.authenticate()
      await expect(client.getGroups()).resolves.toEqual([
        { group_id: '101', name: 'Synthetic Mission Team', parent_group_id: null },
      ])
      await expect(client.getDevices()).resolves.toHaveLength(32)
    } finally {
      await server.close()
    }
  })

  it('pauses deterministically at restart checkpoints and resumes without skipping a batch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-server-'))
    temporaryDirectories.push(directory)
    const server = await startTrackingSoakMockServer({
      statePath: path.join(directory, 'state.json'),
      baseTimeMs: Date.parse('2026-02-01T00:00:00.000Z'),
      intervalMs: 5_000,
      deviceCount: 32,
      movingDeviceCount: 8,
      productionPollsPerBatch: 180,
      maximumBatches: 3,
      pauseCheckpoints: [1],
    })
    const headers = { Authorization: 'Basic synthetic' }

    try {
      await fetch(`${server.baseUrl}/api/devices`, { headers })
      await fetch(`${server.baseUrl}/api/devices`, { headers })
      expect(server.snapshot()).toMatchObject({ completedBatches: 1, paused: true, deviceRequests: 2 })

      await server.resume()
      await fetch(`${server.baseUrl}/api/devices`, { headers })
      expect(server.snapshot()).toMatchObject({ completedBatches: 2, paused: false, deviceRequests: 3 })
    } finally {
      await server.close()
    }
  })
})
