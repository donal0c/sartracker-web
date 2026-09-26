import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const originalPath = 'tests/e2e/ui-feedback-batch.spec.ts'
const siblingPath = 'tests/e2e/ui-feedback-batch.navigation-diagnostic.spec.ts'
const original = readFileSync(originalPath, 'utf8')
const originalHash = createHash('sha256').update(original).digest('hex')
if (originalHash !== 'e9ca264616a7bdf806b2647f77fcda751c3ecf7cc30d233b20667bccf7fdd1d5') {
  throw new Error('Unexpected original roster test hash; diagnostic admission refused')
}
const observer = readFileSync(new URL('./observer.ts', import.meta.url), 'utf8')
// The original file is an exact suffix; hooks observe its normal setup too.
const instrumented = `${observer}\n${original}`
writeFileSync(siblingPath, instrumented, { flag: 'wx' })
writeFileSync('tmp/pr54-ci-navigation/playwright.config.ts', readFileSync(new URL('./playwright.config.ts', import.meta.url)), { flag: 'wx' })
writeFileSync('tmp/pr54-ci-navigation/raw-protocol-observer.cjs', readFileSync(new URL('./raw-protocol-observer.cjs', import.meta.url)), { flag: 'wx' })
writeFileSync('tmp/pr54-ci-navigation/evidence/test-binding.json', JSON.stringify({
  originalPath, originalHash, siblingPath,
  instrumentedHash: createHash('sha256').update(instrumented).digest('hex'),
  originalSuffixUnchanged: instrumented.slice(-original.length) === original,
  observerPath: fileURLToPath(new URL('./observer.ts', import.meta.url)),
  observerHash: createHash('sha256').update(observer).digest('hex'),
  qualification: false,
}, null, 2))
