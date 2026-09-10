import { JsonReporter } from 'vitest/reporters'

/** Counts collection/suite/hook errors excluded from individual assertion results. */
function suiteErrorCount(task) {
  if (task.type !== 'suite') return 0
  return (task.result?.errors?.length ?? 0) + task.tasks.reduce((count, child) => count + suiteErrorCount(child), 0)
}

/** Adds explicit run-level error evidence omitted by the standard JSON reporter. */
export default class War02aReporter extends JsonReporter {
  /** Captures all error channels before the base reporter serializes assertions. */
  async onTestRunEnd(testModules, unhandledErrors, reason) {
    this.war02a = {
      unhandledErrorCount: unhandledErrors.length,
      suiteErrorCount: testModules.reduce((count, module) => count + suiteErrorCount(module.task), 0),
      reason,
    }
    await super.onTestRunEnd(testModules)
  }

  /** Emits one structured report; absence of this extension fails the proof gate. */
  async writeReport(report) {
    await super.writeReport(JSON.stringify({ ...JSON.parse(report), war02a: this.war02a }))
  }
}
