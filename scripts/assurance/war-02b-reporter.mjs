import { JsonReporter } from 'vitest/node'

/** Counts collection, hook, and suite errors that individual assertions do not expose. */
function suiteErrorCount(task) {
  if (task.type !== 'suite') return 0
  return (task.result?.errors?.length ?? 0) + task.tasks.reduce(
    (count, child) => count + suiteErrorCount(child),
    0,
  )
}

/** Adds explicit run-level error evidence to the standard Vitest JSON receipt. */
export default class War02bReporter extends JsonReporter {
  /** Captures every non-assertion error channel before serialization. */
  async onTestRunEnd(testModules, unhandledErrors, reason) {
    this.war02b = {
      unhandledErrorCount: unhandledErrors.length,
      suiteErrorCount: testModules.reduce(
        (count, module) => count + suiteErrorCount(module.task),
        0,
      ),
      reason,
    }
    await super.onTestRunEnd(testModules)
  }

  /** Emits one structured report; missing metadata is treated as invalid evidence. */
  async writeReport(report) {
    await super.writeReport(JSON.stringify({ ...JSON.parse(report), war02b: this.war02b }))
  }
}
