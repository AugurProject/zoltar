import { promises as fs } from 'node:fs'

type CdpMessage = Readonly<{ id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown }>

const outputDirectory = process.env.TRADING_QA_OUTPUT ?? '/tmp/zoltar-trading-qa'
const baseUrl = process.env.TRADING_QA_URL ?? 'http://127.0.0.1:4163'
const selectedNames = new Set((process.env.TRADING_QA_SCENARIOS ?? '').split(',').filter(name => name !== ''))
const debuggingPort = 9227
const simulationPath = '/?simulate=1&simScenario=trading'
await fs.mkdir(outputDirectory, { recursive: true })
const userDataDirectory = await fs.mkdtemp('/tmp/zoltar-trading-qa-browser-')
const browser = Bun.spawn({
	cmd: ['chromium', '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update', '--no-first-run', `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${userDataDirectory}`, 'about:blank'],
	stdout: 'ignore',
	stderr: 'ignore',
})

async function waitForDebugger() {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`)
			if (response.ok) return
		} catch (error) {
			if (typeof error !== 'object' || error === null || !('code' in error) || !['ConnectionRefused', 'ECONNREFUSED', 'ECONNRESET'].includes(String(error.code))) throw error
		}
		await Bun.sleep(100)
	}
	throw new Error('Chromium debugging endpoint did not start')
}

await waitForDebugger()
const targetResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/new?about:blank`, { method: 'PUT' })
const target: unknown = await targetResponse.json()
if (typeof target !== 'object' || target === null || !('webSocketDebuggerUrl' in target) || typeof target.webSocketDebuggerUrl !== 'string') throw new Error('Chromium target did not expose a debugger WebSocket')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise<void>((resolve, reject) => {
	socket.addEventListener('open', () => resolve(), { once: true })
	socket.addEventListener('error', () => reject(new Error('Debugger WebSocket failed')), { once: true })
})
let nextId = 1
const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(reason: unknown): void }>()
const runtimeErrors: string[] = []
const failedRequests: string[] = []
socket.addEventListener('message', event => {
	const candidate: unknown = JSON.parse(String(event.data))
	if (typeof candidate !== 'object' || candidate === null) {
		runtimeErrors.push('Chromium returned a malformed debugger message')
		return
	}
	const message: CdpMessage = candidate
	if (message.id !== undefined) {
		const request = pending.get(message.id)
		if (request === undefined) return
		pending.delete(message.id)
		if (message.error !== undefined) request.reject(message.error)
		else request.resolve(message.result ?? {})
		return
	}
	if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(JSON.stringify(message.params ?? {}))
	if (message.method === 'Log.entryAdded') {
		const entry = message.params?.entry
		if (typeof entry === 'object' && entry !== null && 'level' in entry && entry.level === 'error') runtimeErrors.push(JSON.stringify(entry))
	}
	if (message.method === 'Network.loadingFailed') failedRequests.push(JSON.stringify(message.params ?? {}))
	if (message.method === 'Network.responseReceived') {
		const response = message.params?.response
		if (typeof response === 'object' && response !== null && 'status' in response && typeof response.status === 'number' && response.status >= 400) failedRequests.push(JSON.stringify(response))
	}
})

function command(method: string, params: Record<string, unknown> = {}) {
	const id = nextId++
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params }))
	})
}

await command('Page.enable')
await command('Runtime.enable')
await command('Log.enable')
await command('Network.enable')

const waitForSeededMarket = `(async () => {
	for (let attempt = 0; attempt < 600; attempt++) {
		const market = document.querySelector('.live-market-button')
		const simulation = document.querySelector('.simulation-banner-details')
		if (market instanceof HTMLButtonElement && simulation !== null) return true
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('The Trading TEVM scenario did not expose its seeded SecurityPool')
})()`
const selectSeededMarket = `(async () => {
	await (${waitForSeededMarket})
	const market = document.querySelector('.live-market-button')
	if (!(market instanceof HTMLButtonElement)) return false
	market.click()
	for (let attempt = 0; attempt < 100; attempt++) {
		if (document.querySelector('.two-column:not(.two-column--single)') !== null) return true
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	return false
})()`
const commonAssertion = `document.querySelector('.demo-banner') === null && !document.body.textContent?.includes('SIMULATED DATA') && !document.body.textContent?.includes('Demo mode') && document.querySelector('.simulation-banner-details') !== null && document.querySelector('.brand')?.textContent?.includes('Statoblast trading') === true && document.querySelector('.network-pill')?.textContent?.includes('Deployment verified') === true && document.documentElement.scrollWidth <= document.documentElement.clientWidth`

const scenarios = [
	...(
		[
			['simulation-markets-desktop', 1440, 900],
			['simulation-markets-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/markets`,
		assertExpression: `(async () => { await (${waitForSeededMarket}); return ${commonAssertion} && document.title === 'Markets · Statoblast trading' && document.querySelectorAll('.live-market-button').length > 0 })()`,
	})),
	...(
		[
			['simulation-market-detail-desktop', 1440, 900],
			['simulation-market-detail-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/markets`,
		evaluate: selectSeededMarket,
		assertExpression: `(${commonAssertion}) && document.querySelector('.two-column:not(.two-column--single)') !== null && document.querySelector('.section .fact-list') !== null`,
	})),
	...(
		[
			['simulation-liquidity-desktop', 1440, 900],
			['simulation-liquidity-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/markets`,
		evaluate: `(async () => { if (!(await (${selectSeededMarket}))) return false; const link = document.querySelector('a[href="#/liquidity"]'); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); for (let attempt = 0; attempt < 100; attempt++) { if (location.hash === '#/liquidity' && [...document.querySelectorAll('.operation-block h3')].some(heading => heading.textContent === 'Live liquidity')) return true; await new Promise(resolve => setTimeout(resolve, 100)); } return false })()`,
		assertExpression: `(${commonAssertion}) && location.hash === '#/liquidity' && [...document.querySelectorAll('.operation-block h3')].some(heading => heading.textContent === 'Live liquidity')`,
	})),
] as const

const selectedScenarios = selectedNames.size === 0 ? scenarios : scenarios.filter(scenario => selectedNames.has(scenario.name))
if (selectedScenarios.length === 0) throw new Error('TRADING_QA_SCENARIOS did not match a browser scenario')

try {
	for (const scenario of selectedScenarios) {
		await command('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false })
		await command('Page.navigate', { url: `${baseUrl}${scenario.path}` })
		await Bun.sleep(600)
		if ('evaluate' in scenario) {
			const evaluated = await command('Runtime.evaluate', { expression: scenario.evaluate, returnByValue: true, awaitPromise: true })
			const result = evaluated.result
			if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Setup expression failed for ${scenario.name}: ${JSON.stringify(evaluated)}`)
		}
		const evaluated = await command('Runtime.evaluate', { expression: scenario.assertExpression, returnByValue: true, awaitPromise: true })
		const result = evaluated.result
		if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Browser assertion failed for ${scenario.name}: ${JSON.stringify(evaluated)}`)
		const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
		if (typeof screenshot.data !== 'string') throw new Error(`Screenshot data missing for ${scenario.name}`)
		await fs.writeFile(`${outputDirectory}/${scenario.name}.png`, Buffer.from(screenshot.data, 'base64'))
		console.log(`${scenario.name}: ${scenario.width.toString()}x${scenario.height.toString()} ${scenario.path}`)
	}
	console.log(`Runtime errors: ${runtimeErrors.length.toString()}`)
	console.log(`Failed requests: ${failedRequests.length.toString()}`)
	if (runtimeErrors.length > 0) throw new Error(`Browser QA observed ${runtimeErrors.length.toString()} runtime errors`)
	if (failedRequests.length > 0) throw new Error(`Browser QA observed ${failedRequests.length.toString()} failed requests`)
} finally {
	socket.close()
	browser.kill()
	await fs.rm(userDataDirectory, { recursive: true, force: true })
}
