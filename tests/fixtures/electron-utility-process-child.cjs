'use strict'

const { EventEmitter } = require('node:events')
const path = require('node:path')

const modulePath = process.argv[2]
if (typeof process.send !== 'function' || typeof modulePath !== 'string'
  || !path.isAbsolute(modulePath)) {
  throw new Error('Electron utility-process fixture requires IPC and an absolute module path.')
}

const port = new EventEmitter()
const removePortListener = port.removeListener.bind(port)
let pendingMessages = 0
let closeRequested = false

/** Disconnects only after the final emulated ParentPort message has flushed. */
function finishIfReady() {
  if (!closeRequested || pendingMessages !== 0 || !process.connected) return
  process.removeAllListeners('message')
  process.disconnect()
}

port.postMessage = (message) => {
  pendingMessages += 1
  process.send(message, (error) => {
    pendingMessages -= 1
    if (error) process.exitCode = 1
    finishIfReady()
  })
}

process.on('message', (message) => {
  port.emit('message', { data: message })
})
port.removeListener = (eventName, listener) => {
  removePortListener(eventName, listener)
  if (eventName === 'message' && port.listenerCount('message') === 0) {
    closeRequested = true
    finishIfReady()
  }
  return port
}

Object.defineProperty(process, 'parentPort', {
  configurable: true,
  value: port,
})

require(modulePath)
