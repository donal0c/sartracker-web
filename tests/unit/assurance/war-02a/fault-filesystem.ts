import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { FaultPlan } from './fault-plan'

/** Wraps real disposable files; errors are application-call injection, not a disk emulator. */
export function createFaultFileSystem(root: string, source: FaultPlan | (() => FaultPlan)) {
  const plan = () => typeof source === 'function' ? source() : source
  /** Lexically constrains wrapped paths; this trusted fixture helper is not a symlink sandbox. */
  const checked = (file: string): string => {
    const resolved = path.resolve(file)
    const relative = path.relative(path.resolve(root), resolved)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Fault filesystem path escaped fixture root')
    }
    return resolved
  }
  return {
    ...fs,
    /** Wraps handle writes and syncs while binding other native methods to their handle. */
    async open(file: string, flags: string, mode?: number) {
      let opened: Awaited<ReturnType<typeof fs.open>> | undefined
      let handle: Awaited<ReturnType<typeof fs.open>>
      try {
        handle = await plan().run('file.open', async () => {
          opened = await fs.open(checked(file), flags, mode)
          return opened
        })
      } catch (error) {
        // An after-open injection withholds ownership from the caller.
        // Close that acquired handle before propagating the injection.
        await opened?.close()
        throw error
      }
      const directory = (await handle.stat()).isDirectory()
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'writeFile') return (...args: Parameters<typeof handle.writeFile>) =>
            plan().run('file.write', () => target.writeFile(...args))
          if (property === 'write') return (...args: unknown[]) =>
            plan().run('file.write', () => Reflect.apply(target.write, target, args))
          if (property === 'sync') return () =>
            plan().run(directory ? 'directory.sync' : 'file.sync', () => target.sync())
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
    /** Atomically renames through an observable before/after boundary. */
    rename(from: string, to: string) {
      return plan().run('file.rename', () => fs.rename(checked(from), checked(to)))
    },
    /** Exposes cleanup failures separately from publication failures. */
    rm(file: string, options?: Parameters<typeof fs.rm>[1]) {
      return plan().run('file.remove', () => fs.rm(checked(file), options))
    },
  }
}
