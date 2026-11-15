// End-to-end check of the built site: select a field on #/data, run the
// simulation on #/simulation, and assert the results page really shows the
// NASA-driven water budget and all four charts.
//
// No new dependencies: it drives an already-installed Chromium over the
// DevTools Protocol using Node's built-in WebSocket (Node 22+).
//
// Usage (from the repo root, with front/dist copied to the repo root and
// served at /nex-terra/, plus chromium on --remote-debugging-port=9222):
//   node front/scripts/e2e-check.mjs http://127.0.0.1:8131/nex-terra/
//
// Exits 0 only when every assertion below holds.

const BASE = process.argv[2] || 'http://127.0.0.1:8131/nex-terra/'
const DEBUG = process.env.CDP_URL || 'http://127.0.0.1:9222'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function wsUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${DEBUG}/json/list`)
      const tabs = await res.json()
      const page = tabs.find((tab) => tab.type === 'page' && tab.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Chromium is still starting.
    }
    await sleep(500)
  }
  throw new Error(`No DevTools target at ${DEBUG}; start Chromium with --remote-debugging-port=9222`)
}

const ws = new WebSocket(await wsUrl())
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})

let nextId = 1
const pending = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})

function send(method, params = {}) {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve) => pending.set(id, resolve))
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.result?.exceptionDetails) {
    throw new Error(
      `${res.result.exceptionDetails.text} ${res.result.exceptionDetails.exception?.description ?? ''}`,
    )
  }
  return res.result?.result?.value
}

async function goto(hash, waitMs = 4000) {
  await send('Page.navigate', { url: `${BASE}${hash}` })
  await sleep(waitMs)
}

await send('Page.enable')
await send('Runtime.enable')

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// 1. Set a field through the real form.
await goto('#/data', 6000)
const filled = await evaluate(`(() => {
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const labels = [...document.querySelectorAll('label')]
  const find = (text) => labels.find(l => l.textContent.trim().startsWith(text))?.querySelector('input, select')
  const lat = find('Latitude')
  const lon = find('Longitude')
  const area = find('Farm area')
  if (!lat || !lon) return 'no lat/lon inputs'
  setValue(lat, '33.0')
  setValue(lon, '-7.6')
  if (area) setValue(area, '10')
  const irrigation = find('Irrigation')
  if (irrigation) {
    irrigation.value = 'rainfed'
    irrigation.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return 'filled'
})()`)
await sleep(1500)
const confirmed = await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find(b => /Use this farm location/i.test(b.textContent))
  if (!target) return 'confirm button missing'
  if (target.disabled) return 'confirm button disabled'
  target.click()
  return 'clicked'
})()`)
check('field form accepts coordinates', filled === 'filled', filled)
check('farm location accepted', confirmed === 'clicked', confirmed)
await sleep(4000)

// 2. Run the simulation.
await goto('#/simulation', 5000)
const started = await evaluate(`(() => {
  const target = [...document.querySelectorAll('button')].find(b => /Start simulation|Run again/i.test(b.textContent))
  if (!target) return 'start button missing'
  if (target.disabled) return 'start button disabled'
  target.click()
  return 'clicked'
})()`)
check('simulation starts', started === 'clicked', started)
await sleep(12000)

// 3. Assert the results page.
await goto('#/results', 6000)
const report = await evaluate(`(() => {
  const text = document.body.innerText
  const cards = [...document.querySelectorAll('.strategy-water')].map(el => el.innerText)
  return {
    chartTitles: [...document.querySelectorAll('.results-chart h3')].map(h => h.textContent.trim()),
    tableRows: document.querySelectorAll('.comp-table tbody tr').length,
    waterCards: cards.length,
    cardsHaveDeficit: cards.length > 0 && cards.every(card => /Simplified deficit/.test(card)),
    cardsHaveNasaSource: cards.length > 0 && cards.every(card => /NASA POWER|fallback/.test(card)),
    hasNasaDecisionText: /NASA POWER is a decision input/.test(text),
    hasTieNotice: /effectively tied|meaningfully separated/i.test(text),
    hasDeficitExplanation: /The deficit is not an irrigation|deficits are large/i.test(text),
    // Table headers are CSS-uppercased, so compare the header cells case-insensitively.
    headers: [...document.querySelectorAll('.comp-table thead th')].map(th => th.textContent.trim()),
    hasRevenueLabel: [...document.querySelectorAll('.comp-table thead th')]
      .some(th => /illustrative gross revenue/i.test(th.textContent)),
    hasDeficitColumn: [...document.querySelectorAll('.comp-table thead th')]
      .some(th => /deficit vs rainfall/i.test(th.textContent)),
    resilienceValues: [...document.querySelectorAll('.comp-table tbody tr')]
      .map(tr => tr.children[6]?.textContent.trim()),
    hasError: /could not be completed|Something went wrong/i.test(text),
  }
})()`)

const resilienceNumbers = (report.resilienceValues || [])
  .map((value) => Number.parseFloat(String(value).replace('%', '')))
  .filter((value) => Number.isFinite(value))
report.resilienceSpread = resilienceNumbers.length > 1
  ? Math.round(((Math.max(...resilienceNumbers) - Math.min(...resilienceNumbers)) / 100) * 1000) / 1000
  : 0

const expectedCharts = ['ETc crop water demand', 'Rainfall deficit', 'Modelled resilience', 'Weighted prototype score']
check('results render four charts', expectedCharts.every((t) => report.chartTitles.includes(t)), report.chartTitles.join(', '))
check('comparison table has three strategies', report.tableRows === 3, `${report.tableRows} rows`)
check('each strategy shows a water budget', report.waterCards === 3, `${report.waterCards} cards`)
check('water budget exposes ETc/rain/deficit', report.cardsHaveDeficit === true)
check('water budget states its data source', report.cardsHaveNasaSource === true)
check('NASA role text is the corrected one', report.hasNasaDecisionText === true)
check('no runtime error banner', report.hasError === false)
check('tie notice explains score spread', report.hasTieNotice === true)
check('deficit column is present', report.hasDeficitColumn === true)
// The three options deliberately share crops, so their mean resilience is close;
// back/test_agronomy.py asserts the wider winter-vs-summer difference (>0.05).
check('resilience values are not identical', report.resilienceSpread > 0.003, `spread ${report.resilienceSpread}`)
check('deficit/irrigation caveat is shown', report.hasDeficitExplanation === true)
check('revenue labelled illustrative', report.hasRevenueLabel === true)

ws.close()
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll end-to-end checks passed.')
