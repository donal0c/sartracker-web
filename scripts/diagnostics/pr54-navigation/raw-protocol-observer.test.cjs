const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.dirname(require.resolve('playwright-core/package.json'))
const { CRSession } = require(path.join(root, 'lib/server/chromium/crConnection.js'))
const { ProtocolError } = require(path.join(root, 'lib/server/protocolError.js'))
const { installRawProtocolObserver, sanitizeProtocolMessage } = require('./raw-protocol-observer.cjs')

test('raw rejection is observed before rewriting while original error identity survives', () => {
  const original = CRSession.prototype._onMessage
  const records = []
  const observer = installRawProtocolObserver(CRSession.prototype, record => records.push(record))
  const error = new ProtocolError('error', 'Runtime.callFunctionOn')
  let rejected
  const session = { _sessionId: 'synthetic', _callbacks: new Map([[42, { error, reject: value => { rejected = value } }]]) }
  try {
    CRSession.prototype._onMessage.call(session, { id: 42, error: { code: -32000, message: 'Promise was collected' } })
    assert.equal(rejected, error)
    assert.equal(error.message, 'Protocol error (Runtime.callFunctionOn): Promise was collected')
    assert.equal(session._callbacks.size, 0)
    assert.deepEqual(records, [{ method: 'Runtime.callFunctionOn', code: -32000, message: 'Promise was collected' }])
    assert.deepEqual(observer.observerErrors, [])
  } finally { observer.restore() }
  assert.equal(CRSession.prototype._onMessage, original)
})

test('only exact safe protocol wording is retained; unknown unquoted content is redacted', () => {
  assert.equal(sanitizeProtocolMessage('Promise was collected'), 'Promise was collected')
  assert.equal(sanitizeProtocolMessage('Cannot find context with specified id'), 'Cannot find context with specified id')
  for (const message of ['unquoted_secret_sentinel', 'password=two words',
    'Error "private value" https://example.test/?token=private Bearer private token=private',
    'Promise was collected unquoted_secret_sentinel', 'x'.repeat(900)]) {
    assert.equal(sanitizeProtocolMessage(message), '[unrecognized protocol message redacted]')
  }
})

test('successful response retains exact result identity without an error record', () => {
  const records = []
  const observer = installRawProtocolObserver(CRSession.prototype, record => records.push(record))
  const result = { value: 123 }
  let resolved
  const session = { _callbacks: new Map([[7, { resolve: value => { resolved = value } }]]) }
  try {
    CRSession.prototype._onMessage.call(session, { id: 7, result })
    assert.equal(resolved, result)
    assert.equal(session._callbacks.size, 0)
    assert.deepEqual(records, [])
  } finally { observer.restore() }
})

test('observer failure does not swallow or replace the original protocol rejection', () => {
  const observer = installRawProtocolObserver(CRSession.prototype, () => { throw new Error('unquoted_secret_sentinel') })
  const error = new ProtocolError('error', 'Runtime.callFunctionOn')
  let rejected
  const session = { _callbacks: new Map([[1, { error, reject: value => { rejected = value } }]]) }
  try {
    CRSession.prototype._onMessage.call(session, { id: 1, error: { code: -32000, message: 'Cannot find context' } })
    assert.equal(rejected, error)
    assert.equal(error.message, 'Protocol error (Runtime.callFunctionOn): Cannot find context')
    assert.deepEqual(observer.observerErrors, ['diagnostic recorder failed'])
    assert.equal(JSON.stringify(observer.observerErrors).includes('unquoted_secret_sentinel'), false)
  } finally { observer.restore() }
})
