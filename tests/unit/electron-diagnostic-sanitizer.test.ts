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

  it('redacts sensitive values repeated inside nested arrays [DON-237]', () => {
    const secret = 'C17-Main-Nested-Array-Secret-9!'
    const sanitized = sanitizeDiagnosticFields({
      token: secret,
      nested: { values: [secret] },
    })

    const serialized = JSON.stringify(sanitized)
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[redacted]')
  })

  it('fails visibly and bounds oversized and over-element structured values [DON-237]', () => {
    const secret = 'C17-Oversized-Main-Secret-9!'
    const oversized = JSON.stringify({ token: secret, padding: 'x'.repeat(40_000) })
    const tooManyElements = { values: Array.from({ length: 513 }, () => secret) }
    const oversizedPlainText = 'x'.repeat(40_000)

    const sanitized = sanitizeDiagnosticFields({ oversized, tooManyElements, oversizedPlainText })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[redacted-structured-value-too-large]')
  })

  it('redacts credentials in generic diagnostic URL query text [DON-237]', () => {
    const secret = 'C17-Query-Credential-9!'
    const authSecret = 'C17-Auth-Credential-9!'
    const compoundSecret = 'C17-Compound-Credential-9!'
    const sanitized = sanitizeDiagnosticText(
      [
        `https://host.example/api?session=${secret}&access_token=${compoundSecret}`,
        `https://host.example/api?auth=${authSecret}`,
        `auth=${authSecret} auth: ${authSecret} authToken=${compoundSecret}`,
        `{"apiKey":"${compoundSecret}"}`,
      ].join('\n'),
    )

    expect(sanitized).not.toContain(secret)
    expect(sanitized).not.toContain(authSecret)
    expect(sanitized).not.toContain(compoundSecret)
    expect(sanitized).toContain('?session=[redacted]')
    expect(sanitized).toContain('?auth=[redacted]')
    expect(sanitized).toContain('&access_token=[redacted]')
  })

  it('redacts private temporary and system paths from legacy diagnostic text [DON-237]', () => {
    const sanitized = sanitizeDiagnosticText(
      [
        'database: /private/var/folders/operator-private/mission.sqlite',
        'cache: /tmp/sartracker/operator-private/runtime.log',
        'system: /var/lib/sartracker/operator-private/state.db',
      ].join('\n'),
    )

    expect(sanitized).not.toContain('/private/var/folders/operator-private')
    expect(sanitized).not.toContain('/tmp/sartracker/operator-private')
    expect(sanitized).not.toContain('/var/lib/sartracker/operator-private')
    expect(sanitized).toContain('/private/[redacted]')
    expect(sanitized).toContain('/tmp/[redacted]')
    expect(sanitized).toContain('/var/[redacted]')
  })
})
