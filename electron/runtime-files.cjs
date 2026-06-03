const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

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

/**
 * Creates Electron main-process file adapters for app-owned runtime state.
 */
function createElectronRuntimeFiles(options) {
  const userDataPath = options.userDataPath
  const trackingCachePath = path.join(userDataPath, TRACKING_CACHE_FILE_NAME)

  return {
    readTrackingCache,
    writeTrackingCache,
    exportDiagnosticsReport,
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
    const fileName = sanitizeReportFileName(input.fileName)
    const reportPath = path.join(userDataPath, DIAGNOSTICS_DIR_NAME, fileName)
    const settings = await options.loadSettings()
    const report = buildElectronDiagnosticsReport({
      contents: input.contents,
      settings,
      versions: options.versions,
      platform: options.platform,
      userDataPath,
      safeStorageBackend: options.safeStorageBackend(),
    })
    await writeTextAtomically(reportPath, report)
    return reportPath
  }
}

function buildElectronDiagnosticsReport(input) {
  return [
    '[electron]',
    `electron: ${input.versions.electron}`,
    `chrome: ${input.versions.chrome}`,
    `node: ${input.versions.node}`,
    `platform: ${input.platform}`,
    `os release: ${os.release()}`,
    `userData path: ${input.userDataPath}`,
    `safeStorage backend: ${input.safeStorageBackend}`,
    `provider url: ${input.settings.dataSource.baseUrl || 'not configured'}`,
    `auth mode: ${input.settings.dataSource.authMode}`,
    `secret present: ${input.settings.dataSource.secretPresent ? 'yes' : 'no'}`,
    `official maps: ${input.settings.officialMaps?.status ?? 'not_configured'}`,
    `official map source type: ${input.settings.officialMaps?.sourceType ?? 'none'}`,
    `official map services: ${input.settings.officialMaps?.serviceCount ?? 0}`,
    '',
    '[support-report]',
    redactSecrets(input.contents),
    '',
  ].join('\n')
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

function redactSecrets(contents) {
  return String(contents)
    .split('\n')
    .map((line) => {
      if (/(password|token|secret)\s*[:=]/i.test(line)) {
        return line.replace(/([:=]\s*).+$/u, '$1[redacted]')
      }
      return line
    })
    .join('\n')
}

module.exports = {
  FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS,
  createElectronRuntimeFiles,
}
