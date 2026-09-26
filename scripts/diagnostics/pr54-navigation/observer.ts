// Prepended to the unchanged original test file by prepare.mjs. No test body changes.
import { test as navigationTest } from '@playwright/test'
import { writeFile as writeNavigationEvidence } from 'node:fs/promises'
const navigationEvents: unknown[] = []
const navigationPending = new Map<unknown, { url: string; resourceType: string }>()

navigationTest.beforeEach(async ({ page, context }, info) => {
  navigationEvents.length = 0
  navigationPending.clear()
  if (!info.title.includes('a rejected admin roster')) return
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const record = (type: string, data: unknown) => {
    if (navigationEvents.length < 5000) navigationEvents.push({ at: Date.now(), type, data })
  }
  // Observe initial navigation, normal setup, test body and final cleanup.
  record('observerAttached', { url: page.url() })
  page.on('framenavigated', frame => record('frame', { main: frame === page.mainFrame(), url: frame.url() }))
  page.on('console', message => record('console', { type: message.type(), text: message.text() }))
  page.on('pageerror', error => record('pageerror', error.message))
  page.on('close', () => record('pageClosed', {}))
  page.on('crash', () => record('pageCrashed', {}))
  page.on('request', request => {
    const entry = { url: request.url(), resourceType: request.resourceType() }
    navigationPending.set(request, entry)
    record('requestStarted', entry)
  })
  page.on('requestfinished', request => {
    record('requestFinished', navigationPending.get(request))
    navigationPending.delete(request)
  })
  page.on('requestfailed', request => {
    record('requestFailed', { url: request.url(), error: request.failure() })
    navigationPending.delete(request)
  })
  page.on('websocket', socket => {
    socket.on('framereceived', event => record('websocket', event.payload.toString()))
    socket.on('close', () => record('websocketClosed', socket.url()))
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Page.enable')
  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true })
  cdp.on('Runtime.executionContextsCleared', event => record('executionContextsCleared', event))
  cdp.on('Runtime.executionContextDestroyed', event => record('executionContextDestroyed', event))
  cdp.on('Page.lifecycleEvent', event => record('lifecycle', event))
  cdp.on('Page.frameRequestedNavigation', event => record('requestedNavigation', event))
  cdp.on('Page.frameScheduledNavigation', event => record('scheduledNavigation', event))
  cdp.on('Network.webSocketFrameReceived', event => record('cdpWebsocket', event))
  cdp.on('Network.requestWillBeSent', event => {
    if (event.type === 'Document' || event.type === 'Script') record('cdpRequest', {
      url: event.request.url, type: event.type, initiator: event.initiator,
    })
  })
})

navigationTest.afterEach(async ({ page, context }, info) => {
  if (!info.title.includes('a rejected admin roster')) return
  navigationEvents.push({ at: Date.now(), type: 'testEnd', status: info.status,
    url: page.url(), pendingRequests: [...navigationPending.values()] })
  const eventsPath = info.outputPath('navigation-events.json')
  await writeNavigationEvidence(eventsPath, JSON.stringify(navigationEvents, null, 2))
  await info.attach('navigation-events', { path: eventsPath, contentType: 'application/json' })
  try {
    const screenshotPath = info.outputPath('test-finished.png')
    await page.screenshot({ path: screenshotPath })
    await info.attach('navigation-screenshot', { path: screenshotPath, contentType: 'image/png' })
  } finally {
    const tracePath = info.outputPath('navigation-trace.zip')
    await context.tracing.stop({ path: tracePath })
    await info.attach('navigation-trace', { path: tracePath, contentType: 'application/zip' })
  }
})
