const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

const { sanitizeDiagnosticText } = require('./diagnostic-sanitizer.cjs')

const TRACKING_CACHE_FILE_NAME = 'tracking-cache.json'
const DIAGNOSTICS_DIR_NAME = 'diagnostics-reports'
const FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS = Object.freeze([
  'Cookies',
  'GPUCache',
  'Local Storage',
  'Session Storage',
  'Network Persistent State',
  'Trust Tokens',
  'Code Cache',
])
const DEFAULT_INCIDENT_WINDOW_MINUTES = 30
const SECRET_LINE_KEY_PATTERN = /(password|token|secret|credential|api[-_]?key|authorization)\s*[:=]/i

/**
 * Creates Electron main-process file adapters for app-owned runtime state.
 */
function createElectronRuntimeFiles(options) {
  const userDataPath = options.userDataPath
  const trackingCachePath = path.join(userDataPath, TRACKING_CACHE_FILE_NAME)

  const readRecentCrashes =
    typeof options.readRecentCrashes === 'function' ? options.readRecentCrashes : async () => []
  const readRecentLog =
    typeof options.readRecentLog === 'function' ? options.readRecentLog : async () => []

  return {
    readTrackingCache,
    writeTrackingCache,
    exportDiagnosticsReport,
    exportSupportBundle,
  }

  async function readTrackingCache() {
    try {
      return await fs.readFile(trackingCachePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null
      }
      throw new Error(`Failed to read tracking cache: ${error.message}`)
    }
  }

  async function writeTrackingCache(contents) {
    await writeTextAtomically(trackingCachePath, contents)
    return trackingCachePath
  }

  async function exportDiagnosticsReport(input) {
    return writeReport(input.fileName, await buildReport(input.contents))
  }

  async function exportSupportBundle(input) {
    const incidentWindow = normalizeIncidentWindow(input?.timeFrame)
    const [report, crashes, logEntries] = await Promise.all([
      buildReport(input.contents),
      readRecentCrashes().catch(() => []),
      readRecentLog().catch(() => []),
    ])
    const bundle = [
      report,
      ...(incidentWindow === null ? [] : [formatIncidentWindow(incidentWindow), '']),
      formatCrashHistory(filterEntriesByIncidentWindow(crashes, incidentWindow)),
      '',
      formatRuntimeLog(filterEntriesByIncidentWindow(logEntries, incidentWindow)),
      '',
    ].join('\n')
    return writeReport(input.fileName, bundle)
  }

  async function buildReport(contents) {
    const settings = await options.loadSettings()
    return buildElectronDiagnosticsReport({
      contents,
      settings,
      versions: options.versions,
      platform: options.platform,
      userDataPath,
      safeStorageBackend: options.safeStorageBackend(),
    })
  }

  async function writeReport(fileName, contents) {
    const safeName = sanitizeReportFileName(fileName)
    const reportPath = path.join(userDataPath, DIAGNOSTICS_DIR_NAME, safeName)
    await writeTextAtomically(reportPath, contents)
    return reportPath
  }
}

function formatIncidentWindow(incidentWindow) {
  return [
    '[incident-window]',
    `incident time: ${incidentWindow.incidentAt}`,
    `window start: ${incidentWindow.startAt}`,
    `window end: ${incidentWindow.endAt}`,
    `window before minutes: ${incidentWindow.beforeMinutes}`,
    `window after minutes: ${incidentWindow.afterMinutes}`,
  ].join('\n')
}

function formatCrashHistory(crashes) {
  const entries = Array.isArray(crashes) ? crashes : []
  const lines = ['[crash-history]', `crash count: ${entries.length}`]
  if (entries.length === 0) {
    lines.push('no crashes recorded since last clean exit')
    return lines.join('\n')
  }
  for (const crash of entries) {
    const ts = readDiagnosticsValue(crash?.ts, 'unknown-time')
    const kind = readDiagnosticsValue(crash?.kind, 'unknown')
    const summary = sanitizeDiagnosticsText(readDiagnosticsValue(crash?.summary, '(no summary)'))
    lines.push(`${ts} ${kind}: ${summary}`)
    const detail = sanitizeDiagnosticsText(readDiagnosticsValue(crash?.detail, ''))
    if (detail !== '') {
      lines.push(`  detail: ${detail}`)
    }
  }
  return lines.join('\n')
}

function formatRuntimeLog(logEntries) {
  const entries = Array.isArray(logEntries) ? logEntries : []
  const lines = ['[runtime-log]']
  if (entries.length === 0) {
    lines.push('no runtime log entries recorded')
    return lines.join('\n')
  }
  for (const entry of entries) {
    lines.push(sanitizeDiagnosticsText(JSON.stringify(entry)))
  }
  return lines.join('\n')
}

function buildElectronDiagnosticsReport(input) {
  return [
    '[electron]',
    `electron: ${input.versions.electron}`,
    `chrome: ${input.versions.chrome}`,
    `node: ${input.versions.node}`,
    `platform: ${input.platform}`,
    `os release: ${os.release()}`,
    `userData path: ${sanitizeDiagnosticsText(input.userDataPath)}`,
    `safeStorage backend: ${input.safeStorageBackend}`,
    `credential storage: local-file`,
    `provider url: ${redactUrlCredentials(input.settings.dataSource.baseUrl) || 'not configured'}`,
    `auth mode: ${input.settings.dataSource.authMode}`,
    `secret present: ${input.settings.dataSource.secretPresent ? 'yes' : 'no'}`,
    `official maps: ${input.settings.officialMaps?.status ?? 'not_configured'}`,
    `official map source type: ${input.settings.officialMaps?.sourceType ?? 'none'}`,
    `official map services: ${input.settings.officialMaps?.serviceCount ?? 0}`,
    ...formatOfficialMapPackages(input.settings.officialMaps?.packages),
    '',
    '[support-report]',
    sanitizeDiagnosticsText(input.contents),
    '',
  ].join('\n')
}

function formatOfficialMapPackages(input) {
  const packages = Array.isArray(input) ? input : []
  const readyCount = packages.filter((mapPackage) => mapPackage?.status === 'ready').length
  return [
    `official map packages: ${packages.length}`,
    `official map packages ready: ${readyCount}`,
    ...packages.map((mapPackage, index) => formatOfficialMapPackage(mapPackage, index + 1)),
  ]
}

function formatOfficialMapPackage(mapPackage, index) {
  const mapId = readDiagnosticsValue(mapPackage?.mapId, 'unknown')
  const status = readDiagnosticsValue(mapPackage?.status, 'unknown')
  const sourceType = readDiagnosticsValue(mapPackage?.sourceType, 'unknown')
  const details = [`official map package ${index}: ${mapId} ${status} ${sourceType}`]
  if (Number.isFinite(mapPackage?.minZoom) && Number.isFinite(mapPackage?.maxZoom)) {
    details.push(`z${mapPackage.minZoom}-z${mapPackage.maxZoom}`)
  }
  if (Number.isFinite(mapPackage?.tileCount) && mapPackage.tileCount > 0) {
    details.push(`tiles=${mapPackage.tileCount}`)
  }
  if (Number.isFinite(mapPackage?.sizeBytes) && mapPackage.sizeBytes > 0) {
    details.push(`size=${mapPackage.sizeBytes}`)
  }
  const tileFormat = readDiagnosticsValue(mapPackage?.tileFormat, '')
  if (tileFormat !== '') {
    details.push(`format=${tileFormat}`)
  }
  if (Array.isArray(mapPackage?.bounds) && mapPackage.bounds.length === 4) {
    details.push(`bounds=${mapPackage.bounds.map(formatCoordinate).join(',')}`)
  }
  const verifiedAt = readDiagnosticsValue(mapPackage?.verifiedAt, '')
  if (verifiedAt !== '') {
    details.push(`verified=${verifiedAt}`)
  }
  return details.join(' ')
}

function readDiagnosticsValue(input, fallback) {
  return typeof input === 'string' && input.trim() !== '' ? input.trim() : fallback
}

function normalizeIncidentWindow(input) {
  if (input === null || typeof input !== 'object') {
    return null
  }
  const incidentMs = Date.parse(input.incidentAt)
  if (!Number.isFinite(incidentMs)) {
    return null
  }
  const beforeMinutes = normalizeWindowMinutes(input.beforeMinutes)
  const afterMinutes = normalizeWindowMinutes(input.afterMinutes)
  const startMs = incidentMs - beforeMinutes * 60_000
  const endMs = incidentMs + afterMinutes * 60_000
  return {
    incidentAt: new Date(incidentMs).toISOString(),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    startMs,
    endMs,
    beforeMinutes,
    afterMinutes,
  }
}

function normalizeWindowMinutes(input) {
  return Number.isFinite(input) && input >= 0 ? input : DEFAULT_INCIDENT_WINDOW_MINUTES
}

function filterEntriesByIncidentWindow(entries, incidentWindow) {
  if (incidentWindow === null) {
    return Array.isArray(entries) ? entries : []
  }
  if (!Array.isArray(entries)) {
    return []
  }
  return entries.filter((entry) => {
    const timestampMs = Date.parse(entry?.ts)
    return (
      Number.isFinite(timestampMs) &&
      timestampMs >= incidentWindow.startMs &&
      timestampMs <= incidentWindow.endMs
    )
  })
}

function formatCoordinate(input) {
  const value = Number(input)
  if (!Number.isFinite(value)) {
    return 'unknown'
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

async function writeTextAtomically(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, contents, 'utf8')
  await fs.rename(tempPath, filePath)
}

function sanitizeReportFileName(input) {
  const trimmed = typeof input === 'string' ? input.trim() : ''
  if (trimmed === '') {
    throw new Error('Diagnostics report file name is required.')
  }

  const baseName = path.basename(trimmed)
  const sanitized = baseName.replace(/[/:*?"<>|\\]/g, '-')
  if (sanitized.trim() === '') {
    throw new Error('Diagnostics report file name is invalid.')
  }

  return sanitized
}

function sanitizeDiagnosticsText(contents) {
  let sanitized = sanitizeDiagnosticText(contents)

  for (const segment of FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS) {
    sanitized = sanitized.replaceAll(segment, '[redacted-path-segment]')
  }

  return sanitized
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('{')) {
        return line
      }
      if (SECRET_LINE_KEY_PATTERN.test(line)) {
        return line.replace(
          /((?:password|token|secret|credential|api[-_]?key|authorization)\s*[:=]\s*).+$/iu,
          '$1[redacted]',
        )
      }
      return line
    })
    .join('\n')
}

function redactUrlCredentials(input) {
  return sanitizeDiagnosticText(readDiagnosticsValue(input, ''))
}

module.exports = {
  FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS,
  createElectronRuntimeFiles,
}
