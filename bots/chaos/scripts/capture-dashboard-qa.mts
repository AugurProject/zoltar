import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

type CdpMessage = {
	error: { message?: string } | undefined
	id: number | undefined
	method: string | undefined
	params: unknown
	result: unknown
}

type CaptureRequest = {
	height: number
	horizontalScroll?: 'catalog-end' | undefined
	name: string
	route: string
	verticalScroll?: 'rpc-health' | undefined
	width: number
}

const outputDirectory = resolve(import.meta.dir, '..', '.state', 'qa')
await mkdir(outputDirectory, { recursive: true })
const requestedCaptureSource = process.argv[2]
if (requestedCaptureSource === undefined) {
	const captures: CaptureRequest[] = [
		{ height: 900, name: 'chaos-overview-desktop', route: 'overview', width: 1_440 },
		{ height: 900, name: 'chaos-catalog-desktop', route: 'catalog', width: 1_440 },
		{ height: 900, name: 'chaos-ecosystem-desktop', route: 'ecosystem', width: 1_440 },
		{ height: 844, name: 'chaos-overview-mobile', route: 'overview', width: 390 },
		{ height: 844, name: 'chaos-overview-mobile-rpc-health', route: 'overview', verticalScroll: 'rpc-health', width: 390 },
		{ height: 844, name: 'chaos-catalog-mobile', route: 'catalog', width: 390 },
		{ height: 844, horizontalScroll: 'catalog-end', name: 'chaos-catalog-mobile-details', route: 'catalog', width: 390 },
		{ height: 844, name: 'chaos-activity-mobile', route: 'activity', width: 390 },
		{ height: 844, name: 'chaos-settings-mobile', route: 'settings', width: 390 },
	]
	for (const capture of captures) {
		const child = Bun.spawn([process.execPath, import.meta.path, JSON.stringify(capture)], { stderr: 'pipe', stdout: 'pipe' })
		const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		if (exitCode !== 0) throw new Error(`Dashboard capture ${capture.name} failed: ${stderr}`)
		process.stdout.write(stdout)
	}
	process.exit(0)
}

function parseCaptureRequest(value: string): CaptureRequest {
	const parsed: unknown = JSON.parse(value)
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Capture request must be an object')
	const height = Reflect.get(parsed, 'height')
	const horizontalScroll = Reflect.get(parsed, 'horizontalScroll')
	const name = Reflect.get(parsed, 'name')
	const route = Reflect.get(parsed, 'route')
	const verticalScroll = Reflect.get(parsed, 'verticalScroll')
	const width = Reflect.get(parsed, 'width')
	if (typeof height !== 'number' || (horizontalScroll !== undefined && horizontalScroll !== 'catalog-end') || typeof name !== 'string' || typeof route !== 'string' || (verticalScroll !== undefined && verticalScroll !== 'rpc-health') || typeof width !== 'number') throw new Error('Capture request fields are invalid')
	return { height, horizontalScroll, name, route, verticalScroll, width }
}

const requestedCapture = parseCaptureRequest(requestedCaptureSource)
const chromium = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium'
const dashboardPassword = 'dashboard visual fixture password'
const browserProfileDirectory = await mkdtemp(resolve(tmpdir(), 'chaos-dashboard-qa-'))
const browser = Bun.spawn(
	[
		chromium,
		'--headless=new',
		'--no-sandbox',
		'--disable-background-timer-throttling',
		'--disable-dev-shm-usage',
		'--disable-gpu',
		'--disable-renderer-backgrounding',
		'--force-device-scale-factor=1',
		'--hide-scrollbars',
		'--run-all-compositor-stages-before-draw',
		'--remote-debugging-port=9393',
		`--user-data-dir=${browserProfileDirectory}`,
		`--window-size=${requestedCapture.width.toString()},${requestedCapture.height.toString()}`,
		'about:blank',
	],
	{ stderr: 'pipe', stdout: 'pipe' },
)

try {
	let tabs: unknown
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response: unknown = await fetch('http://127.0.0.1:9393/json/list').then(value => value.json())
			if (Array.isArray(response) && response.length > 0) {
				tabs = response
				break
			}
		} catch (error) {
			void error
		}
		await Bun.sleep(100)
	}
	if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('Chromium debugging tab did not become available')
	const tab = tabs[0]
	if (typeof tab !== 'object' || tab === null || Array.isArray(tab)) throw new Error('Chromium returned an invalid tab')
	const debuggerUrl = Reflect.get(tab, 'webSocketDebuggerUrl')
	if (typeof debuggerUrl !== 'string') throw new Error('Chromium tab is missing a debugger URL')
	const socket = new WebSocket(debuggerUrl)
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	const diagnostics: string[] = []
	let requestId = 0
	socket.addEventListener('message', event => {
		const parsed: unknown = JSON.parse(String(event.data))
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
		const parsedId = Reflect.get(parsed, 'id')
		const parsedMethod = Reflect.get(parsed, 'method')
		const message: CdpMessage = {
			error: typeof Reflect.get(parsed, 'error') === 'object' && Reflect.get(parsed, 'error') !== null ? { message: String(Reflect.get(Reflect.get(parsed, 'error'), 'message') ?? '') } : undefined,
			id: typeof parsedId === 'number' ? parsedId : undefined,
			method: typeof parsedMethod === 'string' ? parsedMethod : undefined,
			params: Reflect.get(parsed, 'params'),
			result: Reflect.get(parsed, 'result'),
		}
		if (message.id !== undefined) {
			const callback = pending.get(message.id)
			if (callback === undefined) return
			pending.delete(message.id)
			if (message.error === undefined) callback.resolve(message.result)
			else callback.reject(new Error(message.error.message ?? 'CDP command failed'))
		} else if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') diagnostics.push(JSON.stringify(message.params) ?? 'Unknown browser diagnostic')
	})
	await new Promise<void>((resolvePromise, reject) => {
		socket.addEventListener('open', () => resolvePromise(), { once: true })
		socket.addEventListener('error', () => reject(new Error('Chromium debugger connection failed')), { once: true })
	})
	const command = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<unknown>((resolvePromise, reject) => {
			requestId += 1
			pending.set(requestId, { reject, resolve: resolvePromise })
			const body = JSON.stringify({ id: requestId, method, params })
			if (body === undefined) throw new Error('CDP command was not serializable')
			socket.send(body)
		})
	await command('Runtime.enable')
	await command('Log.enable')
	await command('Page.enable')
	await command('Page.bringToFront')
	await command('Network.enable')
	await command('Network.setExtraHTTPHeaders', { headers: { Authorization: `Basic ${Buffer.from(`operator:${dashboardPassword}`).toString('base64')}` } })

	const evaluate = async (expression: string) => {
		const response = await command('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
		if (typeof response !== 'object' || response === null || Array.isArray(response)) throw new Error('Runtime evaluation returned an invalid response')
		const result = Reflect.get(response, 'result')
		if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Runtime evaluation omitted its result')
		return Reflect.get(result, 'value')
	}

	const capture = async ({ height, horizontalScroll, name, route, verticalScroll, width }: CaptureRequest) => {
		await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width })
		await command('Page.navigate', { url: `http://127.0.0.1:4193/${route}` })
		let ready = false
		for (let poll = 0; poll < 60; poll += 1) {
			ready = (await evaluate("document.querySelector('#mode-badge')?.textContent !== 'Starting'")) === true
			if (ready) break
			await Bun.sleep(100)
		}
		if (!ready) throw new Error(`Dashboard route /${route} did not finish its first refresh`)
		await evaluate(`Promise.all([
			document.fonts.ready,
			new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		])`)
		await Bun.sleep(250)
		const layout = await evaluate(`new Promise(resolve => {
			window.scrollTo(0, 0)
			if (document.scrollingElement !== null) document.scrollingElement.scrollLeft = 0
			const navigation = document.querySelector('.section-nav')
			requestAnimationFrame(() => requestAnimationFrame(() => {
				const brand = document.querySelector('.brand')?.getBoundingClientRect()
				const current = navigation?.querySelector('[aria-current="page"]')
				const navigationBounds = navigation?.getBoundingClientRect()
				const currentBounds = current?.getBoundingClientRect()
				resolve({
					bodyWidth: document.body.scrollWidth,
					brandLeft: brand?.left,
					clientWidth: document.documentElement.clientWidth,
					currentNavigationVisible:
						currentBounds !== undefined &&
						navigationBounds !== undefined &&
						currentBounds.left >= navigationBounds.left - 1 &&
						currentBounds.right <= navigationBounds.right + 1,
					scrollY: window.scrollY,
					title: document.querySelector('h1')?.textContent,
				})
			}))
		})`)
		if (typeof layout !== 'object' || layout === null || Reflect.get(layout, 'title') !== 'Zoltar chaos bot') throw new Error(`Dashboard route /${route} did not render`)
		if (Reflect.get(layout, 'bodyWidth') !== Reflect.get(layout, 'clientWidth')) throw new Error(`Dashboard route /${route} overflows at ${width.toString()}x${height.toString()}: ${JSON.stringify(layout)}`)
		const brandLeft = Reflect.get(layout, 'brandLeft')
		if (typeof brandLeft !== 'number' || brandLeft < 0) throw new Error(`Dashboard route /${route} shifted the operator header: ${JSON.stringify(layout)}`)
		if (Reflect.get(layout, 'currentNavigationVisible') !== true || Reflect.get(layout, 'scrollY') !== 0) throw new Error(`Dashboard route /${route} did not preserve a visible current navigation target at the top of the document: ${JSON.stringify(layout)}`)
		if (horizontalScroll === 'catalog-end') {
			const scroll = await evaluate(`new Promise(resolve => {
				const shell = document.querySelector('.table-shell')
				if (!(shell instanceof HTMLElement)) {
					resolve(undefined)
					return
				}
				shell.scrollLeft = shell.scrollWidth
				requestAnimationFrame(() => requestAnimationFrame(() => resolve({
					clientWidth: shell.clientWidth,
					scrollLeft: shell.scrollLeft,
					scrollWidth: shell.scrollWidth,
				})))
			})`)
			if (typeof scroll !== 'object' || scroll === null) throw new Error('Catalog table was not available for horizontal-scroll capture')
			const clientWidth = Reflect.get(scroll, 'clientWidth')
			const scrollLeft = Reflect.get(scroll, 'scrollLeft')
			const scrollWidth = Reflect.get(scroll, 'scrollWidth')
			if (typeof clientWidth !== 'number' || typeof scrollLeft !== 'number' || typeof scrollWidth !== 'number' || scrollWidth <= clientWidth || scrollLeft < scrollWidth - clientWidth - 1) {
				throw new Error(`Catalog table did not reach its horizontal end: ${JSON.stringify(scroll)}`)
			}
		}
		if (verticalScroll === 'rpc-health') {
			const rpcPanel = await evaluate(`new Promise(resolve => {
				const panel = document.querySelector('.rpc-health-panel')
				if (!(panel instanceof HTMLElement)) {
					resolve(undefined)
					return
				}
				panel.scrollIntoView({ block: 'start' })
				requestAnimationFrame(() => requestAnimationFrame(() => {
					const bounds = panel.getBoundingClientRect()
					resolve({ bottom: bounds.bottom, top: bounds.top })
				}))
			})`)
			if (typeof rpcPanel !== 'object' || rpcPanel === null) throw new Error('RPC health panel was not available for vertical-scroll capture')
			const bottom = Reflect.get(rpcPanel, 'bottom')
			const top = Reflect.get(rpcPanel, 'top')
			if (typeof bottom !== 'number' || typeof top !== 'number' || top < -1 || bottom > height + 1) throw new Error(`RPC health panel did not fit the requested viewport: ${JSON.stringify(rpcPanel)}`)
		}
		let data: string | undefined
		let previousData: string | undefined
		let matchingFrames = 0
		for (let attempt = 0; attempt < 20; attempt += 1) {
			await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
			await Bun.sleep(50)
			const screenshot = await command('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true })
			if (typeof screenshot !== 'object' || screenshot === null || Array.isArray(screenshot)) throw new Error('Screenshot result was invalid')
			const nextData = Reflect.get(screenshot, 'data')
			if (typeof nextData !== 'string') throw new Error('Screenshot result omitted PNG data')
			data = nextData
			if (data === previousData) {
				matchingFrames += 1
				if (matchingFrames === 2) break
			} else {
				matchingFrames = 0
			}
			previousData = data
		}
		if (data === undefined || matchingFrames < 2) throw new Error(`Dashboard route /${route} did not reach three identical painted frames`)
		const path = resolve(outputDirectory, `${name}.png`)
		await Bun.write(path, Buffer.from(data, 'base64'))
		console.log(`${name}: ${width.toString()}x${height.toString()} · /${route} · ${path}`)
	}

	await capture(requestedCapture)
	if (diagnostics.length > 0) throw new Error(`Dashboard produced browser diagnostics: ${diagnostics.join('\n')}`)
	socket.close()
} finally {
	browser.kill()
	await browser.exited
	await rm(browserProfileDirectory, { force: true, recursive: true })
}
