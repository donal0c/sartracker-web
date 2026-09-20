import path from 'node:path'

/** Build an owned single-project browser run with every final frame retained and no retries/server reuse. */
export function qualificationBrowserConfig(base, repositoryRoot, outputDirectory) {
  const chromium = base.projects?.find((project) => project.name === 'chromium')
  if (!chromium) throw new Error('Reviewed chromium project is required.')
  if (!base.webServer || Array.isArray(base.webServer)) throw new Error('One reviewed local browser server is required.')
  return { ...base, testDir: path.join(repositoryRoot, 'tests/e2e'), outputDir: outputDirectory,
    retries: 0, workers: 1,
    use: { ...base.use, screenshot: 'on', trace: 'off' },
    projects: [{ ...chromium, retries: 0, use: { ...chromium.use, screenshot: 'on', trace: 'off' } }],
    webServer: { ...base.webServer, cwd: repositoryRoot, reuseExistingServer: false },
  }
}
