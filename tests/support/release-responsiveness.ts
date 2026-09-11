import { inject } from 'vitest'

type ResponsivenessMode = 'correctness' | 'release-qualification'

declare module 'vitest' {
  export interface ProvidedContext {
    releaseResponsivenessMode: ResponsivenessMode
  }
}

/** Refuses an unconfigured lane rather than silently omitting release assertions. */
function requireMode(mode: unknown): ResponsivenessMode {
  if (mode !== 'correctness' && mode !== 'release-qualification') {
    throw new Error('Release responsiveness mode must explicitly be correctness or release-qualification.')
  }
  return mode
}

/** Preserves the exact timing assertion in release runs; correctness is explicitly unqualified. */
export function assertResponsivenessForMode(mode: unknown, assertion: () => void): void {
  if (requireMode(mode) === 'release-qualification') assertion()
}

/** Routes only wall-clock assertions; workload and correctness assertions stay outside the callback. */
export function assertReleaseResponsiveness(assertion: () => void): void {
  assertResponsivenessForMode(inject('releaseResponsivenessMode'), assertion)
}

/** Selects named real-clock probe cases whose implementation enforces its own immutable timing gate. */
export function isReleaseResponsivenessQualification(): boolean {
  return requireMode(inject('releaseResponsivenessMode')) === 'release-qualification'
}
