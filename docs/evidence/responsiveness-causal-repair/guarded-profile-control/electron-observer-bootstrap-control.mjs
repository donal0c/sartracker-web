import { createServer } from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(directory)
const tag = process.argv[2] ?? 'current'
const evidence = path.join(directory, `electron-observer-bootstrap-${tag}`)
await mkdir(evidence, { recursive: true })
const http = createServer((_request, response) => { response.writeHead(200); response.end('bootstrap fetch ok') })
http.listen(0, '127.0.0.1'); await once(http, 'listening')
const reservation = net.createServer()
reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const logs = []
const output = path.join(evidence, 'observer.json')
const observer = spawn(process.execPath, [path.join(directory, 'main-loop-sqlite-profile-companion.mjs'),
  '--port', String(port), '--output', output, '--duration-ms', '20000', '--profile-ms', '8000'],
{ stdio: ['ignore', 'pipe', 'pipe'] })
observer.stderr.on('data', (chunk) => logs.push(chunk.toString()))
const observerExit = once(observer, 'exit')
const child = spawn(path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  [`--inspect=127.0.0.1:${port}`, path.join(directory, 'electron-observer-bootstrap-child.cjs')], {
    cwd: root, env: { ...process.env, SAR_OBSERVER_CONTROL_URL: `http://127.0.0.1:${http.address().port}/`,
      SAR_OBSERVER_CONTROL_RECEIPT: path.join(evidence, 'child.json'), SAR_SQLITE_DIAGNOSTIC_PACKAGE: path.join(root, 'package.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
child.stderr.on('data', (chunk) => logs.push(chunk.toString()))
const deadline = setTimeout(() => { child.kill('SIGKILL'); observer.kill('SIGTERM') }, 18000)
try {
  const [childCode] = await once(child, 'exit')
  await new Promise((resolve) => setTimeout(resolve, 1300))
  observer.kill('SIGTERM')
  const [observerCode] = await observerExit
  const receipt = JSON.parse(await readFile(path.join(evidence, 'child.json'), 'utf8'))
  const report = JSON.parse(await readFile(output, 'utf8'))
  await writeFile(path.join(evidence, 'exit.json'), JSON.stringify({ childCode, observerCode }))
  assert.equal(childCode, 0)
  assert.equal(observerCode, 0)
  assert.equal(receipt.fetches.length, 3)
  assert.deepEqual(receipt.errors, [])
  assert.ok(receipt.fetches.every((entry) => entry.status === 200 && entry.body === 'bootstrap fetch ok'))
  assert.equal(receipt.timerInstalled, true)
  assert.equal(report.launches.length, 1)
  assert.equal(report.launches[0].readinessAtInstallation.ready, true)
  assert.ok(report.launches[0].installedAtMainWallMs >= receipt.readyAtUnixMs)
  assert.deepEqual(report.preinstallationErrors, [])
  assert.ok(report.launches[0].latestSnapshot.maximumGapMs >= 200)
  assert.equal(report.launches[0].profile.cpuProfileComplete, true)
  assert.equal(report.launches[0].profile.endReason, 'application_shutdown')
  assert.equal(report.qualifiedPass, false)
  logs.push(`PASS actual Electron fetch/timer/CPU profile/natural exit; max gap ${report.launches[0].latestSnapshot.maximumGapMs}\n`)
} finally {
  clearTimeout(deadline); child.kill('SIGKILL'); observer.kill('SIGTERM')
  await new Promise((resolve) => http.close(resolve))
  await writeFile(path.join(evidence, 'control.log'), logs.join(''))
}
