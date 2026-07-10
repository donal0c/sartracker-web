import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { startTrackingSoakMockServer } from '../../build/electron-tracking-soak-mock-server.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('deterministic tracking soak mock server [DON-246]', () => {
  it('serves authenticated devices, stable current fixes, and compressed breadcrumbs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-server-'))
    temporaryDirectories.push(directory)
    const server = await startTrackingSoakMockServer({
      statePath: path.join(directory, 'state.json'),
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
      const devices = await fetch(`${server.baseUrl}/api/devices`, { headers }).then((response) => response.json())
      const current = await fetch(`${server.baseUrl}/api/positions`, { headers }).then((response) => response.json())
      const moving = await fetch(`${server.baseUrl}/api/positions?deviceId=1`, { headers }).then((response) => response.json())
      const stationary = await fetch(`${server.baseUrl}/api/positions?deviceId=32`, { headers }).then((response) => response.json())

      expect(devices).toHaveLength(32)
      expect(current).toHaveLength(24)
      expect(moving).toHaveLength(180)
      expect(stationary).toEqual([])
      expect(new Set(moving.map((position: { id: number }) => position.id)).size).toBe(180)
      expect(server.snapshot()).toMatchObject({ completedBatches: 1, deviceRequests: 1 })

      const durable = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
      expect(durable).toMatchObject({ completedBatches: 1, deviceRequests: 1 })
    } finally {
      await server.close()
    }
  })

  it('pauses deterministically at restart checkpoints and resumes without skipping a batch', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-soak-server-'))
    temporaryDirectories.push(directory)
    const server = await startTrackingSoakMockServer({
      statePath: path.join(directory, 'state.json'),
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
