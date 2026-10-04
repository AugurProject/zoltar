import { resolveDevServerPort } from './devServerPort.mts'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'
import { type ChromiumLaunchOptions, type ChromiumViewport, launchChromium, type WaitForOptions } from './chromiumDevTools.mts'
import { parseUiAppIdFromProcess, type UiAppId } from './appPaths.mts'

const MOUNT_TIMEOUT_MILLISECONDS = 120_000

type PageIssue = {
	readonly kind: 'pageerror' | 'console-error' | 'import-map' | 'request-failed' | 'worker' | 'mount'
	readonly detail: string
}

type NetworkRequest = { readonly resourceType: string; readonly url: string }

type BrowserSmokeState = {
	body: string
	height: number
	hasMain: boolean
	readyState: DocumentReadyState
	title: string
	width: number
}

export function isBrowserSmokeReady(state: BrowserSmokeState, applicationTitle: string, readyText: string | undefined, viewport: { readonly height: number; readonly width: number }) {
	const normalizedBody = state.body.toLocaleLowerCase()
	const includesText = (text: string) => normalizedBody.includes(text.toLocaleLowerCase())
	const explicitReadyStateReached = readyText !== undefined && includesText(readyText)
	return (
		state.hasMain &&
		state.readyState === 'complete' &&
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

export async function createDevToolsSession(chromiumPath: string, pageUrl: string, viewport: ChromiumViewport, options: Omit<ChromiumLaunchOptions, 'path' | 'profilePrefix' | 'target' | 'viewport'> = {}) {
	const page = await launchChromium({ ...options, path: chromiumPath, profilePrefix: 'zoltar-browser-smoke-', viewport })
	const { send } = page
	const issues: PageIssue[] = []
	const networkRequests = new Map<string, NetworkRequest>()
	const workerTargets = new Map<string, string>()
	let lastNetworkActivity = Date.now()
	let workerStarted = false
	page.socket.addEventListener('message', event => {
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
					if (targetInfo.targetId !== undefined) workerTargets.set(targetInfo.targetId, targetInfo.url || 'unknown worker URL')
				}
			}
			if (method === 'Target.attachedToTarget') {
				const childSessionId = params?.['sessionId']
				const targetInfo = params?.['targetInfo'] as { targetId?: string; type?: string; url?: string } | undefined
				if (typeof childSessionId === 'string' && (targetInfo?.type === 'worker' || targetInfo?.type === 'service_worker')) {
					workerStarted = true
					if (targetInfo.targetId !== undefined) workerTargets.set(targetInfo.targetId, targetInfo.url || 'unknown worker URL')
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

	return { close: page.close, evaluate: page.evaluate, getLastNetworkActivity: () => lastNetworkActivity, hasWorkerStarted: () => workerStarted, issues, pageUrl, send, waitFor: page.waitFor }
}

export type DevToolsSession = Awaited<ReturnType<typeof createDevToolsSession>>

/** Opens `pageUrl` at `viewport` in a fresh Chromium session with the Runtime and Page domains enabled, runs `run`, and closes the browser. */
export async function withBrowserPage<TValue>(pageUrl: string, viewport: ChromiumViewport, run: (session: DevToolsSession) => Promise<TValue>, evaluationDefaults: WaitForOptions = {}): Promise<TValue> {
	const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? getChromiumPath() ?? '/usr/bin/chromium', pageUrl, viewport, { evaluationDefaults })
	try {
		await session.send('Runtime.enable')
		await session.send('Page.enable')
		await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
		await session.send('Page.navigate', { url: pageUrl })
		return await run(session)
	} finally {
		await session.close()
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
	const simulationScenario = process.env['UI_SIMULATION_SCENARIO'] ?? (appId === 'trading' ? 'trading-funded' : 'baseline')
	const pageUrl = `${baseUrl.replace(/\/$/, '')}/?simulate=1&simScenario=${encodeURIComponent(simulationScenario)}${route}`
	const viewport = parseViewport(process.env['UI_VIEWPORT'])
	const session = await createDevToolsSession(chromiumPath, pageUrl, viewport)
	try {
		const { send, issues } = session
		const applicationTitles: Record<UiAppId, string> = { statoblast: 'Augur Statoblast', trading: 'Statoblast Trading', zoltar: 'Zoltar' }
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
				expression: `JSON.stringify({ body: document.body?.innerText ?? '', height: window.innerHeight, hasMain: document.querySelector('main') !== null, readyState: document.readyState, title: document.title, width: window.innerWidth })`,
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
	const explicitBaseUrl = process.env['UI_DEV_SERVER_URL']
	if (explicitBaseUrl === undefined) {
		throw new Error(`Set UI_DEV_SERVER_URL to the running ${appId} dev server base URL (expected http://localhost:${resolveDevServerPort(appId)} from bun run app:serve:${appId}).`)
	}
	await runBrowserSmoke(appId, explicitBaseUrl)
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}
