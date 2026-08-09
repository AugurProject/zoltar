import { promises as fs } from 'node:fs'

type CdpMessage = Readonly<{ id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown }>

const outputDirectory = process.env.TRADING_QA_OUTPUT ?? '/tmp/zoltar-trading-qa'
const baseUrl = process.env.TRADING_QA_URL ?? 'http://127.0.0.1:12346'
const debuggingPort = 9227
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
			if (typeof error !== 'object' || error === null || !('code' in error) || (error.code !== 'ConnectionRefused' && error.code !== 'ECONNREFUSED')) throw error
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
const scenarios = [
	{ name: 'disconnected-market-list', width: 1440, height: 900, path: '/#/markets' },
	{ name: 'disconnected-market-list-mobile', width: 390, height: 844, path: '/#/markets' },
	{ name: 'wrong-network', width: 1440, height: 900, path: '/?demo=1&scenario=wrong-network#/markets' },
	{ name: 'market-list-mobile', width: 390, height: 844, path: '/?demo=1&scenario=baseline#/markets' },
	{ name: 'wrong-network-market', width: 1440, height: 900, path: '/?demo=1&scenario=wrong-network#/market', scrollY: 500 },
	{ name: 'wrong-network-market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=wrong-network#/market', scrollY: 650 },
	{ name: 'loading', width: 1440, height: 900, path: '/?demo=1&scenario=loading#/markets' },
	{ name: 'market-desktop', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/market' },
	{ name: 'market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=baseline#/market' },
	{ name: 'help-mobile', width: 390, height: 844, path: '/#/help' },
	{ name: 'developer-live', width: 1440, height: 900, path: '/#/developer' },
	{ name: 'no-entry', width: 1440, height: 900, path: '/?demo=1&scenario=baseline&side=no#/market' },
	{ name: 'insured-exit', width: 1440, height: 900, path: '/?demo=1&scenario=baseline&mode=exit#/market' },
	{ name: 'insufficient-invalid', width: 390, height: 844, path: '/?demo=1&scenario=insufficient-invalid&mode=exit#/market', scrollY: 650 },
	{ name: 'pair-missing', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/markets' },
	{ name: 'ended-pair-missing-list', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/markets' },
	{ name: 'pair-missing-market', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/market' },
	{ name: 'pair-missing-market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=missing-pair#/market', scrollY: 500 },
	{ name: 'ended-pair-missing-market', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/market', scrollY: 500 },
	{ name: 'ended-pair-missing-liquidity', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/liquidity' },
	{ name: 'liquidity-desktop', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/liquidity' },
	{ name: 'liquidity-mobile', width: 390, height: 844, path: '/?demo=1&scenario=missing-pair#/liquidity', scrollY: 420 },
	{ name: 'portfolio-desktop', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/portfolio' },
	{ name: 'portfolio-mobile', width: 390, height: 844, path: '/?demo=1&scenario=baseline#/portfolio', scrollY: 360 },
	{ name: 'ended', width: 1440, height: 900, path: '/?demo=1&scenario=ended#/market' },
	{ name: 'truth-auction', width: 1440, height: 900, path: '/?demo=1&scenario=truth-auction#/market' },
	{ name: 'truth-auction-liquidity', width: 1440, height: 900, path: '/?demo=1&scenario=truth-auction#/liquidity' },
	{ name: 'truth-auction-liquidity-mobile', width: 390, height: 844, path: '/?demo=1&scenario=truth-auction#/liquidity', scrollY: 420 },
	{ name: 'forked-mobile', width: 390, height: 844, path: '/?demo=1&scenario=forked#/market' },
	{ name: 'resolved-invalid', width: 1440, height: 900, path: '/?demo=1&scenario=resolved-invalid#/market' },
	{ name: 'pending', width: 1440, height: 900, path: '/?demo=1&scenario=pending#/market', scrollY: 900 },
	{ name: 'success', width: 1440, height: 900, path: '/?demo=1&scenario=success#/market', scrollY: 900 },
	{ name: 'failure', width: 1440, height: 900, path: '/?demo=1&scenario=failure#/market', scrollY: 900 },
	{ name: 'clicked-pending', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/market', clickSelector: '.primary-action', clickWaitMs: 150, scrollY: 900 },
	{ name: 'clicked-confirmed', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/market', clickSelector: '.primary-action', clickWaitMs: 1_500, scrollY: 900 },
] as const

try {
	for (const scenario of scenarios) {
		await command('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false })
		await command('Page.navigate', { url: `${baseUrl}${scenario.path}` })
		await Bun.sleep(600)
		if ('clickSelector' in scenario) {
			await command('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(scenario.clickSelector)})?.click()` })
			await Bun.sleep(scenario.clickWaitMs)
		}
		if ('scrollY' in scenario) {
			await command('Runtime.evaluate', { expression: `document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, ${scenario.scrollY})` })
			await Bun.sleep(300)
		}
		const result = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
		if (typeof result.data !== 'string') throw new Error(`Screenshot data missing for ${scenario.name}`)
		await fs.writeFile(`${outputDirectory}/${scenario.name}.png`, Buffer.from(result.data, 'base64'))
		console.log(`${scenario.name}: ${scenario.width}x${scenario.height} ${scenario.path}`)
	}
	console.log(`Runtime errors: ${runtimeErrors.length}`)
	for (const error of runtimeErrors) console.log(error)
	if (runtimeErrors.length > 0) throw new Error(`Browser QA observed ${runtimeErrors.length} runtime error${runtimeErrors.length === 1 ? '' : 's'}`)
} finally {
	socket.close()
	browser.kill()
	await fs.rm(userDataDirectory, { recursive: true, force: true })
}
