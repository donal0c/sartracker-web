import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const workerPath = require.resolve('../../electron/startup-evidence-worker.cjs')

type WorkerReply = {
  readonly id: number
  readonly type?: string
  readonly ok?: boolean
  readonly value?: unknown
  readonly error?: { readonly name: string; readonly message: string; readonly code?: string }
}

describe('Electron startup evidence worker', () => {
  let userDataPath: string
  let port: EventEmitter & { postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }
  let replies: WorkerReply[]

  beforeEach(() => {
    userDataPath = mkdtempSync(path.join(os.tmpdir(), 'sartracker-evidence-worker-'))
    replies = []
    port = Object.assign(new EventEmitter(), {
      postMessage: vi.fn((message: WorkerReply) => { replies.push(message) }),
      close: vi.fn(),
    })
    Object.defineProperty(process, 'parentPort', { configurable: true, value: port })
    delete require.cache[workerPath]
    require(workerPath)
  })

  afterEach(() => {
    Reflect.deleteProperty(process, 'parentPort')
    delete require.cache[workerPath]
    rmSync(userDataPath, { force: true, recursive: true })
  })

  /** Sends one request and resolves with the worker's reply for that id. */
  async function request(message: Record<string, unknown>): Promise<WorkerReply> {
    port.emit('message', { data: message })
    let reply: WorkerReply | undefined
    await vi.waitFor(() => {
      reply = replies.find((candidate) => candidate.id === message.id && candidate.type !== 'ready')
      expect(reply).toBeDefined()
    })
    return reply as WorkerReply
  }

  it('refuses operations before initialization and reports readiness after it', async () => {
    await expect(request({ id: 1, type: 'crash.readRecent' })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Startup evidence worker is not initialized.' },
    })

    port.emit('message', { data: { id: 0, type: 'initialize', userDataPath } })
    expect(replies).toContainEqual({ id: 0, type: 'ready' })

    port.emit('message', { data: { id: 0, type: 'initialize', userDataPath } })
    expect(replies).toContainEqual(expect.objectContaining({
      id: 0,
      ok: false,
      error: expect.objectContaining({ message: 'Startup evidence worker initialization is invalid.' }),
    }))
  })

  it('writes durable crash and runtime evidence to the profile', async () => {
    port.emit('message', { data: { id: 0, type: 'initialize', userDataPath } })

    await expect(request({
      id: 1,
      type: 'crash.recordDurable',
      input: { kind: 'uncaughtException', summary: 'fatal fault' },
    })).resolves.toMatchObject({ ok: true })
    await expect(request({
      id: 2,
      type: 'runtime.appendDurable',
      input: { level: 'error', event: 'startup_failure', fields: {} },
    })).resolves.toMatchObject({ ok: true })

    expect(readFileSync(path.join(userDataPath, 'crashes', 'crash-log.json'), 'utf8'))
      .toContain('fatal fault')
    expect(readFileSync(path.join(userDataPath, 'logs', 'runtime.log'), 'utf8'))
      .toContain('startup_failure')
  })

  it('propagates durable crash-write failures with their stable code', async () => {
    mkdirSync(path.join(userDataPath, 'crashes', 'crash-log.json'), { recursive: true })
    port.emit('message', { data: { id: 0, type: 'initialize', userDataPath } })

    await expect(request({
      id: 1,
      type: 'crash.recordDurable',
      input: { kind: 'uncaughtException', summary: 'fatal fault' },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'ERR_SARTRACKER_NON_REGULAR_FILE' },
    })
  })

  it('rejects unknown operations without closing the port', async () => {
    port.emit('message', { data: { id: 0, type: 'initialize', userDataPath } })

    await expect(request({ id: 1, type: 'fs.unlink', input: { path: '/' } })).resolves.toMatchObject({
      ok: false,
      error: { message: 'Startup evidence worker received an unknown operation.' },
    })
    expect(port.close).not.toHaveBeenCalled()
  })

  it('drains in-flight operations before acknowledging shutdown and closing', async () => {
    port.emit('message', { data: { id: 0, type: 'initialize', userDataPath } })
    port.emit('message', {
      data: { id: 1, type: 'crash.recordDurable', input: { kind: 'startupFailure', summary: 'drain me' } },
    })

    await expect(request({ id: 2, type: 'shutdown' })).resolves.toEqual({ id: 2, ok: true, value: true })

    const writeReply = replies.findIndex((reply) => reply.id === 1)
    const shutdownReply = replies.findIndex((reply) => reply.id === 2)
    expect(writeReply).toBeGreaterThanOrEqual(0)
    expect(writeReply).toBeLessThan(shutdownReply)
    expect(port.close).toHaveBeenCalledOnce()
    expect(readFileSync(path.join(userDataPath, 'crashes', 'crash-log.json'), 'utf8'))
      .toContain('drain me')
  })
})
