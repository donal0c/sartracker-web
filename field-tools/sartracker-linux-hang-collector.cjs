#!/usr/bin/env node

const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const {
  buildProcessTree,
  classifyProcessRole,
  parseCollectorArgs,
  sanitizeCollectorText,
} = require('./sartracker-linux-hang-collector-lib.cjs')

const MAX_EVIDENCE_FILE_BYTES = 1_000_000
const APP_DATA_FILES = Object.freeze([
  'logs/runtime.log',
  'logs/runtime.log.1',
  'storage-diagnostics.json',
  'crashes/crash-log.json',
  'crashes/last-clean-exit',
])
const APP_SIZE_FILES = Object.freeze([
  'mission-store.sqlite',
  'mission-store.sqlite-wal',
  'mission-store.sqlite-shm',
  'mission-store.backup.sqlite',
])

main().catch((error) => {
  console.error(
    `sartracker-linux-hang-collector: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})

/** Collects bounded report-only Linux evidence without signalling the target app. */
async function main() {
  if (process.platform !== 'linux' && process.env.SARTRACKER_COLLECTOR_ALLOW_NON_LINUX !== '1') {
    throw new Error('This collector runs only on Linux.')
  }
  const options = parseCollectorArgs(process.argv.slice(2))
  const rootPid = options.pid ?? (await discoverRootPid(options.procRoot))
  await assertReadableProcess(options.procRoot, rootPid)
  const outputDirectory = path.resolve(
    options.output ?? `sartracker-hang-evidence-${safeTimestamp(new Date())}`,
  )
  await fsp.mkdir(outputDirectory, { recursive: false, mode: 0o700 })

  const warnings = []
  const samples = []
  for (let index = 0; index < options.samples; index += 1) {
    samples.push(await collectProcessSample(options.procRoot, rootPid, warnings))
    if (index < options.samples - 1 && options.intervalMs > 0) {
      await delay(options.intervalMs)
    }
  }
  const processTree = buildProcessTree(samples[0]?.processes ?? [], rootPid)
  const userDataPath = await resolveUserDataPath(options.userData)
  const appData = await collectAppData(userDataPath, outputDirectory, warnings)
  const commands = collectSystemCommands(samples[0]?.processes ?? [], warnings)
  const screenshot = options.screenshot
    ? collectScreenshot(outputDirectory, warnings)
    : { requested: false, captured: false }
  const report = {
    schemaVersion: 1,
    issue: 'DON-247',
    recordedAt: new Date().toISOString(),
    readOnly: true,
    rootPid,
    processTree,
    samples,
    platform: {
      type: os.type(),
      release: os.release(),
      architecture: os.arch(),
      session: collectSessionMetadata(),
      osRelease: await readSanitizedFile('/etc/os-release'),
    },
    commands,
    appData,
    screenshot,
    warnings,
  }

  await writePrivateJson(path.join(outputDirectory, 'collector-report.json'), report)
  await writeChecksums(outputDirectory)
  const archivePath = options.archive
    ? await createArchive(outputDirectory, warnings)
    : null

  console.log(`SAR Tracker hang evidence: ${outputDirectory}`)
  if (archivePath !== null) {
    console.log(`Shareable archive: ${archivePath}`)
  }
  if (warnings.length > 0) {
    console.log(`Completed with ${warnings.length} unavailable evidence item(s); see report.`)
  }
}

/** Finds one unambiguous main SAR Tracker process without reading process environments. */
async function discoverRootPid(procRoot) {
  const entries = await fsp.readdir(procRoot, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
      continue
    }
    const pid = Number(entry.name)
    const [commandLine, status] = await Promise.all([
      readProcFile(procRoot, pid, 'cmdline'),
      readProcFile(procRoot, pid, 'status'),
    ])
    const normalized = commandLine.replaceAll('\0', ' ')
    if (
      classifyProcessRole(normalized) === 'main' &&
      /sar.?tracker|sartracker-web/iu.test(normalized)
    ) {
      candidates.push({ pid, ppid: readStatusNumber(status, 'PPid') })
    }
  }
  const roots = candidates.filter(
    (candidate) => !candidates.some((other) => other.pid === candidate.ppid),
  )
  if (roots.length !== 1) {
    throw new Error(
      `Could not select one SAR Tracker main process; found ${roots.length}. Pass --pid <main-pid>.`,
    )
  }
  return roots[0].pid
}

/** Rejects stale or inaccessible PIDs before creating an evidence directory. */
async function assertReadableProcess(procRoot, pid) {
  const status = await readProcFile(procRoot, pid, 'status')
  if (status === '') {
    throw new Error(`Process ${pid} is not readable under ${procRoot}.`)
  }
}

/** Captures one process/thread state sample for the selected process tree. */
async function collectProcessSample(procRoot, rootPid, warnings) {
  const pids = await collectDescendantPids(procRoot, rootPid)
  const processes = []
  for (const pid of pids) {
    const processEvidence = await collectProcessEvidence(procRoot, pid, warnings)
    if (processEvidence !== null) {
      processes.push(processEvidence)
    }
  }
  return {
    recordedAt: new Date().toISOString(),
    processes: processes.sort((left, right) => left.pid - right.pid),
  }
}

/** Walks `/proc` child pointers without invoking process-management commands. */
async function collectDescendantPids(procRoot, rootPid) {
  const pending = [rootPid]
  const visited = new Set()
  while (pending.length > 0) {
    const pid = pending.pop()
    if (!Number.isInteger(pid) || visited.has(pid)) {
      continue
    }
    visited.add(pid)
    const children = await readProcFile(procRoot, pid, `task/${pid}/children`)
    for (const child of children.trim().split(/\s+/u)) {
      if (child !== '') {
        pending.push(Number(child))
      }
    }
  }
  return [...visited].sort((left, right) => left - right)
}

/** Reads allow-listed process and thread fields, never process environments or memory. */
async function collectProcessEvidence(procRoot, pid, warnings) {
  const [status, commandLine, comm, wchan, io, schedstat] = await Promise.all([
    readProcFile(procRoot, pid, 'status'),
    readProcFile(procRoot, pid, 'cmdline'),
    readProcFile(procRoot, pid, 'comm'),
    readProcFile(procRoot, pid, 'wchan'),
    readProcFile(procRoot, pid, 'io'),
    readProcFile(procRoot, pid, 'schedstat'),
  ])
  if (status === '') {
    warnings.push(`process-${pid}-status-unavailable`)
    return null
  }
  const normalizedCommandLine = sanitizeCollectorText(commandLine.replaceAll('\0', ' ').trim())
  return {
    pid,
    ppid: readStatusNumber(status, 'PPid'),
    role: classifyProcessRole(normalizedCommandLine),
    command: sanitizeCollectorText(comm.trim()),
    commandLine: normalizedCommandLine,
    state: readStatusText(status, 'State'),
    residentBytes: readStatusKilobytes(status, 'VmRSS'),
    virtualBytes: readStatusKilobytes(status, 'VmSize'),
    threads: readStatusNumber(status, 'Threads'),
    voluntaryContextSwitches: readStatusNumber(status, 'voluntary_ctxt_switches'),
    nonvoluntaryContextSwitches: readStatusNumber(status, 'nonvoluntary_ctxt_switches'),
    waitChannel: sanitizeCollectorText(wchan.trim()),
    io: parseNumericKeyValues(io),
    scheduler: schedstat.trim().split(/\s+/u).map(Number).filter(Number.isFinite),
    fileDescriptorCount: await countDirectoryEntries(path.join(procRoot, String(pid), 'fd')),
    threadStates: await collectThreadStates(procRoot, pid),
  }
}

/** Captures stable per-thread command and wait-channel evidence. */
async function collectThreadStates(procRoot, pid) {
  const taskRoot = path.join(procRoot, String(pid), 'task')
  const entries = await fsp.readdir(taskRoot, { withFileTypes: true }).catch(() => [])
  const threads = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
      continue
    }
    const tid = Number(entry.name)
    const [comm, wchan, stat] = await Promise.all([
      readProcFile(procRoot, pid, `task/${tid}/comm`),
      readProcFile(procRoot, pid, `task/${tid}/wchan`),
      readProcFile(procRoot, pid, `task/${tid}/stat`),
    ])
    threads.push({
      tid,
      command: sanitizeCollectorText(comm.trim()),
      waitChannel: sanitizeCollectorText(wchan.trim()),
      state: parseThreadState(stat),
    })
  }
  return threads.sort((left, right) => left.tid - right.tid)
}

/** Copies only bounded app-owned diagnostic files after applying the privacy sanitizer. */
async function collectAppData(userDataPath, outputDirectory, warnings) {
  if (userDataPath === null) {
    warnings.push('user-data-directory-unavailable')
    return { found: false, files: [], sizes: {} }
  }
  const targetDirectory = path.join(outputDirectory, 'app-data')
  await fsp.mkdir(targetDirectory, { recursive: true, mode: 0o700 })
  const files = []
  for (const relativePath of APP_DATA_FILES) {
    const sourcePath = path.join(userDataPath, relativePath)
    const contents = await readBoundedFile(sourcePath)
    if (contents === null) {
      continue
    }
    const targetName = path.basename(relativePath)
    await fsp.writeFile(
      path.join(targetDirectory, targetName),
      sanitizeCollectorText(contents),
      { encoding: 'utf8', mode: 0o600 },
    )
    files.push({ source: relativePath, collectedAs: targetName })
  }
  const sizes = {}
  for (const fileName of APP_SIZE_FILES) {
    const stats = await fsp.stat(path.join(userDataPath, fileName)).catch(() => null)
    sizes[fileName] = stats?.isFile() ? stats.size : 0
  }
  return {
    found: true,
    directoryName: path.basename(userDataPath),
    files,
    sizes,
  }
}

/** Resolves an explicit or standard Linux user-data directory without scanning private files. */
async function resolveUserDataPath(explicitPath) {
  const candidates =
    explicitPath === undefined
      ? [
          path.join(os.homedir(), '.config', 'sartracker-web'),
          path.join(os.homedir(), '.config', 'SAR Tracker Electron Validation'),
        ]
      : [path.resolve(explicitPath)]
  for (const candidate of candidates) {
    const stats = await fsp.stat(candidate).catch(() => null)
    if (stats?.isDirectory()) {
      return candidate
    }
  }
  return null
}

/** Runs bounded read-only system commands and records unavailable tools explicitly. */
function collectSystemCommands(processes, warnings) {
  const pidList = processes.map((process) => process.pid).join(',')
  return {
    processThreads: runEvidenceCommand(
      'ps',
      ['-L', '-p', pidList, '-o', 'pid,tid,ppid,stat,pcpu,pmem,etime,wchan:32,comm'],
      warnings,
    ),
    graphics: runEvidenceCommand('sh', [
      '-c',
      "command -v lspci >/dev/null 2>&1 && lspci -nnk | sed -n '/VGA\\|3D\\|Display/,+3p'",
    ], warnings),
    openGl: runEvidenceCommand('glxinfo', ['-B'], warnings),
    recentJournal: runEvidenceCommand(
      'journalctl',
      [
        '--user',
        '--since',
        '-15 minutes',
        '--no-pager',
        '-n',
        '500',
        ...processes.map((process) => `_PID=${process.pid}`),
      ],
      warnings,
    ),
  }
}

/** Runs one command without a shell unless the command itself is an explicit fixed shell script. */
function runEvidenceCommand(command, args, warnings) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: MAX_EVIDENCE_FILE_BYTES,
    timeout: 10_000,
  })
  if (result.error !== undefined || result.status !== 0) {
    warnings.push(`command-unavailable:${command}`)
  }
  return {
    status: result.status,
    errorClass: result.error?.name ?? null,
    output: sanitizeCollectorText(`${result.stdout ?? ''}${result.stderr ?? ''}`).slice(
      0,
      MAX_EVIDENCE_FILE_BYTES,
    ),
  }
}

/** Collects only non-secret desktop/session selectors. */
function collectSessionMetadata() {
  const keys = [
    'XDG_SESSION_TYPE',
    'XDG_CURRENT_DESKTOP',
    'DESKTOP_SESSION',
    'DISPLAY',
    'WAYLAND_DISPLAY',
  ]
  return Object.fromEntries(keys.map((key) => [key, sanitizeCollectorText(process.env[key] ?? '')]))
}

/** Captures a screenshot only after the operator explicitly passes `--screenshot`. */
function collectScreenshot(outputDirectory, warnings) {
  const screenshotPath = path.join(outputDirectory, 'operator-requested-screenshot.png')
  const candidates = [
    ['gnome-screenshot', ['-f', screenshotPath]],
    ['scrot', [screenshotPath]],
  ]
  for (const [command, args] of candidates) {
    const result = childProcess.spawnSync(command, args, { timeout: 15_000 })
    if (result.status === 0 && fs.existsSync(screenshotPath)) {
      return { requested: true, captured: true, file: path.basename(screenshotPath) }
    }
  }
  warnings.push('operator-requested-screenshot-unavailable')
  return { requested: true, captured: false }
}

/** Creates a compressed archive using the standard Linux tar utility. */
async function createArchive(outputDirectory, warnings) {
  const archivePath = `${outputDirectory}.tar.gz`
  const result = childProcess.spawnSync(
    'tar',
    ['-czf', archivePath, '-C', path.dirname(outputDirectory), path.basename(outputDirectory)],
    { encoding: 'utf8', timeout: 30_000 },
  )
  if (result.status !== 0) {
    warnings.push('archive-creation-failed')
    return null
  }
  return archivePath
}

/** Writes SHA-256 checksums for all evidence files except the checksum file itself. */
async function writeChecksums(outputDirectory) {
  const files = await listFiles(outputDirectory)
  const lines = []
  for (const filePath of files) {
    const relativePath = path.relative(outputDirectory, filePath)
    lines.push(`${await sha256File(filePath)}  ${relativePath}`)
  }
  await fsp.writeFile(path.join(outputDirectory, 'SHA256SUMS'), `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

/** Lists regular files in deterministic relative-path order. */
async function listFiles(directory) {
  const files = []
  const entries = await fsp.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files.sort()
}

/** Returns a SHA-256 hash without loading the evidence file into memory. */
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

/** Reads one proc-relative file, returning an empty string when unavailable. */
async function readProcFile(procRoot, pid, relativePath) {
  return fsp.readFile(path.join(procRoot, String(pid), relativePath), 'utf8').catch(() => '')
}

/** Reads at most the last bounded evidence bytes of one diagnostic file. */
async function readBoundedFile(filePath) {
  const stats = await fsp.stat(filePath).catch(() => null)
  if (!stats?.isFile()) {
    return null
  }
  const handle = await fsp.open(filePath, 'r')
  try {
    const length = Math.min(stats.size, MAX_EVIDENCE_FILE_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, Math.max(0, stats.size - length))
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Reads and sanitizes a small system file. */
async function readSanitizedFile(filePath) {
  const contents = await readBoundedFile(filePath)
  return contents === null ? '' : sanitizeCollectorText(contents)
}

/** Extracts a numeric field from Linux status text. */
function readStatusNumber(status, key) {
  const match = status.match(new RegExp(`^${key}:\\s+(\\d+)`, 'mu'))
  return match === null ? 0 : Number(match[1])
}

/** Extracts a text field from Linux status text. */
function readStatusText(status, key) {
  const match = status.match(new RegExp(`^${key}:\\s+(.+)$`, 'mu'))
  return match === null ? '' : sanitizeCollectorText(match[1].trim())
}

/** Extracts a kilobyte status field as bytes. */
function readStatusKilobytes(status, key) {
  return readStatusNumber(status, key) * 1024
}

/** Parses numeric `key: value` proc evidence. */
function parseNumericKeyValues(contents) {
  return Object.fromEntries(
    String(contents)
      .split(/\r?\n/u)
      .flatMap((line) => {
        const match = line.match(/^([a-z_]+):\s+(\d+)$/iu)
        return match === null ? [] : [[match[1], Number(match[2])]]
      }),
  )
}

/** Extracts the thread state character after the `(comm)` field. */
function parseThreadState(stat) {
  const match = String(stat).match(/\)\s+([A-Z])\s/u)
  return match?.[1] ?? ''
}

/** Counts a proc directory without following any file-descriptor targets. */
async function countDirectoryEntries(directory) {
  const entries = await fsp.readdir(directory).catch(() => [])
  return entries.length
}

/** Writes private JSON evidence atomically enough for a one-shot collector. */
async function writePrivateJson(filePath, value) {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

/** Produces a path-safe UTC timestamp. */
function safeTimestamp(date) {
  return date.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/u, 'Z')
}

/** Waits only between bounded read-only samples. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
