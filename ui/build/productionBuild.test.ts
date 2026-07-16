import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..', '..')
const distRootPath = path.join(repositoryRootPath, 'ui', 'dist')
const distAssetsPath = path.join(distRootPath, 'assets')
const appBundlePath = path.join(distAssetsPath, 'app.js')
const appSourceMapPath = path.join(distAssetsPath, 'app.js.map')
const workerBundlePath = path.join(distAssetsPath, 'tevmWorker.worker.js')
const workerSourceMapPath = path.join(distAssetsPath, 'tevmWorker.worker.js.map')
const productionIndexPath = path.join(distRootPath, 'index.html')
const productionCssPath = path.join(distRootPath, 'css', 'index.css')
const productionTokensCssPath = path.join(distRootPath, 'css', 'tokens.css')
const productionFaviconPaths = [path.join(distRootPath, 'favicon.ico'), path.join(distRootPath, 'favicon.svg')]

let server: Bun.Server | undefined

function getChromiumPath() {
	for (const commandName of ['chromium', 'chromium-browser', 'google-chrome']) {
		const result = spawnSync('sh', ['-lc', `command -v ${commandName}`], {
			encoding: 'utf8',
		})
		const commandPath = result.stdout.trim()
		if (result.status === 0 && commandPath !== '') return commandPath
	}
	return undefined
}

const chromiumPath = getChromiumPath()
const productionBrowserTest = test

beforeAll(async () => {
	if (process.env['ZOLTAR_USE_EXISTING_PRODUCTION_BUILD'] !== '1') {
		const result = spawnSync('bun', ['run', 'ui:build:prod'], {
			cwd: repositoryRootPath,
			encoding: 'utf8',
		})
		if (result.status !== 0) {
			throw new Error(`ui:build:prod failed\n${result.stdout}${result.stderr}`)
		}
	}

	server = Bun.serve({
		fetch: async request => {
			const requestUrl = new URL(request.url)
			const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\/+/, '')
			const filePath = path.join(distRootPath, relativePath)
			const file = Bun.file(filePath)
			if (!(await file.exists())) {
				return new Response('not found', { status: 404 })
			}
			return new Response(file)
		},
		port: 0,
	})
})

afterAll(() => {
	server?.stop(true)
})

test('production build emits the deployable artifact set', async () => {
	const expectedPaths = [productionIndexPath, productionCssPath, productionTokensCssPath, appBundlePath, appSourceMapPath, workerBundlePath, workerSourceMapPath, ...productionFaviconPaths]

	for (const expectedPath of expectedPaths) {
		await expect(fs.access(expectedPath)).resolves.toBeNull()
	}
})

test('production index html references the bundled app and does not use the dev import map', async () => {
	const html = await fs.readFile(productionIndexPath, 'utf8')

	expect(html).toContain("<script async type = 'module' src = './assets/app.js'></script>")
	expect(html).not.toContain('importmap')
	expect(html).not.toContain('./js/')
	expect(html).not.toContain('./vendor/')
})

test('production javascript is self-contained for deploys', async () => {
	const appBundle = await fs.readFile(appBundlePath, 'utf8')
	const workerBundle = await fs.readFile(workerBundlePath, 'utf8')
	const appSourceMap = JSON.parse(await fs.readFile(appSourceMapPath, 'utf8')) as { sources: string[] }
	const workerSourceMap = JSON.parse(await fs.readFile(workerSourceMapPath, 'utf8')) as { sources: string[] }

	expect(appBundle).not.toContain('./vendor/')
	expect(appBundle).not.toContain('./js/')
	expect(appBundle).toContain('new URL("./tevmWorker.worker.js", import.meta.url)')
	expect(workerBundle).not.toContain('./vendor/')
	expect(workerBundle).not.toContain('./js/')
	expect(appSourceMap.sources.some(source => source.startsWith('../../ts/'))).toBe(true)
	expect(workerSourceMap.sources.some(source => source.startsWith('../../ts/'))).toBe(true)
})

test('production build can be served as static files', async () => {
	if (server === undefined) {
		throw new Error('Production test server did not start')
	}

	const baseUrl = server.url.toString().replace(/\/$/, '')
	const responses = await Promise.all([fetch(`${baseUrl}/`), fetch(`${baseUrl}/assets/app.js`), fetch(`${baseUrl}/assets/tevmWorker.worker.js`), fetch(`${baseUrl}/css/index.css`), fetch(`${baseUrl}/css/tokens.css`)])

	for (const response of responses) {
		expect(response.status).toBe(200)
	}
})

async function waitForDevToolsPort(portFilePath: string) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		try {
			const contents = await fs.readFile(portFilePath, 'utf8')
			const port = Number.parseInt(contents.split('\n')[0] ?? '', 10)
			if (Number.isInteger(port) && port > 0) return port
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
		}
		await Bun.sleep(25)
	}
	throw new Error('Chromium did not publish its DevTools port')
}

async function waitForChromiumPageWebSocketUrl(port: number, timeoutMilliseconds = 5_000) {
	const deadline = Date.now() + timeoutMilliseconds
	let lastObservedState = 'no response'

	while (Date.now() < deadline) {
		try {
			const remainingMilliseconds = deadline - Date.now()
			const targetsResponse = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(remainingMilliseconds) })
			if (!targetsResponse.ok) {
				lastObservedState = `HTTP ${targetsResponse.status.toString()} ${targetsResponse.statusText}`.trim()
			} else {
				const targets: unknown = await targetsResponse.json()
				lastObservedState = JSON.stringify(targets) ?? String(targets)
				if (Array.isArray(targets)) {
					const pageTarget = targets.find(target => typeof target === 'object' && target !== null && 'type' in target && target.type === 'page' && 'webSocketDebuggerUrl' in target && typeof target.webSocketDebuggerUrl === 'string')
					if (typeof pageTarget === 'object' && pageTarget !== null && 'webSocketDebuggerUrl' in pageTarget && typeof pageTarget.webSocketDebuggerUrl === 'string') {
						return pageTarget.webSocketDebuggerUrl
					}
				}
			}
		} catch (error) {
			lastObservedState = error instanceof Error ? error.message : String(error)
		}

		const remainingMilliseconds = deadline - Date.now()
		if (remainingMilliseconds <= 0) break
		await Bun.sleep(Math.min(50, remainingMilliseconds))
	}

	throw new Error(`Chromium page target was unavailable after ${timeoutMilliseconds.toString()}ms. Last observed state: ${lastObservedState}`)
}

test('Chromium page target discovery tolerates an initially empty target list', async () => {
	let requestCount = 0
	const pageWebSocketUrl = 'ws://127.0.0.1/devtools/page/test'
	const devToolsServer = Bun.serve({
		fetch: () => {
			requestCount += 1
			return Response.json(requestCount === 1 ? [] : [{ type: 'page', webSocketDebuggerUrl: pageWebSocketUrl }])
		},
		port: 0,
	})

	try {
		await expect(waitForChromiumPageWebSocketUrl(devToolsServer.port)).resolves.toBe(pageWebSocketUrl)
		expect(requestCount).toBe(2)
	} finally {
		devToolsServer.stop(true)
	}
})

test('Chromium page target discovery bounds a stalled target response', async () => {
	const stalledResponse = new Promise<Response>(() => undefined)
	const devToolsServer = Bun.serve({
		fetch: () => stalledResponse,
		port: 0,
	})
	let rejection: unknown
	const discoveryResult = waitForChromiumPageWebSocketUrl(devToolsServer.port, 100).then(
		() => 'resolved',
		error => {
			rejection = error
			return 'rejected'
		},
	)

	try {
		const result = await Promise.race([discoveryResult, Bun.sleep(250).then(() => 'pending')])
		expect(result).toBe('rejected')
		expect(rejection).toBeInstanceOf(Error)
		if (!(rejection instanceof Error)) throw new Error('Chromium page target discovery did not return an error')
		expect(rejection.message).toContain('Last observed state:')
		expect(rejection.message).not.toContain('Last observed state: no response')
	} finally {
		devToolsServer.stop(true)
		await discoveryResult
	}
})

function readEvaluationString(response: unknown) {
	if (typeof response !== 'object' || response === null || !('result' in response)) throw new Error('Chromium evaluation result was missing')
	const result = response.result
	if (typeof result !== 'object' || result === null || !('value' in result) || typeof result.value !== 'string') throw new Error('Chromium evaluation did not return a string')
	return result.value
}

type ProductionBrowserDriver = {
	clickButton: (label: string, occurrence?: number) => Promise<void>
	evaluate: (expression: string) => Promise<unknown>
	navigate: (url: string) => Promise<void>
	pressTab: () => Promise<void>
	resize: (viewport: { height: number; width: number }) => Promise<void>
	setInputByLabel: (label: string, value: string) => Promise<void>
	waitForButtonEnabled: (label: string, occurrence?: number) => Promise<void>
	waitForBodyText: (text: string) => Promise<string>
	waitForBodyWithoutText: (text: string) => Promise<string>
}

async function loadProductionDocumentInChromium(pageUrl: string, viewport: { height: number; width: number }, interact?: (driver: ProductionBrowserDriver) => Promise<void>) {
	if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser smoke test')
	const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'zoltar-production-browser-'))
	const browser = Bun.spawn([chromiumPath, '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profilePath}`, '--window-size=1440,900', 'about:blank'], { stderr: 'ignore', stdout: 'ignore' })
	let socket: WebSocket | undefined

	try {
		const port = await waitForDevToolsPort(path.join(profilePath, 'DevToolsActivePort'))
		socket = new WebSocket(await waitForChromiumPageWebSocketUrl(port))
		await new Promise<void>((resolve, reject) => {
			socket?.addEventListener('open', () => resolve(), { once: true })
			socket?.addEventListener('error', () => reject(new Error('Chromium DevTools connection failed')), { once: true })
		})

		let requestId = 0
		const pendingRequests = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
		socket.addEventListener('message', event => {
			if (typeof event.data !== 'string') return
			const message = JSON.parse(event.data)
			if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'number') return
			const pending = pendingRequests.get(message.id)
			if (pending === undefined) return
			pendingRequests.delete(message.id)
			if ('error' in message) pending.reject(new Error(`Chromium DevTools command failed: ${JSON.stringify(message.error)}`))
			else pending.resolve('result' in message ? message.result : undefined)
		})
		const send = async (method: string, params: Record<string, unknown> = {}) => {
			if (socket === undefined) throw new Error('Chromium DevTools connection was unavailable')
			requestId += 1
			const currentRequestId = requestId
			const result = new Promise<unknown>((resolve, reject) => {
				pendingRequests.set(currentRequestId, { reject, resolve })
			})
			socket.send(JSON.stringify({ id: currentRequestId, method, params }))
			return await result
		}
		const evaluate = async (expression: string) => {
			const response = await send('Runtime.evaluate', { expression, returnByValue: true })
			if (typeof response !== 'object' || response === null || !('result' in response)) throw new Error('Chromium evaluation result was missing')
			const result = response.result
			if (typeof result !== 'object' || result === null) throw new Error('Chromium evaluation result was invalid')
			return 'value' in result ? result.value : undefined
		}
		const readBody = async () => {
			const body = await evaluate('document.body?.innerText ?? ""')
			if (typeof body !== 'string') throw new Error('Chromium body evaluation did not return text')
			return body
		}
		const waitForBody = async (predicate: (body: string) => boolean, description: string) => {
			let body = ''
			for (let attempt = 0; attempt < 2400; attempt += 1) {
				body = await readBody()
				if (predicate(body)) return body
				await Bun.sleep(50)
			}
			throw new Error(`Timed out waiting for ${description}. Last body: ${body}`)
		}
		const resize = async (nextViewport: { height: number; width: number }) => {
			await send('Emulation.setDeviceMetricsOverride', {
				deviceScaleFactor: 1,
				height: nextViewport.height,
				mobile: false,
				width: nextViewport.width,
			})
		}

		await send('Runtime.enable')
		await send('Page.enable')
		await send('Page.addScriptToEvaluateOnNewDocument', {
			source: `(() => { const NativeWorker = window.Worker; window.__zoltarProductionWorkers = []; window.Worker = class TrackedProductionWorker extends NativeWorker { constructor(...args) { super(...args); window.__zoltarProductionWorkers.push(this) } } })()`,
		})
		await resize(viewport)
		await send('Page.navigate', { url: pageUrl })
		let state = ''
		let applicationReady = false
		for (let attempt = 0; attempt < 2400; attempt += 1) {
			state = readEvaluationString(
				await send('Runtime.evaluate', {
					expression: `JSON.stringify({ body: document.body?.innerText ?? '', height: innerHeight, html: document.documentElement?.outerHTML ?? '', width: innerWidth })`,
					returnByValue: true,
				}),
			)
			const parsedState = JSON.parse(state)
			if (typeof parsedState === 'object' && parsedState !== null && 'body' in parsedState && typeof parsedState.body === 'string' && parsedState.body !== '' && parsedState.body !== 'Loading...' && !parsedState.body.includes('BOOTSTRAPPING') && !parsedState.body.includes('Starting simulation bootstrap')) {
				applicationReady = true
				break
			}
			await Bun.sleep(50)
		}
		if (!applicationReady) throw new Error(`Production application did not finish loading: ${state}`)
		const driver: ProductionBrowserDriver = {
			clickButton: async (label, occurrence = 0) => {
				const clicked = await evaluate(
					`(() => { const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === ${JSON.stringify(label)} && !button.disabled); const button = buttons[${occurrence.toString()}]; if (!(button instanceof HTMLButtonElement)) return false; button.focus(); button.click(); return true })()`,
				)
				if (clicked !== true) throw new Error(`Unable to click enabled browser button ${label} at occurrence ${occurrence.toString()}`)
			},
			evaluate,
			navigate: async url => {
				await send('Page.navigate', { url })
			},
			pressTab: async () => {
				await send('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyDown' })
				await send('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyUp' })
			},
			resize,
			setInputByLabel: async (label, value) => {
				const updated = await evaluate(
					`(() => { const label = [...document.querySelectorAll('label')].find(candidate => [...candidate.querySelectorAll('span')].some(span => span.textContent?.trim() === ${JSON.stringify(label)})); const input = label?.querySelector('input'); if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
				)
				if (updated !== true) throw new Error(`Unable to update browser input ${label}`)
			},
			waitForButtonEnabled: async (label, occurrence = 0) => {
				for (let attempt = 0; attempt < 600; attempt += 1) {
					const enabled = await evaluate(`[...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === ${JSON.stringify(label)} && !button.disabled)[${occurrence.toString()}] instanceof HTMLButtonElement`)
					if (enabled === true) return
					await Bun.sleep(50)
				}
				throw new Error(`Timed out waiting for enabled browser button ${label}. Last body: ${await readBody()}`)
			},
			waitForBodyText: async text => await waitForBody(body => body.includes(text), JSON.stringify(text)),
			waitForBodyWithoutText: async text => await waitForBody(body => !body.includes(text), `body to omit ${JSON.stringify(text)}`),
		}
		await interact?.(driver)
		return readEvaluationString(
			await send('Runtime.evaluate', {
				expression: `JSON.stringify({ body: document.body?.innerText ?? '', height: innerHeight, html: document.documentElement?.outerHTML ?? '', width: innerWidth })`,
				returnByValue: true,
			}),
		)
	} finally {
		socket?.close()
		browser.kill()
		await browser.exited
		await fs.rm(profilePath, { force: true, recursive: true })
	}
}

productionBrowserTest('production bundle boots worker-backed protocol scenarios in Chromium', async () => {
	if (server === undefined) throw new Error('Production test server did not start')
	if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser smoke test')
	const baseUrl = server.url.toString().replace(/\/$/, '')
	const scenarios = [
		{
			hash: '#/deploy?simulate=1&simScenario=baseline',
			expected: 'Deploy Contracts',
			name: 'baseline deployment',
			viewport: { height: 900, width: 1440 },
		},
		{
			hash: '#/zoltar?simulate=1&simScenario=deployed',
			expected: 'Questions & Markets',
			name: 'deployed protocol',
			viewport: { height: 900, width: 1440 },
		},
		{
			hash: '#/security-pools?simulate=1&simScenario=security-pool',
			expected: 'Security Pools',
			name: 'seeded pool at narrow width',
			viewport: { height: 844, width: 390 },
		},
		{
			hash: '#/security-pools?simulate=1&simScenario=securitypoolx2-auction',
			expected: 'Truth Auction',
			name: 'fork and auction',
			viewport: { height: 900, width: 1440 },
		},
	] as const

	for (const scenario of scenarios) {
		const state = JSON.parse(await loadProductionDocumentInChromium(`${baseUrl}/${scenario.hash}`, scenario.viewport))
		if (typeof state !== 'object' || state === null || !('body' in state) || !('html' in state) || typeof state.body !== 'string' || typeof state.html !== 'string' || !('height' in state) || !('width' in state)) {
			throw new Error(`${scenario.name} returned an invalid document state`)
		}
		expect(state.html).toContain('<main')
		expect(state.body).toContain(scenario.expected)
		expect(state.body).toContain('Simulation')
		expect(state.height).toBe(scenario.viewport.height)
		expect(state.width).toBe(scenario.viewport.width)
		expect(state.body).not.toContain('Failed to initialize the app environment')
	}
})

productionBrowserTest('production bundle executes deployment, reporting, fork migration, failure recovery, and truth auction finalization', async () => {
	if (server === undefined) throw new Error('Production test server did not start')
	if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser workflow test')
	const baseUrl = server.url.toString().replace(/\/$/, '')
	const state = JSON.parse(
		await loadProductionDocumentInChromium(`${baseUrl}/#/deploy?simulate=1&simScenario=baseline`, { height: 900, width: 1440 }, async driver => {
			await driver.evaluate('document.body.focus()')
			await driver.pressTab()
			expect(await driver.evaluate('document.activeElement?.textContent?.trim()')).toBe('Skip to main content')
			await driver.clickButton('Deploy Next Missing')
			const deployedBody = await driver.waitForBodyText('1 / 14')
			expect(deployedBody).toContain('Proxy Deployer')
			expect(deployedBody).not.toContain('Failed to initialize the app environment')

			await driver.resize({ height: 844, width: 390 })
			await driver.navigate(`${baseUrl}/?workflow=pool#/security-pools?simulate=1&simScenario=security-pool`)
			await driver.waitForBodyText('Open Pool')
			await driver.clickButton('Open Pool')
			await driver.waitForBodyWithoutText('Loading vault…')
			await driver.waitForButtonEnabled('Deposit REP')
			await driver.clickButton('Deposit REP')
			await driver.waitForBodyText('REP COLLATERAL AMOUNT')
			await driver.setInputByLabel('REP Collateral Amount', '1')
			let depositReady = false
			for (let attempt = 0; attempt < 600 && !depositReady; attempt += 1) {
				const readiness = await driver.evaluate(
					`(() => { const dialog = document.querySelector('[role="dialog"]'); const buttons = [...(dialog?.querySelectorAll('button') ?? [])]; const deposit = buttons.find(candidate => candidate.textContent?.trim() === 'Deposit REP'); const approval = buttons.find(candidate => candidate.textContent?.trim().startsWith('Approve ') && !candidate.disabled); if (approval instanceof HTMLButtonElement) approval.click(); return deposit instanceof HTMLButtonElement && !deposit.disabled })()`,
				)
				depositReady = readiness === true
				if (!depositReady) await Bun.sleep(50)
			}
			expect(depositReady).toBe(true)
			const failureInjected = await driver.evaluate(
				`(() => { const workers = window.__zoltarProductionWorkers; const worker = Array.isArray(workers) ? workers.at(-1) : undefined; if (!(worker instanceof Worker)) return false; const original = worker.postMessage.bind(worker); Object.defineProperty(worker, 'postMessage', { configurable: true, value: (...args) => { const message = args[0]; if (message?.type === 'rpc' && message?.method === 'eth_sendTransaction') { Object.defineProperty(worker, 'postMessage', { configurable: true, value: original }); throw new Error('Injected production workflow failure') } return original(...args) } }); return true })()`,
			)
			expect(failureInjected).toBe(true)
			await driver.clickButton('Deposit REP', 1)
			const failedBody = await driver.waitForBodyText('Injected production workflow failure')
			expect(failedBody).toContain('FAILED')
			expect(failedBody).toContain('Deposit Rep')
			await driver.waitForButtonEnabled('Deposit REP', 1)
			await driver.clickButton('Deposit REP', 1)
			const poolBody = await driver.waitForBodyText('Deposit Rep completed successfully.')
			expect(poolBody).toContain('Manage Pool')

			await driver.resize({ height: 900, width: 1440 })
			await driver.navigate(`${baseUrl}/?workflow=reporting#/security-pools?simulate=1&simScenario=securitypoolx2`)
			await driver.waitForBodyText('Open Pool')
			await driver.clickButton('+1 year')
			const reportingPoolOpened = await driver.evaluate(
				`(() => { const card = [...document.querySelectorAll('article.security-pool-card')].find(candidate => candidate.textContent?.includes('Will this resolve? (securitypoolx2 #1)')); const button = [...(card?.querySelectorAll('button') ?? [])].find(candidate => candidate.textContent?.trim() === 'Open Pool'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()`,
			)
			expect(reportingPoolOpened).toBe(true)
			await driver.waitForBodyWithoutText('Loading vault…')
			await driver.waitForButtonEnabled('Deposit REP')
			await driver.clickButton('Deposit REP')
			await driver.waitForBodyText('REP COLLATERAL AMOUNT')
			await driver.setInputByLabel('REP Collateral Amount', '20000000')
			let reportingDepositReady = false
			for (let attempt = 0; attempt < 600 && !reportingDepositReady; attempt += 1) {
				const readiness = await driver.evaluate(
					`(() => { const dialog = document.querySelector('[role="dialog"]'); const buttons = [...(dialog?.querySelectorAll('button') ?? [])]; const deposit = buttons.find(candidate => candidate.textContent?.trim() === 'Deposit REP'); const approval = buttons.find(candidate => candidate.textContent?.trim().startsWith('Approve ') && !candidate.disabled); if (approval instanceof HTMLButtonElement) approval.click(); return deposit instanceof HTMLButtonElement && !deposit.disabled })()`,
				)
				reportingDepositReady = readiness === true
				if (!reportingDepositReady) await Bun.sleep(50)
			}
			expect(reportingDepositReady).toBe(true)
			await driver.clickButton('Deposit REP', 1)
			await driver.waitForBodyText('Deposit Rep completed successfully.')
			await driver.clickButton('Open Oracle')
			await driver.waitForButtonEnabled('Request New Price')
			await driver.clickButton('Request New Price')
			await driver.waitForBodyText('Price Requested')
			await driver.clickButton('+1 day')
			await driver.waitForButtonEnabled('Refresh Oracle')
			await driver.clickButton('Refresh Oracle')
			await driver.waitForBodyText('PENDING REQUEST')
			const pendingReportOpened = await driver.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim().startsWith('Report #')); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()`)
			expect(pendingReportOpened).toBe(true)
			await driver.waitForButtonEnabled('Settle Report')
			await driver.clickButton('Settle Report')
			await driver.waitForButtonEnabled('Settle Report', 1)
			await driver.clickButton('Settle Report', 1)
			await driver.waitForBodyText('Settle completed successfully.')
			const reportingPoolsOpened = await driver.evaluate(`(() => { const target = [...document.querySelectorAll('a, button')].find(candidate => candidate.textContent?.trim() === 'Security Pools'); if (!(target instanceof HTMLElement)) return false; target.click(); return true })()`)
			expect(reportingPoolsOpened).toBe(true)
			await driver.waitForButtonEnabled('Reporting')
			await driver.clickButton('Reporting')
			await driver.waitForBodyText('Report Outcome')

			const selectReportingOutcome = async (outcome: 'Yes' | 'No') => {
				let selected = false
				for (let attempt = 0; attempt < 100 && !selected; attempt += 1) {
					selected =
						(await driver.evaluate(
							`(() => { const radio = [...document.querySelectorAll('[role="radio"]')].find(candidate => candidate.querySelector('.panel-label')?.textContent?.trim() === ${JSON.stringify(outcome)}); if (!(radio instanceof HTMLButtonElement) || radio.disabled) return false; radio.click(); return true })()`,
						)) === true
					if (!selected) await Bun.sleep(50)
				}
				if (!selected) {
					const reportingState = await driver.evaluate(`JSON.stringify({ body: document.body?.innerText ?? '', radios: [...document.querySelectorAll('[role="radio"]')].map(radio => ({ disabled: radio.disabled, label: radio.textContent?.trim() })) })`)
					throw new Error(`Unable to select ${outcome} reporting outcome: ${String(reportingState)}`)
				}
				await driver.waitForButtonEnabled('Max')
				await driver.clickButton('Max')
				await driver.waitForButtonEnabled(`Report ${outcome}`)
				await driver.clickButton(`Report ${outcome}`)
			}

			await selectReportingOutcome('Yes')
			await driver.waitForBodyText('Your selected REP was committed to the chosen escalation side.')
			await selectReportingOutcome('No')
			await driver.waitForButtonEnabled('Trigger Zoltar Fork')
			await driver.clickButton('Trigger Zoltar Fork')
			await driver.waitForButtonEnabled('Open Fork & Migration')
			await driver.clickButton('Open Fork & Migration')
			await driver.waitForBodyText('Fork & Migration')

			const marketsOpened = await driver.evaluate(`(() => { const target = [...document.querySelectorAll('a, button')].find(candidate => candidate.textContent?.trim() === 'Markets'); if (!(target instanceof HTMLElement)) return false; target.click(); return true })()`)
			expect(marketsOpened).toBe(true)
			const missingUniverseOpened = await driver.evaluate(
				`(() => { const [route, search = ''] = window.location.hash.split('?'); const params = new URLSearchParams(search); params.set('universe', '999999'); window.history.pushState({}, '', route + '?' + params.toString()); window.dispatchEvent(new PopStateEvent('popstate')); return true })()`,
			)
			expect(missingUniverseOpened).toBe(true)
			await driver.waitForButtonEnabled('Go to Genesis universe')
			await driver.clickButton('Go to Genesis universe')
			await driver.waitForBodyText('Forked')
			await driver.waitForBodyText('Child Universes')
			await driver.waitForButtonEnabled('Create child universe', 1)
			await driver.clickButton('Create child universe', 1)
			await driver.waitForBodyText('Create Child Universe')
			await driver.waitForButtonEnabled('Deploy Universe')
			await driver.clickButton('Deploy Universe')
			await driver.waitForBodyText('Child Universe Deployed')

			const poolsOpened = await driver.evaluate(`(() => { const target = [...document.querySelectorAll('a, button')].find(candidate => candidate.textContent?.trim() === 'Security Pools'); if (!(target instanceof HTMLElement)) return false; target.click(); return true })()`)
			expect(poolsOpened).toBe(true)
			await driver.waitForButtonEnabled('Migrate Pool To Yes Universe')
			await driver.clickButton('Migrate Pool To Yes Universe')
			await driver.waitForBodyText('Pool-level REP was migrated into the selected child universe.')
			await driver.waitForButtonEnabled('Migrate Vault To Yes')
			await driver.clickButton('Migrate Vault To Yes')
			await driver.waitForBodyText('Vault REP collateral and security-bond allowance were migrated into the selected child universe.')

			await driver.resize({ height: 900, width: 1440 })
			await driver.navigate(`${baseUrl}/?workflow=auction#/security-pools?simulate=1&simScenario=securitypoolx2-auction`)
			await driver.waitForBodyText('Open Pool')
			await driver.clickButton('+1 month')
			const auctionPoolOpened = await driver.evaluate(
				`(() => { const card = [...document.querySelectorAll('article.security-pool-card')].find(candidate => candidate.textContent?.toLowerCase().includes('truth auction')); const button = [...(card?.querySelectorAll('button') ?? [])].find(candidate => candidate.textContent?.trim() === 'Open Pool'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()`,
			)
			expect(auctionPoolOpened).toBe(true)
			const auctionPoolBody = await driver.waitForBodyText('Fork & Migration')
			if (auctionPoolBody.includes('Universe Mismatch')) {
				const childUniverseOpened = await driver.evaluate(`(() => { const link = document.querySelector('section.tone-critical a.universe-link'); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true })()`)
				expect(childUniverseOpened).toBe(true)
			}
			await driver.waitForBodyWithoutText('Universe Mismatch')
			const forkViewOpened = await driver.evaluate(
				`(() => { const [route, search = ''] = window.location.hash.split('?'); const params = new URLSearchParams(search); params.set('selectedPoolView', 'fork-workflow'); params.set('securityPoolsView', 'operate'); window.history.pushState({}, '', route + '?' + params.toString()); window.dispatchEvent(new PopStateEvent('popstate')); return true })()`,
			)
			expect(forkViewOpened).toBe(true)
			await driver.waitForButtonEnabled('Finalize Truth Auction')
			await driver.clickButton('Finalize Truth Auction')
			const finalizedBody = await driver.waitForBodyText('Finalize Truth Auction completed successfully.')
			expect(finalizedBody).toContain('Truth Auction')
		}),
	)
	if (typeof state !== 'object' || state === null || !('body' in state) || typeof state.body !== 'string') throw new Error('Production workflow returned invalid document state')
	expect(state.body).toContain('Finalize Truth Auction')
	expect(state.height).toBe(900)
	expect(state.width).toBe(1440)
})
