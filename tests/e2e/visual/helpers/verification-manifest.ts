/**
 * Visual verification manifest system.
 *
 * During Playwright tests, each screenshot is registered with a verification prompt
 * that describes what an independent visual reviewer should confirm. After the test
 * suite completes, an Opus subagent reads each screenshot and verifies it against
 * the prompt. The test only passes if both Playwright assertions AND visual
 * verification succeed.
 *
 * This is critical for a life-safety SAR application: we need independent visual
 * confirmation that the operator interface displays the correct information.
 *
 * PARALLEL-SAFE: Each verification entry is written to its own JSON file to avoid
 * race conditions between parallel Playwright workers. The loadAllEntries() function
 * collects them all for the verification step.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

const MANIFEST_DIR = join(
  process.cwd(),
  'test-results',
  'visual-verification',
)

export type VerificationEntry = {
  /** Unique test identifier. */
  testId: string
  /** Human-readable test name. */
  testName: string
  /** Feature area being tested. */
  area: 'app-shell' | 'mission' | 'tracking' | 'markers' | 'drawings' | 'layers' | 'measurements' | 'settings' | 'recovery'
  /** Absolute path to the screenshot file. */
  screenshotPath: string
  /** Detailed verification prompt for the visual reviewer. */
  verificationPrompt: string
  /** Severity: critical means a failure here could affect operator safety. */
  severity: 'critical' | 'high' | 'medium'
  /** Timestamp when the screenshot was taken. */
  capturedAt: string
  /** Playwright-level assertions that already passed. */
  playwrightAssertions: string[]
}

/** Ensure the manifest directory exists. */
function ensureDir(): void {
  if (!existsSync(MANIFEST_DIR)) {
    mkdirSync(MANIFEST_DIR, { recursive: true })
  }
}

/**
 * Write a single verification entry to its own file.
 * Each entry gets `{testId}.entry.json` — safe for parallel workers.
 */
function writeEntry(entry: VerificationEntry): void {
  ensureDir()
  const entryPath = join(MANIFEST_DIR, `${entry.testId}.entry.json`)
  writeFileSync(entryPath, JSON.stringify(entry, null, 2))
}

/**
 * Capture a full-page screenshot and register it for visual verification.
 *
 * @param page - Playwright page
 * @param entry - Verification metadata (without screenshotPath and capturedAt)
 * @returns The path to the saved screenshot
 */
export async function captureAndRegister(
  page: Page,
  entry: Omit<VerificationEntry, 'screenshotPath' | 'capturedAt'>,
): Promise<string> {
  ensureDir()
  const screenshotPath = join(MANIFEST_DIR, `${entry.testId}.png`)

  await page.screenshot({ path: screenshotPath, fullPage: false })

  const fullEntry: VerificationEntry = {
    ...entry,
    screenshotPath,
    capturedAt: new Date().toISOString(),
  }
  writeEntry(fullEntry)

  return screenshotPath
}

/**
 * Capture a screenshot of a specific element and register it for verification.
 */
export async function captureElementAndRegister(
  page: Page,
  testId: string,
  entry: Omit<VerificationEntry, 'screenshotPath' | 'capturedAt'>,
): Promise<string> {
  ensureDir()
  const screenshotPath = join(MANIFEST_DIR, `${entry.testId}.png`)

  const element = page.getByTestId(testId)
  await element.screenshot({ path: screenshotPath })

  const fullEntry: VerificationEntry = {
    ...entry,
    screenshotPath,
    capturedAt: new Date().toISOString(),
  }
  writeEntry(fullEntry)

  return screenshotPath
}

/**
 * Load all verification entries from disk.
 * Reads every `*.entry.json` file in the manifest directory.
 * This is used by the verification step after all tests complete.
 */
export function loadAllEntries(): VerificationEntry[] {
  if (!existsSync(MANIFEST_DIR)) {
    return []
  }

  const files = readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.entry.json'))
  return files
    .map((file) => {
      const content = readFileSync(join(MANIFEST_DIR, file), 'utf-8')
      return JSON.parse(content) as VerificationEntry
    })
    .sort((a, b) => a.testId.localeCompare(b.testId))
}

/** Return the manifest directory path. */
export function getManifestDir(): string {
  return MANIFEST_DIR
}
