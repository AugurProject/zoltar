import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import { getChromiumPath } from './chromiumPath.js'
import { getUiAppPaths, parseUiAppIdFromProcess, type UiAppId } from './appPaths.mts'

const SIMULATION_SCENARIO = 'baseline'
const MOUNT_TIMEOUT_MILLISECONDS = 120_000

type PageIssue = {
	readonly kind: 'pageerror' | 'console-error' | 'import-map' | 'request-failed' | 'mount'
	readonly detail: string
}

type ChromiumCommand = (method: string, params?: Record<string, unknown>) => Promise<unknown>

async function createDevToolsSession(chromiumPath: string, pageUrl: string) {
	const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'zoltar-browser-smoke-'))
	const browser = spawn(chromiumPath, ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profilePath}`, '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
	let stderrData = ''
	browser.stderr.on('data', chunk => {
		stderrData += String(chunk)
	})
	let devToolsPort: number | undefined
	for (let attempt = 0; attempt < 300; attempt++) {
		try {
			devToolsPort = Number((await fs.readFile(path.join(profilePath, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
			break
		} catch {
			await Bun.sleep(50)
		}
	}
	if (devToolsPort === undefined) {
		browser.kill()
		await new Promise(resolve => browser.once('exit', resolve))
		throw new Error(`Chromium DevTools port did not open. stderr: ${stderrData.trim()}`)
	}

	const issues: PageIssue[] = []
	let requestId = 0
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	const socket = await (async () => {
		for (let attempt = 0; attempt < 200; attempt++) {
			try {
				const targets = (await (await fetch(`http://127.0.0.1:${devToolsPort}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>
				const page = targets.find(target => target.type === 'page')
				if (page !== undefined) {
					const ws = new WebSocket(page.webSocketDebuggerUrl)
					await new Promise((resolve, reject) => {
						ws.addEventListener('open', resolve, { once: true })
						ws.addEventListener('error', reject, { once: true })
					})
					return ws
				}
			} catch {
				// Chromium target list not ready yet.
			}
			await Bun.sleep(50)
		}
		throw new Error('Could not connect to the Chromium page target')
	})()

	socket.addEventListener('message', event => {
		if (typeof event.data !== 'string') return
		const message: unknown = JSON.parse(event.data)
		if (typeof message !== 'object' || message === null) return
		if ('method' in message) {
			const { method, params } = message as { method: string; params?: Record<string, unknown> }
			if (method === 'Runtime.exceptionThrown') {
				const exceptionDetails = params?.['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined
				issues.push({ kind: 'pageerror', detail: exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unknown page error' })
			}
			if (method === 'Runtime.consoleAPICalled' && params?.['type'] === 'error') {
				const args = (params['args'] as Array<{ value?: unknown; description?: string }> | undefined) ?? []
				issues.push({ kind: 'console-error', detail: args.map(arg => String(arg.value ?? arg.description ?? '')).join(' ') || 'console.error()' })
			}
			if (method === 'Network.loadingFailed') {
				const blockedReason = params?.['errorText']
				issues.push({ kind: 'request-failed', detail: String(blockedReason ?? 'request failed') })
			}
			return
		}
		if (!('id' in message) || typeof message.id !== 'number') return
		const pendingRequest = pending.get(message.id)
		if (pendingRequest === undefined) return
		pending.delete(message.id)
		if ('error' in message) pendingRequest.reject(new Error(`Chromium DevTools command failed: ${JSON.stringify(message.error)}`))
		else pendingRequest.resolve('result' in message ? message.result : undefined)
	})

	const send: ChromiumCommand = async (method, params = {}) => {
		requestId += 1
		const id = requestId
		const response = new Promise<unknown>((resolve, reject) => pending.set(id, { reject, resolve }))
		socket.send(JSON.stringify({ id, method, params }))
		return await response
	}

	const close = async () => {
		socket.close()
		browser.kill()
		await new Promise(resolve => browser.once('exit', resolve))
		await fs.rm(profilePath, { force: true, recursive: true })
	}

	return { close, issues, send, pageUrl }
}

async function runSmoke(appId: UiAppId, baseUrl: string) {
	const chromiumPath = getChromiumPath()
	if (chromiumPath === undefined) throw new Error('Chromium is required for the browser smoke check. Set CHROMIUM_PATH or install Chromium.')
	const pageUrl = `${baseUrl.replace(/\/$/, '')}/?simulate=1&simScenario=${SIMULATION_SCENARIO}`
	const session = await createDevToolsSession(chromiumPath, pageUrl)
	try {
		const { send, issues } = session
		await send('Runtime.enable')
		await send('Page.enable')
		await send('Network.enable')
		await send('Page.navigate', { url: pageUrl })

		const start = Date.now()
		let mounted = false
		while (Date.now() - start < MOUNT_TIMEOUT_MILLISECONDS) {
			const result = (await send('Runtime.evaluate', {
				expression: `JSON.stringify({ body: document.body?.innerText ?? '', hasMain: document.querySelector('main') !== null, title: document.title })`,
				returnByValue: true,
			})) as { result?: { value?: string } }
			const raw = result.result?.value
			if (typeof raw === 'string') {
				const state = JSON.parse(raw) as { body: string; hasMain: boolean; title: string }
				if (state.hasMain && state.body !== '' && state.body !== 'Loading...' && !state.body.includes('BOOTSTRAPPING') && !state.body.includes('Starting simulation bootstrap')) {
					mounted = true
					break
				}
			}
			await Bun.sleep(100)
		}
		if (!mounted) issues.push({ kind: 'mount', detail: `The ${appId} application root did not mount within ${(MOUNT_TIMEOUT_MILLISECONDS / 1000).toFixed(0)}s at ${pageUrl}` })

		// Import-map errors surface as page errors; surface anything that mentions import maps clearly.
		const failures = issues.filter(issue => issue.kind !== 'request-failed' || !issue.detail.includes('net::ERR_ABORTED'))
		if (failures.length > 0) {
			const summary = failures.map(issue => `  - [${issue.kind}] ${issue.detail}`).join('\n')
			throw new Error(`Browser smoke check failed for ${appId} at ${pageUrl}:\n${summary}`)
		}
		console.log(`[browser-smoke] ${appId} mounted cleanly at ${pageUrl}`)
	} finally {
		await session.close()
	}
}

async function main() {
	const appId = parseUiAppIdFromProcess('the browser smoke check')
	const paths = getUiAppPaths(appId)
	void paths
	const ports: Record<UiAppId, number> = { statoblast: 12347, zoltar: 12346 }
	const explicitBaseUrl = process.env['UI_DEV_SERVER_URL']
	if (appId !== undefined && explicitBaseUrl === undefined) {
		throw new Error(`Set UI_DEV_SERVER_URL to the running ${appId} dev server base URL (expected http://localhost:${ports[appId]} from bun run app:serve:${appId}).`)
	}
	await runSmoke(appId, explicitBaseUrl ?? `http://localhost:${ports[appId]}`)
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}
