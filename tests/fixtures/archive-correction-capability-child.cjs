'use strict'

const {
  captureCorrectionDirectoryIdentity,
  createCorrectionAttachmentPair,
} = require('../../electron/archive-correction-directory-capability.cjs')

if (typeof process.send !== 'function') {
  throw new Error('Correction capability fixture requires a test IPC parent.')
}

process.send({
  type: 'ready',
  identity: captureCorrectionDirectoryIdentity('.'),
})

process.once('message', async (message) => {
  try {
    const result = await createCorrectionAttachmentPair(message)
    process.send({ type: 'complete', result })
    process.exitCode = 0
  } catch (error) {
    process.send({ type: 'error', message: error instanceof Error ? error.message : 'failed' })
    process.exitCode = 1
  }
})
