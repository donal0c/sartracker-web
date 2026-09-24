export const C17_ADVERSARIAL_CASE_IDS = Object.freeze([
  'nested-arrays',
  'numeric-secret',
  'long-secret-key',
  'hostile-getter',
  'hostile-to-json',
  'cyclic-object',
  'typed-array',
  'oversized-container',
  'oversized-text',
  'depth-budget',
])

export const C17_ADVERSARIAL_CONTROL_PREFIX = 'C17-CORPUS:'
export const C17_ADVERSARIAL_SOURCE_TEST_NAME = 'sanitizes the fixed C17 adversarial corpus in both source boundaries [DON-254]'
export const C17_OUTPUT_SCAN_SOURCE_TEST_NAME = 'bounds C17 output reads and proves byte identity [DON-254]'
export const C17_NUMERIC_SECRET = 918273645
export const C17_LONG_SECRET_KEY = `recovery-code-${'x'.repeat(96)}`
export const C17_LONG_SECRET_SUFFIX = 'long-key-secret'

/** Identifiers retained by the C17 source-mode sanitizer corpus. */
export const C17_SOURCE_CORPUS_TESTS = Object.freeze([
  Object.freeze({
    path: 'tests/unit/qualification-c17-adversarial-corpus.test.ts',
    name: C17_ADVERSARIAL_SOURCE_TEST_NAME,
  }),
  Object.freeze({
    path: 'tests/unit/qualification-c17-output-scan.test.ts',
    name: C17_OUTPUT_SCAN_SOURCE_TEST_NAME,
  }),
])
