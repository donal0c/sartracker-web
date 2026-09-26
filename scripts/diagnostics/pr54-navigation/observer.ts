// Prepended to the unchanged original test file by prepare.mjs. No test body changes.
import { test as navigationTest } from '@playwright/test'
const navigationEvents: unknown[] = []
const navigationPending = new Map<unknown, { url: string; resourceType: string }>()

navigationTest.beforeEach(async ({ page }, info) => {
  navigationEvents.length = 0
  navigationPending.clear()
  if (!info.title.includes('a rejected admin roster')) return
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

navigationTest.afterEach(async ({ page }, info) => {
  if (!info.title.includes('a rejected admin roster')) return
  navigationEvents.push({ at: Date.now(), type: 'testEnd', status: info.status,
    url: page.url(), pendingRequests: [...navigationPending.values()] })
  await info.attach('navigation-events', { body: JSON.stringify(navigationEvents, null, 2), contentType: 'application/json' })
})
