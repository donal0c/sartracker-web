'use strict'

const { createRuntimeLog } = require('./runtime-log.cjs')
const { createCrashLog } = require('./crash-log.cjs')

const parentPort = process.parentPort
if (parentPort === null || parentPort === undefined) {
  throw new Error('Startup evidence worker requires an Electron utility-process parent port.')
}

let runtimeLog = null
let crashLog = null
const activeOperations = new Set()

parentPort.on('message', (event) => {
  const message = event?.data
  if (message?.type === 'initialize') {
    initialize(message)
    return
  }
  if (message?.type === 'shutdown') {
    void shutdown(message)
    return
  }
  const operation = dispatch(message)
  activeOperations.add(operation)
  void operation.finally(() => activeOperations.delete(operation))
})

/** Creates the two serialized on-disk evidence adapters in this helper process. */
function initialize(message) {
  if (runtimeLog !== null || typeof message.userDataPath !== 'string') {
    respondError(message.id, new Error('Startup evidence worker initialization is invalid.'))
    return
  }
  try {
    runtimeLog = createRuntimeLog({ userDataPath: message.userDataPath })
    crashLog = createCrashLog({ userDataPath: message.userDataPath })
    parentPort.postMessage({ id: 0, type: 'ready' })
  } catch (error) {
    respondError(message.id, error)
  }
}

/** Executes one explicitly named runtime-log or crash-log operation. */
async function dispatch(message) {
  try {
    if (runtimeLog === null || crashLog === null || !Number.isSafeInteger(message?.id)) {
      throw new Error('Startup evidence worker is not initialized.')
    }
    let value
    switch (message.type) {
      case 'runtime.append':
        value = await runtimeLog.append(message.input)
        break
      case 'runtime.appendDurable':
        value = await runtimeLog.appendDurable(message.input)
        break
      case 'runtime.readRecent':
        value = await runtimeLog.readRecent(message.input?.limit)
        break
      case 'crash.record':
        value = await crashLog.record(message.input)
        break
      case 'crash.readRecent':
        value = await crashLog.readRecent(message.input?.limit)
        break
      case 'crash.markSessionStart':
        value = await crashLog.markSessionStart()
        break
      case 'crash.markCleanExit':
        value = await crashLog.markCleanExit()
        break
      case 'crash.hadUncleanShutdown':
        value = await crashLog.hadUncleanShutdown()
        break
      default:
        throw new Error('Startup evidence worker received an unknown operation.')
    }
    parentPort.postMessage({ id: message.id, ok: true, value })
  } catch (error) {
    respondError(message?.id, error)
  }
}

/** Drains completed requests before closing the utility process message port. */
async function shutdown(message) {
  await Promise.allSettled(Array.from(activeOperations))
  parentPort.postMessage({ id: message.id, ok: true, value: true })
  parentPort.close()
}

/** Sends one error with only its bounded type, message, and stable code. */
function respondError(id, error) {
  if (!Number.isSafeInteger(id)) return
  parentPort.postMessage({
    id,
    ok: false,
    error: {
      name: typeof error?.name === 'string' ? error.name : 'Error',
      message: typeof error?.message === 'string' ? error.message : 'Startup evidence operation failed.',
      ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    },
  })
}
