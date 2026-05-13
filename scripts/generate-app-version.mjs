import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptFile = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptFile)
const projectRoot = path.resolve(scriptDir, '..')
const packageJsonPath = path.resolve(projectRoot, 'package.json')
const generatedFilePath = path.resolve(projectRoot, 'src/lib/version.generated.ts')

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const baseVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'

const runNumber = process.env.GITHUB_RUN_NUMBER ?? process.env.GITHUB_RUN_ID
const envSha = process.env.GITHUB_SHA
const gitSha = safeGitCommand('git rev-parse --short=12 HEAD')
const buildId = runNumber
  ? `run.${runNumber}.sha.${safeString(envSha, gitSha)}`
  : `sha.${safeString(envSha, gitSha)}`

const generated = [
  `export const APP_VERSION_BASE = ${JSON.stringify(baseVersion)}`,
  `export const APP_VERSION_BUILD_ID = ${JSON.stringify(buildId || 'local')}`,
  '',
].join('\n')

const generatedDir = path.dirname(generatedFilePath)
if (!existsSync(generatedDir)) {
  mkdirSync(generatedDir, { recursive: true })
}

writeFileSync(generatedFilePath, `${generated}\n`, 'utf8')

function safeGitCommand(command) {
  try {
    return execSync(command, { cwd: projectRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function safeString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim()
    if (normalized.length > 0) {
      return normalized
    }
  }

  return 'local'
}
