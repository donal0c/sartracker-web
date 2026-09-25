/**
 * Close C12's application without waiting for an external viewer's inherited
 * output pipes. Only release the probe's read ends after the application has
 * physically exited. The outer owned-process supervisor still has to terminate
 * and positively verify cleanup of every descendant before accepting the run.
 */
export async function closeMarkerAttachmentApplication(app) {
  const child = app.process()
  const releaseExitedOutput = () => {
    if (child.exitCode === null && child.signalCode === null) return
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
  child.once('exit', releaseExitedOutput)
  try {
    releaseExitedOutput()
    await app.close()
    if (child.exitCode !== 0 || child.signalCode !== null) {
      throw new Error(`C12 application did not exit cleanly: exit=${child.exitCode}, signal=${child.signalCode}.`)
    }
  } finally {
    // A close error remains fatal. If the app exits later, still release its
    // pipes; this once-listener cannot turn that error into passing evidence.
    if (child.exitCode !== null || child.signalCode !== null) child.off('exit', releaseExitedOutput)
  }
}
