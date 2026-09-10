import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { compileFunction } from 'node:vm'

/** Evaluates exact checkout code with local dependency overrides and no global/cache mutation. */
export function loadIsolatedCommonJs<T>(
  file: string,
  dependencies: Readonly<Record<string, unknown>> = {},
  mutation?: { from: string; to: string },
): T {
  let source = readFileSync(file, 'utf8')
  if (mutation) {
    if (!mutation.from || source.split(mutation.from).length !== 2) {
      throw new Error('Negative control must match exactly one source anchor')
    }
    const index = source.indexOf(mutation.from)
    source = source.slice(0, index) + mutation.to + source.slice(index + mutation.from.length)
  }
  const realRequire = createRequire(file)
  const localRequire = (name: string): unknown =>
    Object.hasOwn(dependencies, name) ? dependencies[name] : realRequire(name)
  const module: { exports: unknown } = { exports: {} }
  const execute = compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: file })
  execute(module.exports, localRequire, module, file, path.dirname(file))
  return module.exports as T
}
