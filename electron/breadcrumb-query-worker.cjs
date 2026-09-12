const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const { listBreadcrumbPositions } = require('./breadcrumb-query.cjs')
const { encodeBreadcrumbFrames } = require('./breadcrumb-query-transport.cjs')

if (parentPort === null) {
  throw new Error('Breadcrumb query worker requires a parent message port.')
}

/** Reads one immutable selector snapshot, then serves at most one frame per pull. */
function run() {
  let database
  let streaming = false
  try {
    database = new Database(workerData.databasePath, {
      readonly: true,
      fileMustExist: true,
    })
    database.pragma('query_only = ON')
    const result = listBreadcrumbPositions(
      database,
      workerData.missionId,
      workerData.perDeviceLimit,
    )
    if (workerData.transport === 'frames-v1') {
      database.close()
      database = undefined
      const frames = encodeBreadcrumbFrames(result)
      let sequence = 0
      let terminal = false
      streaming = true
      parentPort.on('message', (message) => {
        try {
          if (message?.type === 'read' && !terminal && message.sequence === sequence) {
            const frame = frames.next().value
            terminal = frame.done
            parentPort.postMessage({ type: 'frame', sequence: sequence++, ...frame })
          } else if (message?.type === 'finish' && terminal) {
            parentPort.postMessage({ type: 'finished' })
            parentPort.close()
          } else {
            throw new Error('Breadcrumb query received invalid receiver progress.')
          }
        } catch (error) {
          parentPort.postMessage({ type: 'error', name: error.name, message: error.message })
          parentPort.close()
        }
      })
      parentPort.postMessage({ type: 'ready', workerThreadId: threadId, manifest: {
        version: 1, positionCount: result.positions.length,
        deviceTotalCount: result.deviceTotals.length,
        deviceSelectionCount: result.deviceSelections.length,
        droppedPositionCount: result.droppedPositionCount,
      } })
      return
    }
    throw new Error('Breadcrumb query requires the bounded frame protocol.')
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    database?.close()
    if (!streaming) parentPort.close()
  }
}

run()
