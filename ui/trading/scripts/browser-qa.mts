import { promises as fs } from 'node:fs'

type CdpMessage = Readonly<{ id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown; sessionId?: string }>

const outputDirectory = process.env.TRADING_QA_OUTPUT ?? '/tmp/zoltar-trading-qa'
const baseUrl = process.env.TRADING_QA_URL ?? 'http://127.0.0.1:4163'
const selectedNames = new Set((process.env.TRADING_QA_SCENARIOS ?? '').split(',').filter(name => name !== ''))
const injectedFailure = process.env.TRADING_QA_INJECT_FAILURE
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
	if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') runtimeErrors.push(JSON.stringify(message.params))
	if (message.method === 'Log.entryAdded') {
		const entry = message.params?.entry
		if (typeof entry === 'object' && entry !== null && 'level' in entry && entry.level === 'error') runtimeErrors.push(JSON.stringify(entry))
	}
	if (message.method === 'Network.loadingFailed') failedRequests.push(JSON.stringify(message.params ?? {}))
	if (message.method === 'Network.responseReceived') {
		const response = message.params?.response
		if (typeof response === 'object' && response !== null && 'status' in response && typeof response.status === 'number' && response.status >= 400) failedRequests.push(JSON.stringify(response))
	}
	if (message.method === 'Target.attachedToTarget') {
		const sessionId = message.params?.sessionId
		const targetInfo = message.params?.targetInfo
		if (typeof sessionId !== 'string') return
		if (typeof targetInfo !== 'object' || targetInfo === null || !('type' in targetInfo) || !['worker', 'shared_worker', 'service_worker'].includes(String(targetInfo.type))) {
			void command('Runtime.runIfWaitingForDebugger', {}, sessionId)
			return
		}
		void attachWorkerSession(sessionId).catch(error => runtimeErrors.push(`Could not attach QA collection to worker: ${String(error)}`))
	}
})

function command(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
	const id = nextId++
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		pending.set(id, { resolve, reject })
		socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
	})
}

async function attachWorkerSession(sessionId: string) {
	await Promise.all([command('Runtime.enable', {}, sessionId), command('Log.enable', {}, sessionId), command('Network.enable', {}, sessionId)])
	await command('Runtime.runIfWaitingForDebugger', {}, sessionId)
}

await command('Page.enable')
await command('Runtime.enable')
await command('Log.enable')
await command('Network.enable')
await command('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })

const waitForSeededPool = `(async () => {
	for (let attempt = 0; attempt < 600; attempt++) {
		const pool = document.querySelector('.market-row')
		const simulation = document.querySelector('.simulation-banner-details')
		if (pool !== null && simulation !== null) return true
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('The Trading TEVM scenario did not expose its seeded SecurityPool')
})()`
const waitForLookup = `(async () => {
	for (let attempt = 0; attempt < 600; attempt++) {
		if (document.querySelector('.market-lookup') !== null && document.querySelector('.simulation-banner-details') !== null && document.querySelector('.universe-selector select')?.textContent?.includes('Genesis universe') === true) return true
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('The Trading lookup route did not become ready')
})()`
const openSeededPool = `(async () => {
	await (${waitForSeededPool})
	const open = document.querySelector('.market-row .primary-action')
	if (!(open instanceof HTMLAnchorElement)) return false
	open.click()
	for (let attempt = 0; attempt < 100; attempt++) {
		if (document.querySelector('.market-stack .section .fact-list') !== null) return true
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	return false
})()`
const commonAssertion = `document.querySelector('.demo-banner') === null && !document.body.textContent?.includes('SIMULATED DATA') && !document.body.textContent?.includes('Demo mode') && !document.body.textContent?.includes('Loading...') && document.querySelector('.simulation-banner-details') !== null && document.querySelector('.top-shell .overview-panel') !== null && document.documentElement.scrollWidth <= document.documentElement.clientWidth`
const waitForRouteHeading = (heading: string) => `(async () => {
	for (let attempt = 0; attempt < 600; attempt++) {
		if ((${commonAssertion}) && document.querySelector('#main-content .route-header h2')?.textContent === '${heading}') return true
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error('The ${heading} route did not become ready')
})()`

const scenarios = [
	...(
		[
			['simulation-market-lookup-desktop', 1440, 900],
			['simulation-market-lookup-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/market`,
		assertExpression: `(async () => { await (${waitForLookup}); return ${commonAssertion} && document.title === 'Market · Statoblast trading' && document.querySelector('.market-lookup a[href^="#/markets"]') !== null && document.querySelector('.market-row') === null })()`,
	})),
	...(
		[
			['simulation-security-pools-desktop', 1440, 900],
			['simulation-security-pools-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/security-pools`,
		assertExpression: `(async () => { await (${waitForSeededPool}); return ${commonAssertion} && document.title === 'Browse SecurityPools · Statoblast trading' && document.querySelectorAll('.market-row').length > 0 })()`,
	})),
	...(
		[
			['simulation-create-market-desktop', 1440, 900],
			['simulation-create-market-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/security-pools`,
		evaluate: openSeededPool,
		assertExpression: `(${commonAssertion}) && location.hash.startsWith('#/create-market/') && document.title === 'Create new market · Statoblast trading' && document.querySelector('a[aria-current="page"]')?.textContent === 'Create new market' && document.querySelector('.market-stack .section .fact-list') !== null && document.querySelector('.market-list') === null && [...document.querySelectorAll('.operation-block h3')].some(heading => heading.textContent === 'Live liquidity')`,
	})),
	...(
		[
			['simulation-liquidity-lookup-desktop', 1440, 900],
			['simulation-liquidity-lookup-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/liquidity`,
		assertExpression: `(async () => { await (${waitForLookup}); return ${commonAssertion} && document.title === 'Liquidity · Statoblast trading' && document.querySelector('a[aria-current="page"]')?.textContent === 'Liquidity' && document.querySelector('.market-lookup form.open-pool-form') !== null })()`,
	})),
	...(
		[
			['simulation-portfolio-desktop', 1440, 900],
			['simulation-portfolio-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/portfolio`,
		assertExpression: `(async () => { await (${waitForRouteHeading('Portfolio')}); for (let attempt = 0; attempt < 100; attempt++) { if (!document.body.textContent?.includes('Discovering SecurityPools') && document.querySelector('.universe-selector select')?.textContent?.includes('Genesis universe') === true) return document.title === 'Portfolio · Statoblast trading' && document.querySelector('a[aria-current="page"]')?.textContent === 'Portfolio' && document.querySelector('#main-content .portfolio-section > .section-heading h2')?.textContent === 'Positions' && document.querySelector('.section .portfolio-groups > .operation-block') === null; await new Promise(resolve => setTimeout(resolve, 100)); } return false })()`,
	})),
	...(
		[
			['simulation-help-desktop', 1440, 900],
			['simulation-help-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/help`,
		assertExpression: `(async () => { await (${waitForRouteHeading('How the market works')}); return document.title === 'Help · Statoblast trading' && document.querySelector('a[aria-current="page"]')?.textContent === 'Help' && document.querySelectorAll('.explanation-flow article').length === 4 })()`,
	})),
	...(
		[
			['simulation-deploy-desktop', 1440, 900],
			['simulation-deploy-mobile', 390, 844],
		] as const
	).map(([name, width, height]) => ({
		name,
		width,
		height,
		path: `${simulationPath}#/deploy`,
		assertExpression: `(async () => { await (${waitForRouteHeading('Deploy')}); for (let attempt = 0; attempt < 100; attempt++) { if (document.querySelector('.deployment-setup__status')?.textContent?.includes('Deployment complete') === true) return document.title === 'Deploy · Statoblast trading' && document.querySelector('.deployment-settings') === null && document.querySelector('.deployment-setup input[type="url"]') === null; await new Promise(resolve => setTimeout(resolve, 100)); } return false })()`,
	})),
	{
		name: 'simulation-scenario-navigation-desktop',
		width: 1440,
		height: 900,
		path: `${simulationPath}#/security-pools`,
		evaluate: `(async () => {
			await (${waitForSeededPool})
			const details = document.querySelector('.simulation-banner-details')
			if (!(details instanceof HTMLDetailsElement)) throw new Error('Simulation details are unavailable')
			details.open = true
			const select = document.querySelector('.simulation-control-select')
			if (!(select instanceof HTMLSelectElement)) throw new Error('Simulation scenario selector is unavailable')
			select.value = 'scenario:baseline'
			select.dispatchEvent(new Event('change', { bubbles: true }))
			for (let attempt = 0; attempt < 600; attempt++) {
				const currentSelect = document.querySelector('.simulation-control-select')
				if (location.hash.includes('simScenario=baseline') && document.querySelector('.simulation-banner-compact-summary')?.textContent?.includes('Baseline') === true && currentSelect instanceof HTMLSelectElement && !currentSelect.disabled) break
				await new Promise(resolve => setTimeout(resolve, 100))
			}
			const updatedSelect = document.querySelector('.simulation-control-select')
			if (!(updatedSelect instanceof HTMLSelectElement)) throw new Error('Simulation scenario selector disappeared after selecting Baseline')
			if (updatedSelect.value !== 'scenario:baseline') throw new Error('Trading did not activate the Baseline environment')
			history.back()
			for (let attempt = 0; attempt < 600; attempt++) {
				const currentSelect = document.querySelector('.simulation-control-select')
				if (location.href.includes('simScenario=trading') && currentSelect instanceof HTMLSelectElement && currentSelect.value === 'scenario:trading' && document.querySelector('.market-row') !== null) break
				await new Promise(resolve => setTimeout(resolve, 100))
			}
			if (!location.href.includes('simScenario=trading') || document.querySelector('.simulation-control-select')?.value !== 'scenario:trading' || document.querySelector('.market-row') === null) throw new Error('Browser Back did not restore the seeded Trading environment: ' + location.href + ' / ' + document.querySelector('.simulation-control-select')?.value + ' / ' + document.querySelector('.error-notice')?.textContent)
			history.forward()
			for (let attempt = 0; attempt < 600; attempt++) {
				const currentSelect = document.querySelector('.simulation-control-select')
				if (location.hash.includes('simScenario=baseline') && currentSelect instanceof HTMLSelectElement && currentSelect.value === 'scenario:baseline' && !currentSelect.disabled) break
				await new Promise(resolve => setTimeout(resolve, 100))
			}
			if (!location.hash.includes('simScenario=baseline') || document.querySelector('.simulation-control-select')?.value !== 'scenario:baseline') throw new Error('Browser Forward did not restore the Baseline environment')
			const liquidityLink = document.querySelector('a[href^="#/liquidity?"]')
			if (!(liquidityLink instanceof HTMLAnchorElement)) throw new Error('Liquidity navigation did not preserve the Baseline scenario')
			liquidityLink.click()
			for (let attempt = 0; attempt < 100; attempt++) {
				if (location.hash.startsWith('#/liquidity?') && location.hash.includes('simScenario=baseline') && document.querySelector('a[aria-current="page"]')?.textContent === 'Liquidity') break
				await new Promise(resolve => setTimeout(resolve, 100))
			}
			if (!location.hash.startsWith('#/liquidity?') || document.body.textContent?.includes('Page not found')) throw new Error('Liquidity navigation lost the Baseline scenario')
			history.back()
			for (let attempt = 0; attempt < 100; attempt++) {
				if (location.hash.startsWith('#/security-pools?') && location.hash.includes('simScenario=baseline') && document.querySelector('a[aria-current="page"]')?.textContent === 'Create new market') break
				await new Promise(resolve => setTimeout(resolve, 100))
			}
			const restoredSelect = document.querySelector('.simulation-control-select')
			if (!(restoredSelect instanceof HTMLSelectElement) || restoredSelect.value !== 'scenario:baseline') throw new Error('Browser Back did not restore the Baseline SecurityPools route')
			restoredSelect.value = 'scenario:trading'
			restoredSelect.dispatchEvent(new Event('change', { bubbles: true }))
			for (let attempt = 0; attempt < 600; attempt++) {
				if (location.hash.includes('simScenario=trading') && document.querySelector('.market-row') !== null) return true
				await new Promise(resolve => setTimeout(resolve, 100))
			}
			throw new Error('Trading did not restore its seeded environment after scenario navigation: ' + location.hash + ' / ' + document.querySelector('.simulation-control-select')?.value + ' / ' + document.querySelector('.error-notice')?.textContent)
		})()`,
		assertExpression: `(${commonAssertion}) && location.hash.includes('simScenario=trading') && document.querySelector('.market-row') !== null`,
	},
	{
		name: 'simulation-scenario-direct-reload-desktop',
		width: 1440,
		height: 900,
		path: '/#/security-pools?simulate=1&simScenario=trading',
		assertExpression: `(async () => { await (${waitForSeededPool}); return ${commonAssertion} && location.hash === '#/security-pools?simulate=1&simScenario=trading' && document.querySelector('a[aria-current="page"]')?.textContent === 'Create new market' && !document.body.textContent?.includes('Page not found') })()`,
	},
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
		if (typeof result !== 'object' || result === null || !('value' in result) || result.value !== true) {
			const diagnostic = await command('Runtime.evaluate', { expression: `({ title: document.title, text: document.body.textContent, hash: location.hash, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, hasSimulation: document.querySelector('.simulation-banner-details') !== null, hasOverview: document.querySelector('.top-shell .overview-panel') !== null, markets: document.querySelectorAll('.market-row').length })`, returnByValue: true })
			throw new Error(`Browser assertion failed for ${scenario.name}: ${JSON.stringify(evaluated)} ${JSON.stringify(diagnostic)}`)
		}
		if (injectedFailure === 'page-console') await command('Runtime.evaluate', { expression: `console.error('injected Trading QA page failure')` })
		if (injectedFailure === 'worker-runtime') await command('Runtime.evaluate', { expression: `new Worker(URL.createObjectURL(new Blob(["console.error('injected Trading QA worker failure'); throw new Error('injected Trading QA worker failure')"], { type: 'text/javascript' })))` })
		if (injectedFailure !== undefined) await Bun.sleep(500)
		await Bun.sleep(500)
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
