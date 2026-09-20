import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const KNOWN_CAPABILITIES = Object.freeze(['node', 'fs', 'git', 'gh', 'electron', 'package-host'])

/**
 * Inspect static prerequisites needed before a qualification adapter can run.
 * The result describes host readiness only; it never launches Electron or a
 * candidate package and therefore cannot establish runtime identity.
 *
 * @param {object} options deterministic inspection overrides for tests
 * @returns {object} immutable capability inventory and missing reasons
 */
export function inspectHostCapabilities(options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const commandAvailable = options.commandAvailable ?? hasCommand
  const playwrightElectron = options.playwrightElectronAvailable ?? hasPlaywrightElectron(options.packageRoot ?? REPOSITORY_ROOT)
  const display = options.displayAvailable ?? hasDisplayPrerequisite(options.environment ?? process.env)
  const linuxX64 = platform === 'linux' && arch === 'x64'
  const git = commandAvailable('git')
  const gh = commandAvailable('gh')
  const electron = options.electronAvailable ?? process.versions.electron !== undefined
  const missingTools = ['unzip', 'unsquashfs', 'dpkg-deb', 'dpkg-query', 'xdotool', 'xwininfo'].filter(name => !commandAvailable(name))
  const packageHost = linuxX64 && playwrightElectron && display && missingTools.length === 0
  const checks = {
    node: validNodeRuntime(),
    fs: true,
    git,
    gh,
    electron,
    packageHost: { linuxX64, playwrightElectron, display, missingTools },
  }
  const available = ['node', 'fs']
  if (git) available.push('git')
  if (gh) available.push('gh')
  if (electron) available.push('electron')
  if (packageHost) available.push('package-host')
  const missingReasons = {}
  if (!checks.node) missingReasons.node = 'Node.js runtime is unavailable.'
  if (!checks.fs) missingReasons.fs = 'Node.js filesystem capability is unavailable.'
  if (!git) missingReasons.git = 'git is unavailable on PATH.'
  if (!gh) missingReasons.gh = 'gh (GitHub CLI) is unavailable on PATH.'
  if (!electron) missingReasons.electron = 'electron controller runtime is unavailable; use package-host for the Node CLI.'
  if (!packageHost) missingReasons['package-host'] = packageHostReason({ linuxX64, playwrightElectron, display, platform, arch, missingTools })
  return Object.freeze({
    schema: 'sartracker-host-capabilities-v1',
    platform,
    arch,
    available: Object.freeze(available),
    missingReasons: Object.freeze(missingReasons),
    checks: Object.freeze({ ...checks, packageHost: Object.freeze(checks.packageHost) }),
    runtimeLaunchVerified: false,
  })
}

/**
 * Convert the static inventory into controller blockers for requested names.
 * Unknown capability names fail closed with the same explicit blocker form.
 *
 * @param {object} definition immutable campaign definition or preflight shape
 * @param {object} options deterministic inspection overrides for tests
 * @returns {string[]} human-readable blockers
 */
export function validateHostCapabilities(definition, options = {}) {
  const required = definition?.preflight?.requiredCapabilities ?? definition?.requiredCapabilities ?? []
  if (!Array.isArray(required)) return ['required host capabilities are invalid.']
  const inventory = inspectHostCapabilities(options)
  return [...new Set(required)].filter((capability) => !inventory.available.includes(capability))
    .map((capability) => inventory.missingReasons[capability] ?? `missing host capability ${capability}`)
}

/** Check executable PATH entries without assuming every tool accepts --version. */
function hasCommand(command) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    try { accessSync(path.join(directory, command), constants.X_OK); return true } catch { /* Try the next PATH entry. */ }
  }
  return false
}

/** Resolve the Playwright dependency used by packaged Electron probes. */
function hasPlaywrightElectron(packageRoot) {
  try {
    require.resolve('playwright', { paths: [packageRoot] })
    return true
  } catch {
    return false
  }
}

/** Check an existing display for direct packaged launch. */
function hasDisplayPrerequisite(environment) {
  if (typeof environment?.DISPLAY === 'string' && environment.DISPLAY.trim() !== '') return true
  return false
}

/** Explain each package-host prerequisite without implying package execution. */
function packageHostReason({ linuxX64, playwrightElectron, display, platform, arch, missingTools }) {
  const missing = []
  if (!linuxX64) missing.push(`Linux x64 host required (found ${platform}/${arch})`)
  if (!playwrightElectron) missing.push('Playwright Electron dependency is unavailable')
  if (!display) missing.push('X11 display prerequisite unavailable (DISPLAY; reviewed probes force X11)')
  if (missingTools.length) missing.push(`required inspection/dialog tools unavailable: ${missingTools.join(', ')}`)
  return `package-host unavailable: ${missing.join('; ')}.`
}

/** Confirm that this process has a usable Node runtime. */
function validNodeRuntime() {
  return typeof process?.versions?.node === 'string' && process.versions.node.length > 0
}

export { KNOWN_CAPABILITIES }
