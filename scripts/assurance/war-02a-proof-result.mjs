/** Validates the structured result of one selected historical safety control. */
export function validateProofReport(report, { name, oracle, disabled }) {
  if (!report || report.war02a?.unhandledErrorCount !== 0 || report.war02a?.suiteErrorCount !== 0
    || report.war02a?.reason !== (disabled ? 'failed' : 'passed')
    || !Array.isArray(report.testResults) || report.testResults.length !== 1) return false
  const suite = report.testResults[0]
  if (!suite || suite.message !== '' || !Array.isArray(suite.assertionResults)) return false
  const assertions = suite.assertionResults
  if (assertions.some((assertion) => !assertion || !['skipped', 'passed', 'failed'].includes(assertion.status))) return false
  const executed = assertions.filter((assertion) => assertion.status !== 'skipped')
  if (executed.length !== 1 || executed[0].title !== name || !Array.isArray(executed[0].failureMessages)) return false
  const assertion = executed[0]
  return disabled
    ? report.success === false && report.numFailedTests === 1 && report.numPassedTests === 0
      && assertion.status === 'failed' && assertion.failureMessages.length === 1
      && typeof assertion.failureMessages[0] === 'string'
      && assertion.failureMessages[0].startsWith(`AssertionError: ${oracle}:`)
    : report.success === true && report.numPassedTests === 1 && report.numFailedTests === 0
      && assertion.status === 'passed' && assertion.failureMessages.length === 0
}
/** Separates child scheduling/launch failures from completed safety assertions. */
export function assertProofProcessCompleted(result, label) {
  if (result.error || result.signal !== null || result.status === null) {
    const reason = result.error ? `${result.error.code ?? 'spawn error'}: ${result.error.message}`
      : result.signal ?? 'missing exit status'
    throw new Error(`WAR-02A ${label}: infrastructure failure; no safety proof was obtained (${reason})`)
  }
}
