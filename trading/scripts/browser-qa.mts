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
	{
		name: 'disconnected-market-list',
		width: 1440,
		height: 900,
		path: '/#/markets',
		assertExpression: `document.querySelector('.wallet-status') === null && document.body.textContent?.includes('Connect in market view') !== true`,
	},
	{ name: 'disconnected-market-list-mobile', width: 390, height: 844, path: '/#/markets' },
	{ name: 'wrong-network', width: 1440, height: 900, path: '/?demo=1&scenario=wrong-network#/markets' },
	{
		name: 'market-list-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/markets',
		assertExpression: `document.body.textContent?.includes('INVALID is insurance and is not priced by this AMM') === true && [...document.querySelectorAll('.row-action')].every(control => control.getBoundingClientRect().height >= 44)`,
	},
	{ name: 'wrong-network-market', width: 1440, height: 900, path: '/?demo=1&scenario=wrong-network#/market', scrollY: 500 },
	{ name: 'wrong-network-market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=wrong-network#/market', scrollY: 650 },
	{ name: 'loading', width: 1440, height: 900, path: '/?demo=1&scenario=loading#/markets' },
	{ name: 'market-desktop', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/market' },
	{
		name: 'market-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/market',
		assertExpression: `[...document.querySelectorAll('.segmented button, .brand, .eyebrow[href], details summary')].every(control => control.getBoundingClientRect().height >= 44)`,
	},
	{ name: 'help-mobile', width: 390, height: 844, path: '/#/help' },
	{ name: 'developer-live', width: 1440, height: 900, path: '/#/developer' },
	{ name: 'no-entry', width: 1440, height: 900, path: '/?demo=1&scenario=baseline&side=no#/market' },
	{ name: 'insured-exit', width: 1440, height: 900, path: '/?demo=1&scenario=baseline&mode=exit#/market' },
	{ name: 'insufficient-invalid', width: 390, height: 844, path: '/?demo=1&scenario=insufficient-invalid&mode=exit#/market', scrollY: 650 },
	{ name: 'pair-missing', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/markets' },
	{ name: 'ended-pair-missing-list', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/markets' },
	{ name: 'pair-missing-market', width: 1440, height: 900, path: '/?demo=1&scenario=missing-pair#/market', assertExpression: `document.body.textContent?.includes('Pair initialization required') === true && document.body.textContent?.includes('Waiting for input') !== true` },
	{ name: 'pair-missing-market-mobile', width: 390, height: 844, path: '/?demo=1&scenario=missing-pair#/market', scrollY: 500 },
	{
		name: 'pair-uninitialized-market',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=uninitialized-pair#/market',
		assertExpression: `(() => { const action = [...document.querySelectorAll('a')].find(link => link.textContent?.includes('Initialize this pair in Liquidity')); const bounds = action?.getBoundingClientRect(); return document.querySelector('.trade-panel') === null && document.body.textContent?.includes('Conditional price available after pair initialization') === true && document.body.textContent?.includes('Conditional YES price 0.0%') !== true && bounds !== undefined && bounds.top >= 0 && bounds.bottom <= innerHeight })()`,
	},
	{
		name: 'pair-uninitialized-market-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=uninitialized-pair#/market',
		assertExpression: `(() => { const action = [...document.querySelectorAll('a')].find(link => link.textContent?.includes('Initialize this pair in Liquidity')); const bounds = action?.getBoundingClientRect(); return document.querySelector('.trade-panel') === null && document.body.textContent?.includes('Conditional price available after pair initialization') === true && bounds !== undefined && bounds.top >= 0 && bounds.bottom <= innerHeight })()`,
	},
	{ name: 'ended-pair-missing-market', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/market', scrollY: 500 },
	{ name: 'ended-pair-missing-liquidity', width: 1440, height: 900, path: '/?demo=1&scenario=ended-missing-pair#/liquidity' },
	{
		name: 'liquidity-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=missing-pair#/liquidity',
		assertExpression: `document.body.textContent?.includes('INVALID is insurance and is not priced by this AMM') === true`,
	},
	{
		name: 'liquidity-fractional-price',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=missing-pair&qa=fractional#/liquidity',
		evaluate: `(() => { const input = document.querySelector('.field input:not([readonly])'); if (!(input instanceof HTMLInputElement)) return false; input.value = '70.25'; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
		assertExpression: `document.querySelector('.probability')?.getAttribute('aria-label')?.includes('70.3 percent') === true`,
	},
	{
		name: 'liquidity-invalid-price-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=missing-pair&qa=invalid#/liquidity',
		evaluate: `(() => { const input = document.querySelector('.field input:not([readonly])'); if (!(input instanceof HTMLInputElement)) return false; input.value = '100'; input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
		assertExpression: `document.body.textContent?.includes('must be below 100%') === true`,
		scrollY: 420,
	},
	{ name: 'liquidity-mobile', width: 390, height: 844, path: '/?demo=1&scenario=missing-pair#/liquidity', scrollY: 420 },
	{
		name: 'portfolio-desktop',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/portfolio',
		assertExpression: `document.body.textContent?.includes('INVALID is insurance and is not priced by this AMM') === true`,
	},
	{
		name: 'portfolio-mobile',
		width: 390,
		height: 844,
		path: '/?demo=1&scenario=baseline#/portfolio',
		assertExpression: `[...document.querySelectorAll('.table-row a')].every(control => control.getBoundingClientRect().height >= 44)`,
		scrollY: 360,
	},
	{ name: 'ended', width: 1440, height: 900, path: '/?demo=1&scenario=ended#/market', assertExpression: `document.body.textContent?.includes('Trading closed') === true && document.body.textContent?.includes('Waiting for input') !== true` },
	{ name: 'truth-auction', width: 1440, height: 900, path: '/?demo=1&scenario=truth-auction#/market' },
	{ name: 'truth-auction-liquidity', width: 1440, height: 900, path: '/?demo=1&scenario=truth-auction#/liquidity' },
	{ name: 'truth-auction-liquidity-mobile', width: 390, height: 844, path: '/?demo=1&scenario=truth-auction#/liquidity', scrollY: 420 },
	{ name: 'forked-mobile', width: 390, height: 844, path: '/?demo=1&scenario=forked#/market' },
	{ name: 'resolved-invalid', width: 1440, height: 900, path: '/?demo=1&scenario=resolved-invalid#/market' },
	{
		name: 'pending',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=pending#/market',
		assertExpression: `document.querySelector('.transaction-message')?.textContent?.includes('pending confirmation') === true`,
		scrollY: 900,
	},
	{ name: 'success', width: 1440, height: 900, path: '/?demo=1&scenario=success#/market', scrollY: 900 },
	{ name: 'failure', width: 1440, height: 900, path: '/?demo=1&scenario=failure#/market', scrollY: 900 },
	{
		name: 'clicked-pending',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/market',
		clickSelector: '.primary-action',
		afterClickExpression: `location.hash = '#/help'`,
		clickWaitMs: 150,
		assertExpression: `location.hash === '#/market' && [...document.querySelectorAll('.trade-panel button, .trade-panel input')].every(control => control.disabled) && document.querySelector('.transaction-message')?.textContent?.includes('pending confirmation') === true`,
		scrollY: 900,
	},
	{
		name: 'clicked-exit-approval',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline&mode=exit#/market',
		clickSelector: '.primary-action',
		clickWaitMs: 150,
		assertExpression: `document.querySelector('.transaction-message')?.textContent?.includes('share approval is pending') === true && [...document.querySelectorAll('.trade-panel button, .trade-panel input')].every(control => control.disabled)`,
		scrollY: 900,
	},
	{ name: 'clicked-confirmed', width: 1440, height: 900, path: '/?demo=1&scenario=baseline#/market', clickSelector: '.primary-action', clickWaitMs: 1_500, scrollY: 900 },
	{
		name: 'route-scroll-reset',
		width: 1440,
		height: 900,
		path: '/?demo=1&scenario=baseline#/market',
		evaluate: `(() => { window.scrollTo(0, 1200); location.hash = '#/liquidity'; return true })()`,
		assertExpression: `window.scrollY === 0 && document.querySelector('h1')?.textContent === 'Liquidity' && document.body.textContent?.includes('SIMULATED DATA') === true`,
	},
] as const

try {
	for (const scenario of scenarios) {
		await command('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: false })
		await command('Page.navigate', { url: `${baseUrl}${scenario.path}` })
		await Bun.sleep(600)
		if ('evaluate' in scenario) {
			const evaluated = await command('Runtime.evaluate', { expression: scenario.evaluate, returnByValue: true })
			const result = evaluated.result
			if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Setup expression failed for ${scenario.name}`)
			await Bun.sleep(100)
		}
		if ('clickSelector' in scenario) {
			await command('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(scenario.clickSelector)})?.click()` })
			if ('afterClickExpression' in scenario) await command('Runtime.evaluate', { expression: scenario.afterClickExpression })
			await Bun.sleep(scenario.clickWaitMs)
		}
		if ('assertExpression' in scenario) {
			const evaluated = await command('Runtime.evaluate', { expression: scenario.assertExpression, returnByValue: true })
			const result = evaluated.result
			if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) throw new Error(`Browser assertion failed for ${scenario.name}`)
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
