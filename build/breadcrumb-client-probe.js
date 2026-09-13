import { readFile } from 'node:fs/promises'
import ts from 'typescript'

/** Loads the production mainworld client for direct-call packaged probes without a second decoder. */
export async function breadcrumbClientProbeScript() {
  const source = await readFile('src/infrastructure/mission-store/breadcrumb-query-client.ts', 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  return `(() => { const exports = {}; ${compiled}\n globalThis.__createTransportClient = exports.createBreadcrumbQueryClient; })()`
}
