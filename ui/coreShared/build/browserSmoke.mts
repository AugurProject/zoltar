import { type ChildProcess, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'
import { waitForChromiumDevToolsPort } from './chromiumDevTools.mts'
import { getUiAppPaths, parseUiAppIdFromProcess, type UiAppId } from './appPaths.mts'

const MOUNT_TIMEOUT_MILLISECONDS = 120_000
const DEVTOOLS_COMMAND_TIMEOUT_MILLISECONDS = 15_000
const DEVTOOLS_INITIALIZATION_TIMEOUT_MILLISECONDS = 60_000
const BROWSER_TERMINATION_TIMEOUT_MILLISECONDS = 2_000

type PageIssue = {
	readonly kind: 'pageerror' | 'console-error' | 'import-map' | 'request-failed' | 'worker' | 'mount'
	readonly detail: string
}

type NetworkRequest = { readonly resourceType: string; readonly url: string }

type ChromiumCommand = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>
type ChromiumCommandSocket = EventTarget & { send(data: string): void }

type BrowserSmokeState = {
	body: string
	height: number
	hasMain: boolean
	title: string
	width: number
}

const transientDevToolsConnectionErrorCodes = new Set(['ConnectionRefused', 'ConnectionReset', 'ECONNREFUSED', 'ECONNRESET'])

const isTransientDevToolsConnectionError = (error: unknown): boolean => {
	const visited = new Set<unknown>()
	let current = error
	while (typeof current === 'object' && current !== null && !visited.has(current)) {
		visited.add(current)
		if ('code' in current && typeof current.code === 'string' && transientDevToolsConnectionErrorCodes.has(current.code)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export async function waitForBrowserExit(browser: ChildProcess): Promise<void> {
	if (browser.exitCode !== null || browser.signalCode !== null) return
	await new Promise<void>((resolve, reject) => {
		browser.once('error', reject)
		browser.once('exit', () => resolve())
	})
}

type BrowserExitOutcome = { readonly exited: boolean; readonly processError?: Error }

const waitForBrowserExitWithin = async (browser: ChildProcess, timeoutMilliseconds: number): Promise<BrowserExitOutcome> => {
	if (browser.exitCode !== null || browser.signalCode !== null || browser.pid === undefined) return { exited: true }
	return await new Promise(resolve => {
		let processError: Error | undefined
		const finish = (exited: boolean) => {
			clearTimeout(timeoutId)
			browser.off('error', handleProcessError)
			browser.off('exit', handleTermination)
			resolve({ exited, ...(processError === undefined ? {} : { processError }) })
		}
		const handleTermination = () => finish(true)
		const handleProcessError = (error: Error) => {
			processError = error
		}
		const timeoutId = setTimeout(() => finish(false), timeoutMilliseconds)
		browser.on('error', handleProcessError)
		browser.once('exit', handleTermination)
	})
}

const signalBrowserAndWait = async (browser: ChildProcess, signal: NodeJS.Signals, timeoutMilliseconds: number): Promise<BrowserExitOutcome> => {
	const exitOutcome = waitForBrowserExitWithin(browser, timeoutMilliseconds)
	browser.kill(signal)
	return await exitOutcome
}

export async function terminateBrowserProcess(
	browser: ChildProcess,
	profilePath: string,
	{ forceTimeoutMilliseconds = BROWSER_TERMINATION_TIMEOUT_MILLISECONDS, gracefulTimeoutMilliseconds = BROWSER_TERMINATION_TIMEOUT_MILLISECONDS }: { readonly forceTimeoutMilliseconds?: number; readonly gracefulTimeoutMilliseconds?: number } = {},
): Promise<void> {
	try {
		if (browser.exitCode !== null || browser.signalCode !== null || browser.pid === undefined) return
		const gracefulOutcome = await signalBrowserAndWait(browser, 'SIGTERM', gracefulTimeoutMilliseconds)
		if (gracefulOutcome.exited) return
		const forceOutcome = await signalBrowserAndWait(browser, 'SIGKILL', forceTimeoutMilliseconds)
		if (!forceOutcome.exited) {
			const processError = forceOutcome.processError ?? gracefulOutcome.processError
			throw new Error(`Chromium did not exit after SIGKILL within ${forceTimeoutMilliseconds.toString()}ms${processError === undefined ? '' : `: ${processError.message}`}`)
		}
	} finally {
		await fs.rm(profilePath, { force: true, recursive: true })
	}
}

const awaitInitializationStep = async <TValue,>(browser: ChildProcess, deadline: number, description: string, action: () => Promise<TValue>, cancel: () => void): Promise<TValue> => {
	const remainingMilliseconds = deadline - Date.now()
	if (remainingMilliseconds <= 0) {
		cancel()
		throw new Error(`Chromium initialization timed out while ${description}`)
	}
	let completed = false
	let succeeded = false
	try {
		const value = await new Promise<TValue>((resolve, reject) => {
			const finish = (result: { readonly error: Error } | { readonly value: TValue }) => {
				if (completed) return
				completed = true
				clearTimeout(timeoutId)
				browser.off('error', handleError)
				browser.off('exit', handleExit)
				if ('error' in result) reject(result.error)
				else resolve(result.value)
			}
			const handleError = (error: Error) => finish({ error: new Error(`Chromium failed while ${description}: ${error.message}`) })
			const handleExit = (exitCode: number | null, signalCode: NodeJS.Signals | null) => finish({ error: new Error(`Chromium exited with ${signalCode === null ? `code ${String(exitCode)}` : `signal ${signalCode}`} while ${description}`) })
			const timeoutId = setTimeout(() => finish({ error: new Error(`Chromium initialization timed out while ${description}`) }), remainingMilliseconds)
			browser.once('error', handleError)
			browser.once('exit', handleExit)
			action().then(
				value => finish({ value }),
				error => finish({ error: error instanceof Error ? error : new Error(String(error)) }),
			)
		})
		succeeded = true
		return value
	} finally {
		if (!succeeded) cancel()
	}
}

export async function waitForDevToolsPort({
	assertBrowserAvailable,
	maxAttempts,
	pollMilliseconds,
	readPort,
	readStderr,
	wait = Bun.sleep,
}: {
	readonly assertBrowserAvailable: () => void
	readonly maxAttempts?: number
	readonly pollMilliseconds: number
	readonly readPort: () => Promise<number | undefined>
	readonly readStderr?: () => string
	readonly wait?: (milliseconds: number) => Promise<unknown>
}): Promise<number | undefined> {
	return await waitForChromiumDevToolsPort({
		assertBrowserAvailable,
		...(maxAttempts === undefined ? {} : { maxAttempts }),
		pollMilliseconds,
		readPort,
		...(readStderr === undefined ? {} : { readStderr }),
		wait,
	})
}

export function createBrowserSmokeCommandSender(socket: ChromiumCommandSocket, browser: ChildProcess, timeoutMilliseconds = DEVTOOLS_COMMAND_TIMEOUT_MILLISECONDS): ChromiumCommand {
	let requestId = 0
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	const rejectPending = (message: string) => {
		for (const request of pending.values()) request.reject(new Error(message))
		pending.clear()
	}

	socket.addEventListener('message', event => {
		if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return
		const message: unknown = JSON.parse(event.data)
		if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'number') return
		const request = pending.get(message.id)
		if (request === undefined) return
		pending.delete(message.id)
		if ('error' in message) request.reject(new Error(`Chromium DevTools command failed: ${JSON.stringify(message.error)}`))
		else request.resolve('result' in message ? message.result : undefined)
	})
	socket.addEventListener('close', () => rejectPending('Chromium DevTools connection closed while commands were pending'))
	socket.addEventListener('error', () => rejectPending('Chromium DevTools connection failed while commands were pending'))
	browser.once('exit', (exitCode, signalCode) => rejectPending(`Chromium exited with ${signalCode === null ? `code ${String(exitCode)}` : `signal ${signalCode}`} while commands were pending`))

	return async (method, params = {}, sessionId) => {
		if (browser.exitCode !== null || browser.signalCode !== null) throw new Error(`Chromium already exited before DevTools command ${method}`)
		requestId += 1
		const id = requestId
		return await new Promise<unknown>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				pending.delete(id)
				reject(new Error(`Chromium DevTools command ${method} did not complete within ${timeoutMilliseconds.toString()}ms`))
			}, timeoutMilliseconds)
			pending.set(id, {
				reject: error => {
					clearTimeout(timeoutId)
					reject(error)
				},
				resolve: value => {
					clearTimeout(timeoutId)
					resolve(value)
				},
			})
			try {
				socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
			} catch (error) {
				pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error)))
				pending.delete(id)
			}
		})
	}
}

export function isBrowserSmokeReady(state: BrowserSmokeState, applicationTitle: string, readyText: string | undefined, viewport: { readonly height: number; readonly width: number }) {
	const normalizedBody = state.body.toLocaleLowerCase()
	const includesText = (text: string) => normalizedBody.includes(text.toLocaleLowerCase())
	const explicitReadyStateReached = readyText !== undefined && includesText(readyText)
	return (
		state.hasMain &&
		state.width === viewport.width &&
		state.height === viewport.height &&
		state.body !== '' &&
		state.body !== 'Loading...' &&
		includesText(applicationTitle) &&
		(explicitReadyStateReached || (!state.body.includes('BOOTSTRAPPING') && !state.body.includes('Starting simulation bootstrap'))) &&
		(readyText === undefined || includesText(readyText))
	)
}

function parseViewport(candidate: string | undefined) {
	const match = /^(\d+)x(\d+)$/.exec(candidate ?? '1440x900')
	if (match === null) throw new Error(`Invalid UI_VIEWPORT '${candidate ?? ''}'; expected WIDTHxHEIGHT.`)
	const width = Number(match[1])
	const height = Number(match[2])
	if (width < 1 || height < 1) throw new Error(`Invalid UI_VIEWPORT '${candidate ?? ''}'; dimensions must be positive.`)
	return { height, width }
}

export async function createDevToolsSession(
	chromiumPath: string,
	pageUrl: string,
	viewport: { readonly height: number; readonly width: number },
	{
		devToolsPortAttempts,
		initializationTimeoutMilliseconds = DEVTOOLS_INITIALIZATION_TIMEOUT_MILLISECONDS,
		pollMilliseconds = 50,
		profileParentPath = os.tmpdir(),
		targetAttempts,
		targetListRequest = async (url, signal) => (await (await fetch(url, { signal })).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>,
	}: {
		readonly devToolsPortAttempts?: number
		readonly initializationTimeoutMilliseconds?: number
		readonly pollMilliseconds?: number
		readonly profileParentPath?: string
		readonly targetAttempts?: number
		readonly targetListRequest?: (url: string, signal: AbortSignal) => Promise<Array<{ type: string; webSocketDebuggerUrl: string }>>
	} = {},
) {
	const profilePath = await fs.mkdtemp(path.join(profileParentPath, 'zoltar-browser-smoke-'))
	let browser: ChildProcess | undefined
	let socket: WebSocket | undefined
	let cleanedUp = false
	const cleanup = async () => {
		if (cleanedUp) return
		cleanedUp = true
		socket?.close()
		if (browser === undefined) await fs.rm(profilePath, { force: true, recursive: true })
		else await terminateBrowserProcess(browser, profilePath)
	}
	let stderrData = ''
	try {
		browser = spawn(chromiumPath, ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profilePath}`, `--window-size=${viewport.width.toString()},${viewport.height.toString()}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
		let launchError: Error | undefined
		browser.once('error', error => {
			launchError = error
		})
		browser.stderr?.on('data', chunk => {
			stderrData += String(chunk)
		})
		const initializationDeadline = Date.now() + initializationTimeoutMilliseconds
		const assertBrowserAvailable = (initializationPhase: string) => {
			if (launchError !== undefined) throw new Error(`Could not launch Chromium: ${launchError.message}`)
			if (browser?.exitCode !== null || browser.signalCode !== null) throw new Error(`Chromium exited before DevTools initialized. stderr: ${stderrData.trim()}`)
			if (Date.now() >= initializationDeadline) throw new Error(`Chromium initialization timed out while ${initializationPhase}`)
		}
		const devToolsPort = await waitForDevToolsPort({
			assertBrowserAvailable: () => assertBrowserAvailable('waiting for the DevTools port'),
			...(devToolsPortAttempts === undefined ? {} : { maxAttempts: devToolsPortAttempts }),
			pollMilliseconds,
			readStderr: () => stderrData,
			readPort: async () => {
				try {
					return Number((await fs.readFile(path.join(profilePath, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
				} catch (error) {
					if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
					return undefined
				}
			},
		})
		assertBrowserAvailable('waiting for the DevTools port')
		if (devToolsPort === undefined) throw new Error(`Chromium DevTools port did not open. stderr: ${stderrData.trim()}`)

		const issues: PageIssue[] = []
		const networkRequests = new Map<string, NetworkRequest>()
		const workerTargets = new Map<string, string>()
		let lastNetworkActivity = Date.now()
		let workerStarted = false
		socket = await (async () => {
			for (let attempt = 0; targetAttempts === undefined || attempt < targetAttempts; attempt++) {
				assertBrowserAvailable('waiting for the Chromium page target')
				const fetchController = new AbortController()
				let targets: Array<{ type: string; webSocketDebuggerUrl: string }>
				try {
					targets = await awaitInitializationStep(
						browser,
						initializationDeadline,
						'requesting the DevTools target list',
						() => targetListRequest(`http://127.0.0.1:${devToolsPort}/json/list`, fetchController.signal),
						() => fetchController.abort(),
					)
				} catch (error) {
					if (!isTransientDevToolsConnectionError(error)) throw error
					// Chromium target list not ready yet.
					await Bun.sleep(pollMilliseconds)
					continue
				}
				const page = targets.find(target => target.type === 'page')
				if (page !== undefined) {
					const ws = new WebSocket(page.webSocketDebuggerUrl)
					await awaitInitializationStep(
						browser,
						initializationDeadline,
						'opening the DevTools WebSocket',
						() =>
							new Promise<void>((resolve, reject) => {
								ws.addEventListener('open', () => resolve(), { once: true })
								ws.addEventListener('error', () => reject(new Error('Could not open the Chromium DevTools WebSocket')), { once: true })
							}),
						() => ws.close(),
					)
					return ws
				}
				await Bun.sleep(pollMilliseconds)
			}
			throw new Error('Could not connect to the Chromium page target')
		})()

		const send = createBrowserSmokeCommandSender(socket, browser)
		socket.addEventListener('message', event => {
			if (typeof event.data !== 'string') return
			const message: unknown = JSON.parse(event.data)
			if (typeof message !== 'object' || message === null) return
			if ('method' in message) {
				const { method, params, sessionId } = message as { method: string; params?: Record<string, unknown>; sessionId?: string }
				const networkRequestKey = (requestId: unknown) => `${sessionId ?? 'page'}:${String(requestId)}`
				if (method === 'Runtime.exceptionThrown') {
					const exceptionDetails = params?.['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined
					const detail = exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unknown page error'
					issues.push({ kind: /import.?map/i.test(detail) ? 'import-map' : 'pageerror', detail })
				}
				if (method === 'Runtime.consoleAPICalled' && params?.['type'] === 'error') {
					const args = (params['args'] as Array<{ value?: unknown; description?: string }> | undefined) ?? []
					const detail = args.map(arg => String(arg.value ?? arg.description ?? '')).join(' ') || 'console.error()'
					issues.push({ kind: /import.?map/i.test(detail) ? 'import-map' : 'console-error', detail })
				}
				if (method === 'Log.entryAdded') {
					const entry = params?.['entry'] as { level?: string; text?: string; url?: string } | undefined
					if (entry?.level === 'error') {
						const detail = `${entry.text ?? 'Browser log error'}${entry.url === undefined ? '' : ` (${entry.url})`}`
						issues.push({ kind: /import.?map/i.test(detail) ? 'import-map' : 'console-error', detail })
					}
				}
				if (method === 'Network.requestWillBeSent') {
					const requestId = params?.['requestId']
					const request = params?.['request'] as { url?: string } | undefined
					if (typeof requestId === 'string' && typeof request?.url === 'string') networkRequests.set(networkRequestKey(requestId), { resourceType: String(params?.['type'] ?? ''), url: request.url })
					lastNetworkActivity = Date.now()
				}
				if (method === 'Network.responseReceived') {
					const requestId = params?.['requestId']
					const response = params?.['response'] as { status?: number; url?: string } | undefined
					const request = typeof requestId === 'string' ? networkRequests.get(networkRequestKey(requestId)) : undefined
					const resourceType = String(params?.['type'] ?? request?.resourceType ?? '')
					const resourceUrl = response?.url ?? request?.url ?? 'unknown URL'
					if (typeof response?.status === 'number' && response.status >= 400 && isRequiredBrowserResource(resourceUrl, resourceType)) issues.push({ kind: 'request-failed', detail: `${response.status.toString()} ${resourceType || 'resource'} ${resourceUrl}` })
					lastNetworkActivity = Date.now()
				}
				if (method === 'Network.loadingFailed') {
					const requestId = params?.['requestId']
					const request = typeof requestId === 'string' ? networkRequests.get(networkRequestKey(requestId)) : undefined
					const resourceType = String(params?.['type'] ?? request?.resourceType ?? '')
					const detail = `${String(params?.['errorText'] ?? 'request failed')} ${resourceType || 'resource'} ${request?.url ?? 'unknown URL'}`
					const isBenignCanceledImage = params?.['canceled'] === true && resourceType === 'Image'
					if (!isBenignCanceledImage) issues.push({ kind: 'request-failed', detail })
					lastNetworkActivity = Date.now()
				}
				if (method === 'Target.targetCreated') {
					const targetInfo = params?.['targetInfo'] as { targetId?: string; type?: string; url?: string } | undefined
					if (targetInfo?.type === 'worker' || targetInfo?.type === 'service_worker') {
						workerStarted = true
						if (targetInfo.targetId !== undefined) workerTargets.set(targetInfo.targetId, targetInfo.url ?? 'unknown worker URL')
					}
				}
				if (method === 'Target.attachedToTarget') {
					const childSessionId = params?.['sessionId']
					const targetInfo = params?.['targetInfo'] as { targetId?: string; type?: string; url?: string } | undefined
					if (typeof childSessionId === 'string' && (targetInfo?.type === 'worker' || targetInfo?.type === 'service_worker')) {
						workerStarted = true
						if (targetInfo.targetId !== undefined) workerTargets.set(targetInfo.targetId, targetInfo.url ?? 'unknown worker URL')
						void Promise.all([send('Network.enable', {}, childSessionId), send('Log.enable', {}, childSessionId), send('Runtime.enable', {}, childSessionId)]).catch(error => {
							if (!(error instanceof Error) || !error.message.includes('Session with given id not found')) issues.push({ kind: 'worker', detail: error instanceof Error ? error.message : String(error) })
						})
					}
				}
				if (method === 'Target.targetDestroyed') {
					const targetId = params?.['targetId']
					const workerUrl = typeof targetId === 'string' ? workerTargets.get(targetId) : undefined
					if (workerUrl !== undefined) issues.push({ kind: 'worker', detail: `Worker terminated before smoke completion: ${workerUrl}` })
				}
				return
			}
		})

		return { close: cleanup, getLastNetworkActivity: () => lastNetworkActivity, hasWorkerStarted: () => workerStarted, issues, send, pageUrl }
	} catch (error) {
		await cleanup()
		throw error
	}
}

export function isRequiredBrowserResource(resourceUrl: string, resourceType: string) {
	return resourceType === 'Script' || resourceType === 'Stylesheet' || /(?:\.m?js|\.css)(?:[?#]|$)/i.test(resourceUrl) || /worker/i.test(resourceUrl)
}

async function runBrowserSmokeUnlocked(appId: UiAppId, baseUrl: string, options: { readonly mountTimeoutMilliseconds?: number; readonly requireWorker?: boolean } = {}) {
	const chromiumPath = getChromiumPath()
	if (chromiumPath === undefined) throw new Error('Chromium is required for the browser smoke check. Set CHROMIUM_PATH or install Chromium.')
	const route = process.env['UI_BROWSER_ROUTE'] ?? ''
	if (route !== '' && !route.startsWith('#')) throw new Error(`Invalid UI_BROWSER_ROUTE '${route}'; expected an empty value or a hash route.`)
	const simulationScenario = process.env['UI_SIMULATION_SCENARIO'] ?? (appId === 'trading' ? 'trading' : 'baseline')
	const pageUrl = `${baseUrl.replace(/\/$/, '')}/?simulate=1&simScenario=${encodeURIComponent(simulationScenario)}${route}`
	const viewport = parseViewport(process.env['UI_VIEWPORT'])
	const session = await createDevToolsSession(chromiumPath, pageUrl, viewport)
	try {
		const { send, issues } = session
		const applicationTitles: Record<UiAppId, string> = { statoblast: 'Augur Statoblast', trading: 'Statoblast trading', zoltar: 'Zoltar' }
		const applicationTitle = applicationTitles[appId]
		const readyText = process.env['UI_BROWSER_READY_TEXT']
		await send('Runtime.enable')
		await send('Page.enable')
		await send('Network.enable')
		await send('Log.enable')
		await send('Target.setDiscoverTargets', { discover: true })
		await send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false })
		await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: viewport.height, mobile: false, width: viewport.width })
		await send('Page.navigate', { url: pageUrl })

		const start = Date.now()
		let mounted = false
		let lastObservedState: BrowserSmokeState | undefined
		const mountTimeoutMilliseconds = options.mountTimeoutMilliseconds ?? MOUNT_TIMEOUT_MILLISECONDS
		while (Date.now() - start < mountTimeoutMilliseconds) {
			const result = (await send('Runtime.evaluate', {
				expression: `JSON.stringify({ body: document.body?.innerText ?? '', height: window.innerHeight, hasMain: document.querySelector('main') !== null, title: document.title, width: window.innerWidth })`,
				returnByValue: true,
			})) as { result?: { value?: string } }
			const raw = result.result?.value
			if (typeof raw === 'string') {
				const state = JSON.parse(raw) as BrowserSmokeState
				lastObservedState = state
				if (isBrowserSmokeReady(state, applicationTitle, readyText, viewport)) {
					mounted = true
					break
				}
			}
			await Bun.sleep(100)
		}
		if (!mounted)
			issues.push({ kind: 'mount', detail: `The ${appId} application root did not reach its expected ${applicationTitle}${readyText === undefined ? '' : ` / ${readyText}`} state within ${(mountTimeoutMilliseconds / 1000).toFixed(0)}s at ${pageUrl}. Last observed state: ${JSON.stringify(lastObservedState)}` })

		if (mounted) {
			const settleDeadline = Date.now() + Math.min(5_000, mountTimeoutMilliseconds)
			while (Date.now() < settleDeadline && (Date.now() - session.getLastNetworkActivity() < 500 || ((options.requireWorker ?? true) && !session.hasWorkerStarted()))) await Bun.sleep(100)
			if ((options.requireWorker ?? true) && !session.hasWorkerStarted()) issues.push({ kind: 'worker', detail: `No worker initialized for ${appId} at ${pageUrl}` })
		}

		const screenshotPath = process.env['UI_SCREENSHOT_PATH']
		if (screenshotPath !== undefined && screenshotPath !== '') {
			const scrollSelector = process.env['UI_SCREENSHOT_SCROLL_SELECTOR']
			if (scrollSelector !== undefined && scrollSelector !== '') {
				await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(scrollSelector)})?.scrollIntoView({ block: 'start' })` })
				await Bun.sleep(100)
			}
			const result = (await send('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true })) as { data?: unknown }
			if (typeof result.data !== 'string') throw new Error('Chromium did not return PNG screenshot data.')
			await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
			await fs.writeFile(screenshotPath, Buffer.from(result.data, 'base64'))
		}

		if (issues.length > 0) {
			const summary = issues.map(issue => `  - [${issue.kind}] ${issue.detail}`).join('\n')
			throw new Error(`Browser smoke check failed for ${appId} at ${pageUrl}:\n${summary}`)
		}
		console.log(`[browser-smoke] ${appId} mounted cleanly at ${pageUrl} (${viewport.width.toString()}x${viewport.height.toString()})`)
	} finally {
		await session.close()
	}
}

export async function runBrowserSmoke(appId: UiAppId, baseUrl: string, options: { readonly mountTimeoutMilliseconds?: number; readonly requireWorker?: boolean } = {}) {
	await withChromiumTestLock(async () => await runBrowserSmokeUnlocked(appId, baseUrl, options))
}

async function main() {
	const appId = parseUiAppIdFromProcess('the browser smoke check')
	const paths = getUiAppPaths(appId)
	void paths
	const ports: Record<UiAppId, number> = { statoblast: 12347, trading: 4163, zoltar: 4153 }
	const explicitBaseUrl = process.env['UI_DEV_SERVER_URL']
	if (appId !== undefined && explicitBaseUrl === undefined) {
		throw new Error(`Set UI_DEV_SERVER_URL to the running ${appId} dev server base URL (expected http://localhost:${ports[appId]} from bun run app:serve:${appId}).`)
	}
	await runBrowserSmoke(appId, explicitBaseUrl ?? `http://localhost:${ports[appId]}`)
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}
