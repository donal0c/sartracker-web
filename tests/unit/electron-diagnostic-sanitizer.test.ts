import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { sanitizeDiagnosticFields, sanitizeDiagnosticText } = require(
  '../../electron/diagnostic-sanitizer.cjs',
) as {
  readonly sanitizeDiagnosticFields: (
    fields: Record<string, unknown>,
  ) => Record<string, unknown>
  readonly sanitizeDiagnosticText: (input: unknown) => string
}

const PASSPHRASE_SENTINEL = 'Archive-Passphrase-Sentinel-9!'
const RECOVERY_CODE_SENTINEL = 'ARCH-RECOVERY-SENTINEL-7Z'

describe('electron diagnostic sanitizer', () => {
  it('redacts archive custody secrets across common free-form key variants [DON-248]', () => {
    const sanitized = sanitizeDiagnosticText(
      [
        `passphrase=${PASSPHRASE_SENTINEL}`,
        `PassPhrase: ${PASSPHRASE_SENTINEL}`,
        `pass_phrase=${PASSPHRASE_SENTINEL}`,
        `pass-phrase: ${PASSPHRASE_SENTINEL}`,
        `recoveryCode=${RECOVERY_CODE_SENTINEL}`,
        `RecoveryCode: ${RECOVERY_CODE_SENTINEL}`,
        `recovery_code=${RECOVERY_CODE_SENTINEL}`,
        `recovery-code: ${RECOVERY_CODE_SENTINEL}`,
      ].join('\n'),
    )

    expect(sanitized).not.toContain(PASSPHRASE_SENTINEL)
    expect(sanitized).not.toContain(RECOVERY_CODE_SENTINEL)
    expect(sanitized.match(/\[redacted\]/g)).toHaveLength(8)
  })

  it('recursively redacts archive custody fields across common structured key variants [DON-248]', () => {
    const sanitized = sanitizeDiagnosticFields({
      passphrase: PASSPHRASE_SENTINEL,
      PassPhrase: PASSPHRASE_SENTINEL,
      pass_phrase: PASSPHRASE_SENTINEL,
      'pass-phrase': PASSPHRASE_SENTINEL,
      nested: {
        recoveryCode: RECOVERY_CODE_SENTINEL,
        RecoveryCode: RECOVERY_CODE_SENTINEL,
        recovery_code: RECOVERY_CODE_SENTINEL,
        'recovery-code': RECOVERY_CODE_SENTINEL,
      },
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain(PASSPHRASE_SENTINEL)
    expect(serialized).not.toContain(RECOVERY_CODE_SENTINEL)
    expect(serialized.match(/\[redacted\]/g)).toHaveLength(8)
  })
})
