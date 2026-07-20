const SECRET_JSON_KEY_PATTERN =
  /("(?:password|token|secret|credential|api[-_]?key|authorization)"\s*:\s*)"[^"]*"/gi
const AUTH_HEADER_PATTERN = /\b(Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+/gi
const AUTH_TOKEN_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS_PATTERN = /\b(https?:\/\/)[^/\s@]+@/gi
const HOME_PATH_PATTERNS = Object.freeze([
  [/(\/(?:home|Users)\/)[^/\s:"]+/g, '$1[redacted]'],
  [/([A-Za-z]:\\Users\\)[^\\\s:"]+/g, '$1[redacted]'],
])

/** Redacts secrets and local user identities from collector evidence. */
function sanitizeCollectorText(input) {
  let sanitized = String(input)
    .replace(SECRET_JSON_KEY_PATTERN, '$1"[redacted]"')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')

  for (const [pattern, replacement] of HOME_PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }
  return sanitized
}

/** Returns the stable Electron process role encoded in a Chromium command line. */
function classifyProcessRole(commandLine) {
  const typeMatch = String(commandLine).match(/(?:^|\s)--type=([^\s]+)/u)
  if (typeMatch === null) {
    return 'main'
  }
  const type = typeMatch[1]
  if (type === 'gpu-process') {
    return 'gpu'
  }
  if (type === 'renderer') {
    return 'renderer'
  }
  if (type === 'utility') {
    return 'utility'
  }
  return `chromium:${type}`
}

/** Builds a PID-sorted tree using only processes descended from the selected root. */
function buildProcessTree(processes, rootPid) {
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  const childrenByParent = new Map()
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? []
    children.push(process.pid)
    childrenByParent.set(process.ppid, children)
  }

  function buildNode(pid, visited) {
    if (visited.has(pid)) {
      return null
    }
    const process = byPid.get(pid)
    if (process === undefined) {
      return null
    }
    const nextVisited = new Set(visited)
    nextVisited.add(pid)
    const children = (childrenByParent.get(pid) ?? [])
      .sort((left, right) => left - right)
      .flatMap((childPid) => {
        const child = buildNode(childPid, nextVisited)
        return child === null ? [] : [child]
      })
    return {
      pid,
      role: classifyProcessRole(process.commandLine),
      children,
    }
  }

  return buildNode(rootPid, new Set())
}

/** Parses the collector CLI into bounded fail-closed options. */
function parseCollectorArgs(argv) {
  const parsed = {
    samples: 3,
    intervalMs: 1_000,
    archive: true,
    screenshot: false,
    procRoot: '/proc',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`)
      }
      index += 1
      return value
    }

    switch (token) {
      case '--pid':
        parsed.pid = Number(nextValue())
        break
      case '--output':
        parsed.output = nextValue()
        break
      case '--user-data':
        parsed.userData = nextValue()
        break
      case '--samples':
        parsed.samples = Number(nextValue())
        break
      case '--interval-ms':
        parsed.intervalMs = Number(nextValue())
        break
      case '--proc-root':
        parsed.procRoot = nextValue()
        break
      case '--no-archive':
        parsed.archive = false
        break
      case '--screenshot':
        parsed.screenshot = true
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (parsed.pid !== undefined && (!Number.isInteger(parsed.pid) || parsed.pid <= 1)) {
    throw new Error('--pid must identify a positive non-init process.')
  }
  if (!Number.isInteger(parsed.samples) || parsed.samples < 1 || parsed.samples > 10) {
    throw new Error('--samples must be an integer between 1 and 10.')
  }
  if (!Number.isInteger(parsed.intervalMs) || parsed.intervalMs < 0 || parsed.intervalMs > 10_000) {
    throw new Error('--interval-ms must be an integer between 0 and 10000.')
  }
  return parsed
}

module.exports = {
  buildProcessTree,
  classifyProcessRole,
  parseCollectorArgs,
  sanitizeCollectorText,
}
