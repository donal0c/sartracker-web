import {
  C17_ADVERSARIAL_CASE_IDS,
  C17_ADVERSARIAL_CONTROL_PREFIX,
  C17_ADVERSARIAL_SOURCE_TEST_NAME,
  C17_LONG_SECRET_KEY,
  C17_NUMERIC_SECRET,
} from '../../scripts/qualification/c17-adversarial-corpus.mjs'

export {
  C17_ADVERSARIAL_CASE_IDS,
  C17_ADVERSARIAL_CONTROL_PREFIX,
  C17_ADVERSARIAL_SOURCE_TEST_NAME,
} from '../../scripts/qualification/c17-adversarial-corpus.mjs'

export const C17_ADVERSARIAL_RENDERER_LIMIT_BYTES = 32 * 1024
export const C17_ADVERSARIAL_OUTPUT_LIMIT_BYTES = 1_048_576
export const C17_STRUCTURED_LIMIT_MARKER = '[redacted-structured-value-too-large]'
export const C17_UNSUPPORTED_MARKER = '[redacted-unsupported-value]'

/** Build the deterministic hostile values used by both C17 source sanitizer tests. */
export function createC17AdversarialCorpus() {
  const secret = 'C17-Source-Corpus-Secret-9!'
  const longKeySecret = 'C17-Source-Long-Key-Secret-7!'
  const privateProfilePath = '/Users/c17-operator/private-profile/mission-store.sqlite'
  const hookCalls = { getter: 0, toJSONGetter: 0, toJSON: 0 }

  const hostileHooks = Object.create(null)
  Object.defineProperties(hostileHooks, {
    publicEcho: {
      enumerable: true,
      get() {
        hookCalls.getter += 1
        return secret
      },
    },
    toJSON: {
      enumerable: true,
      get() {
        hookCalls.toJSONGetter += 1
        return () => {
          hookCalls.toJSON += 1
          return { token: secret, profilePath: privateProfilePath }
        }
      },
    },
  })

  const cyclic = { token: secret }
  cyclic.self = cyclic

  let deeplyNested = { token: secret }
  for (let depth = 0; depth < 16; depth += 1) {
    deeplyNested = { child: deeplyNested }
  }

  return {
    fields: {
      ...Object.fromEntries(C17_ADVERSARIAL_CASE_IDS.map((id, index) => [
        `c17Control_${index}`,
        `${C17_ADVERSARIAL_CONTROL_PREFIX}${id}`,
      ])),
      password: secret,
      nested: { values: [secret, privateProfilePath] },
      encoded: JSON.stringify({ credential: secret, values: [secret, privateProfilePath] }),
      recoveryCode: C17_NUMERIC_SECRET,
      numericCopies: [C17_NUMERIC_SECRET],
      numericTypedArray: new Uint32Array([C17_NUMERIC_SECRET]),
      longSecretFields: {
        [C17_LONG_SECRET_KEY]: longKeySecret,
        echo: longKeySecret,
      },
      hostileHooks,
      cyclic,
      oversizedContainer: Array.from({ length: 513 }, () => secret),
      oversizedText: `credential=${secret}\n${'x'.repeat(40_000)}`,
      deeplyNested,
    },
    forbiddenValues: [secret, longKeySecret, privateProfilePath, String(C17_NUMERIC_SECRET)],
    hookCalls,
  }
}
