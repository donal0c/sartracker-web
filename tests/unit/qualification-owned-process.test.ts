import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { listOwnedProcessPids, runOwnedProcess } from '../../scripts/qualification/owned-process.mjs'

const node = process.execPath

async function waitForFile(file, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { return await readFile(file, 'utf8') } catch { await new Promise((resolve) => setTimeout(resolve, 25)) }
  }
  throw new Error(`Timed out waiting for ${file}.`)
}

async function waitForProcessGone(pid, { allowZombie = false, timeoutMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
      const closing = stat.lastIndexOf(')')
      if (allowZombie && closing >= 0 && stat[closing + 2] === 'Z') return
      process.kill(pid, 0)
    } catch { return }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Process ${pid} remained alive after bounded cleanup.`)
}

async function waitForClose(child, timeoutMs = 5_000) {
  return Promise.race([
    once(child, 'close'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Controller did not close within its bounded test timeout.')), timeoutMs)),
  ])
}

describe('qualification owned process runner', () => {
  it('rejects oversized bounded producer input before launch', async () => {
    await expect(runOwnedProcess({
      file: node,
      args: [],
      cwd: process.cwd(),
      env: process.env,
      stdinBytes: Buffer.alloc(16 * 1024 * 1024 + 1),
    })).rejects.toThrow(/stdinBytes|limit/iu)
  })

  it.skipIf(process.platform !== 'linux')('runs the direct Python PID-ownership regression', async () => {
    const regression = spawn('python3', ['-B', path.resolve('tests/unit/qualification-owned-process-supervisor-regression.py')], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    regression.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    const [exitCode] = await once(regression, 'close')
    expect(exitCode).toBe(0)
    expect(stderr).toMatch(/Ran 1 test/iu)
    expect(stderr).toMatch(/OK/iu)
  })

  it.skipIf(process.platform !== 'linux').each([31, 32])('accepts output at or exactly at the byte cap (%i bytes)', async (size) => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', `process.stdout.write('x'.repeat(${size}))`],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      maxOutputBytes: 32,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.outputOverflowed).toBe(false)
    expect(Buffer.byteLength(result.stdout)).toBe(size)
    expect(result.processError).toBe(null)
  })

  it.skipIf(process.platform !== 'linux')('passes bounded stdin bytes to the fixed producer', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', "let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk }); process.stdin.on('end', () => process.stdout.write(value))"],
      cwd: process.cwd(),
      env: process.env,
      stdinBytes: 'bounded-input',
      timeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.stdout).toBe('bounded-input')
    expect(result.processError).toBe(null)
    expect(result.cleanupVerified).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('reports the producer PID to observers rather than the supervisor PID', async () => {
    const observed: number[] = []
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', 'setTimeout(() => {}, 150)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
      observeIntervalMs: 10,
      observe: ({ pid }: { pid: number }) => { observed.push(pid); return pid },
    })

    expect(result.processError).toBe(null)
    expect(result.producerPid).toBeGreaterThan(0)
    expect(result.supervisorPid).toBeGreaterThan(0)
    expect(result.producerPid).not.toBe(result.supervisorPid)
    expect(observed.length).toBeGreaterThan(0)
    expect(observed.every((pid) => pid === result.producerPid)).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('caps retained output bytes and fails closed on overflow', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', "process.stdout.write('x'.repeat(200))"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      maxOutputBytes: 32,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.outputOverflowed).toBe(true)
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32)
    expect(result.processError).toMatch(/output|capture|limit/iu)
    expect(result.zeroDescendantsAfterRun).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('retains observation failures and terminates the owned producer', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
      observe: async () => {
        throw new Error('synthetic observation failure')
      },
      observeIntervalMs: 10,
    })

    expect(result.observationErrors).toContain('synthetic observation failure')
    expect(result.processError).toMatch(/observation/iu)
    expect(result.zeroDescendantsAfterRun).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('does not let a hung observer bypass the producer timeout', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 100,
      cleanupTimeoutMs: 500,
      terminationGraceMs: 50,
      observe: () => new Promise(() => {}),
      observeIntervalMs: 10,
    })

    expect(result.timedOut).toBe(true)
    expect(result.observationErrors.join(' ')).toMatch(/did not complete/iu)
    expect(result.processError).toMatch(/observation|timeout/iu)
    expect(result.zeroDescendantsAfterRun).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('cleans a same-group child after normal parent exit', async () => {
    const source = [
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { stdio: 'ignore' }); child.unref()",
    ].join(';')
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', source],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 2_000,
      terminationGraceMs: 100,
    })

    expect(result.exitCode).toBe(0)
    expect(result.zeroDescendantsAfterRun).toBe(true)
    expect(result.ownedPidsAfterExit).toEqual([])
  })

  it.skipIf(process.platform !== 'linux')('does not expose the private protocol fd to the producer', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', "try { require('node:fs').writeSync(3, 'producer must not access protocol'); process.exit(9) } catch { process.exit(0) }"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.exitCode).toBe(0)
    expect(result.processError).toBe(null)
    expect(result.cleanupVerified).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('cleans a detached child after normal producer exit', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'sartracker-owned-detached-'))
    try {
      const marker = path.join(work, 'pid')
      const source = [
        "const { spawn } = require('node:child_process')",
        "const fs = require('node:fs')",
        `const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid)); child.unref()`,
      ].join(';')
      const result = await runOwnedProcess({
        file: node,
        args: ['-e', source],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 5_000,
        cleanupTimeoutMs: 2_000,
        terminationGraceMs: 100,
      })

      const pid = Number(await readFile(marker, 'utf8'))
      expect(result.exitCode).toBe(0)
      expect(result.processError).toBe(null)
      expect(result.zeroDescendantsAfterRun).toBe(true)
      expect(result.ownedPidsAfterExit).toEqual([])
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'linux')('cleans a detached double-fork descendant while preserving an unrelated sentinel', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'sartracker-owned-doublefork-'))
    const sentinel = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
    const sentinelClosed = once(sentinel, 'close')
    await once(sentinel, 'spawn')
    const sentinelPid = sentinel.pid
    if (sentinelPid === undefined) throw new Error('Unrelated sentinel did not start.')
    try {
      const marker = path.join(work, 'pid')
      const nested = "const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); fs.writeFileSync(process.env.SARTRACKER_MARKER, String(child.pid)); child.unref()"
      const source = [
        "const { spawn } = require('node:child_process')",
        `const first = spawn(process.execPath, ['-e', ${JSON.stringify(nested)}], { detached: true, stdio: 'ignore', env: { ...process.env, SARTRACKER_MARKER: ${JSON.stringify(marker)} } }); first.unref()`,
        'setTimeout(() => {}, 500)',
      ].join(';')
      const result = await runOwnedProcess({
        file: node,
        args: ['-e', source],
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 5_000,
        cleanupTimeoutMs: 2_000,
        terminationGraceMs: 100,
      })

      let markerValue = ''
      for (let attempt = 0; attempt < 40 && markerValue === ''; attempt += 1) {
        markerValue = await readFile(marker, 'utf8').catch(() => '')
        if (markerValue === '') await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const pid = Number(markerValue)
      expect(result.exitCode).toBe(0)
      expect(result.processError).toBe(null)
      expect(result.zeroDescendantsAfterRun).toBe(true)
      expect(() => process.kill(pid, 0)).toThrow()
      expect(() => process.kill(sentinelPid, 0)).not.toThrow()
    } finally {
      sentinel.kill('SIGTERM')
      await sentinelClosed
      await rm(work, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'linux')('fails closed when the supervisor cannot launch the producer', async () => {
    const result = await runOwnedProcess({
      file: '/definitely/missing/sartracker-producer',
      args: [],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.exitCode).toBe(null)
    expect(result.processError).toMatch(/supervisor|producer|protocol|launch/iu)
    expect(result.zeroDescendantsAfterRun).toBe(false)
    expect(result.cleanupVerified).toBe(false)
  })

  it.skipIf(process.platform !== 'linux')('fails closed on a hard producer timeout after cleanup', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 100,
      cleanupTimeoutMs: 500,
      terminationGraceMs: 50,
    })

    expect(result.timedOut).toBe(true)
    expect(result.zeroDescendantsAfterRun).toBe(true)
    expect(result.cleanupVerified).toBe(true)
    expect(result.processError).toMatch(/timeout/iu)
  })

  // The Linux container's /proc scan is intentionally allowed more time only for this cross-process teardown test.
  it.skipIf(process.platform !== 'linux')('cleans the producer when its Node controller is killed', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'sartracker-owned-controller-kill-'))
    let controller
    try {
      const marker = path.join(work, 'pid')
      const producerSource = [
        "const { spawn } = require('node:child_process')",
        "const fs = require('node:fs')",
        `const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid)); child.unref()`,
        'setTimeout(() => {}, 30_000)',
      ].join(';')
      const ownedProcessUrl = pathToFileURL(path.resolve('scripts/qualification/owned-process.mjs')).href
      const controllerSource = [
        `import { runOwnedProcess } from ${JSON.stringify(ownedProcessUrl)}`,
        `await runOwnedProcess({ file: ${JSON.stringify(node)}, args: ['-e', ${JSON.stringify(producerSource)}], cwd: ${JSON.stringify(process.cwd())}, env: process.env, timeoutMs: 10_000, cleanupTimeoutMs: 2_000, terminationGraceMs: 100 })`,
      ].join(';')
      controller = spawn(node, ['--input-type=module', '-e', controllerSource], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'ignore',
      })
      await once(controller, 'spawn')
      const controllerClosed = once(controller, 'close')
      const markerValue = await waitForFile(marker)
      const detachedPid = Number(markerValue)
      expect(detachedPid).toBeGreaterThan(0)
      const ownedPidsBeforeKill = await listOwnedProcessPids(controller.pid ?? -1)
      expect(ownedPidsBeforeKill.length).toBeGreaterThan(0)
      const supervisorPids = []
      for (const pid of ownedPidsBeforeKill) {
        const commandLine = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
        if (commandLine.includes('owned-process-supervisor.py')) supervisorPids.push(pid)
      }
      expect(supervisorPids).toHaveLength(1)

      controller.kill('SIGKILL')
      await controllerClosed
      for (const pid of new Set([...ownedPidsBeforeKill, detachedPid])) {
        await waitForProcessGone(pid, { allowZombie: supervisorPids.includes(pid) })
      }
    } finally {
      if (controller?.exitCode === null && controller?.signalCode === null) {
        controller.kill('SIGKILL')
        await waitForClose(controller).catch(() => {})
      }
      await rm(work, { recursive: true, force: true })
    }
  }, 15_000)

  it.skipIf(process.platform !== 'linux')('enforces the supervisor deadline while the Node controller is frozen', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'sartracker-owned-controller-frozen-'))
    let controller
    try {
      const producerMarker = path.join(work, 'producer-pid')
      const resultFile = path.join(work, 'result.json')
      const ownedProcessUrl = pathToFileURL(path.resolve('scripts/qualification/owned-process.mjs')).href
      const producerSource = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(producerMarker)}, String(process.pid)); setTimeout(() => {}, 10_000)`
      const controllerSource = [
        `import { runOwnedProcess } from ${JSON.stringify(ownedProcessUrl)}`,
        `import { readFile, writeFile } from 'node:fs/promises'`,
        `const pending = runOwnedProcess({ file: ${JSON.stringify(node)}, args: ['-e', ${JSON.stringify(producerSource)}], cwd: ${JSON.stringify(process.cwd())}, env: process.env, timeoutMs: 200, cleanupTimeoutMs: 1_000, terminationGraceMs: 100 })`,
        `while (true) { try { await readFile(${JSON.stringify(producerMarker)}); break } catch { await new Promise(resolve => setTimeout(resolve, 10)) } }`,
        `const frozenProducerPid = Number(await readFile(${JSON.stringify(producerMarker)}, 'utf8'))`,
        'const frozenUntil = Date.now() + 1_000; while (Date.now() < frozenUntil) {}',
        'let producerGoneBeforeControllerTimeout = false; try { process.kill(frozenProducerPid, 0) } catch { producerGoneBeforeControllerTimeout = true }',
        `await writeFile(${JSON.stringify(resultFile)}, JSON.stringify({ producerGoneBeforeControllerTimeout, result: await pending }))`,
      ].join(';')
      controller = spawn(node, ['--input-type=module', '-e', controllerSource], {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'ignore',
      })
      await once(controller, 'spawn')
      await waitForClose(controller)
      const evidence = JSON.parse(await readFile(resultFile, 'utf8'))
      expect(evidence.producerGoneBeforeControllerTimeout).toBe(true)
      expect(evidence.result.timedOut).toBe(true)
      expect(evidence.result.processError).toMatch(/timeout/iu)
      expect(evidence.result.cleanupVerified).toBe(true)
      expect(evidence.result.zeroDescendantsAfterRun).toBe(true)
    } finally {
      if (controller?.exitCode === null && controller?.signalCode === null) {
        controller.kill('SIGKILL')
        await waitForClose(controller).catch(() => {})
      }
      await rm(work, { recursive: true, force: true })
    }
  })
})
