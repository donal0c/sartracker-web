const { app } = require('electron')
const { writeFileSync } = require('node:fs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const receipt = { fetches: [], errors: [] }
const persist = () => writeFileSync(process.env.SAR_OBSERVER_CONTROL_RECEIPT, JSON.stringify(receipt, null, 2))
const deadline = setTimeout(() => { receipt.errors.push('control deadline'); persist(); app.exit(2) }, 12000)
app.whenReady().then(async () => {
  receipt.readyAtUnixMs = Date.now()
  await delay(700)
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(process.env.SAR_OBSERVER_CONTROL_URL)
    receipt.fetches.push({ status: response.status, body: await response.text() })
    await delay(400)
  }
  const probeDeadline = Date.now() + 5000
  while (!globalThis.__SARTRACKER_MAIN_LOOP_COMPANION__ && Date.now() < probeDeadline) await delay(50)
  receipt.timerInstalled = Boolean(globalThis.__SARTRACKER_MAIN_LOOP_COMPANION__)
  const start = performance.now()
  while (performance.now() - start < 350) {}
  await delay(1300)
  const final = await fetch(process.env.SAR_OBSERVER_CONTROL_URL)
  receipt.fetches.push({ status: final.status, body: await final.text() })
  persist()
  clearTimeout(deadline)
  app.quit()
}).catch((error) => {
  receipt.errors.push(String(error.stack ?? error))
  persist(); clearTimeout(deadline); app.exit(1)
})
