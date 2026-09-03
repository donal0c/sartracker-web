'use strict'

const { parentPort, workerData } = require('node:worker_threads')

parentPort.postMessage({
  type: 'error',
  operationId: workerData?.request?.operationId,
  code: 'ARCHIVE_CLEANUP_FAILED',
  diagnostic: {
    substage: 'delete_page',
    causeClass: 'sqlite_busy',
    tableName: 'positions',
    path: '/private/mission.sqlite',
    message: 'secret contents must not cross the worker boundary',
    cursor: {
      tableIndex: 1,
      tableCount: 4,
      tableBatch: 2,
      deletedRows: 6,
      totalDeletedRows: 6,
    },
    workerExit: { observed: true, event: 'message', code: 0 },
  },
})
parentPort.close()
