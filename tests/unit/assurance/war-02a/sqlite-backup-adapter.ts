import { createRequire } from 'node:module'
import type { FaultPlan } from './fault-plan'
import type { createGate } from './virtual-scheduler'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (file: string, options: { readonly: boolean; fileMustExist: boolean }) => {
  backup: (target: string) => Promise<unknown>
  close: () => void
}

/** Real SQLite online backup with explicit native-call failures and completion delivery. */
export function createSqliteBackupAdapter(plan: () => FaultPlan, completion?: ReturnType<typeof createGate<void>>) {
  return {
    /** Runs native backup locally; this adapter does not claim worker-thread isolation proof. */
    async run(input: { sourcePath: string; targetPath: string }): Promise<{ workerThreadId: number }> {
      const database = new Database(input.sourcePath, { readonly: true, fileMustExist: true })
      try {
        await plan().run('sqlite.backup', () => database.backup(input.targetPath))
      } finally { database.close() }
      if (completion) await completion.wait()
      return { workerThreadId: 1 }
    },
  }
}
