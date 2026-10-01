import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { createDevToolsSession, type DevToolsSession } from '../ui/browserSmoke.mts'
import { getChromiumPath } from '../ui/chromiumPath.js'
import type { UiAppId } from '../ui/appPaths.mts'
import { UI_SCREENSHOTS, type UiScreenshotCrop, type UiScreenshotSpec, type UiScreenshotStep } from './ui-screenshot-specs.mts'
import { computeScreenshotFingerprint, readPngSize, readScreenshotFingerprints, SCREENSHOT_FINGERPRINT_PATH, screenshotApp, screenshotAppIds, screenshotOutputPath, pickMatch, updateEmbeddingPages } from './ui-screenshots.mts'

const repositoryRoot = path.resolve(import.meta.dir, '..', '..')
const DEFAULT_VIEWPORT = { width: 1440, height: 900 }
const SERVER_LISTEN_TIMEOUT_MILLISECONDS = 60_000
const APP_READY_ATTEMPTS = 1200
const SETTLE_MILLISECONDS = 1500

const usage = `Usage: bun run docs:screenshots [-- --app <app>] [--only <id,id>] [--sync-sizes]

Captures the documentation screenshots listed in tooling/docs/ui-screenshot-specs.mts from the walletless
simulation, writes them to docs/assets/screenshots/<app>/<id>.png, updates the <img> sizes on the pages that
embed them, and records the app's source fingerprint. It builds the app from this checkout and serves it on a
free port for the run. --sync-sizes only copies the existing images' sizes into the embedding pages, without a browser.`

// Runs in the page: finds controls by their visible label or accessible name.
const PAGE_HELPERS = `(() => {
	const pickMatch = ${pickMatch.toString()}
	const normalize = value => (value ?? '').replace(/\\s+/g, ' ').trim()
	const isVisible = element => {
		const rect = element.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
	}
	const clickable = 'button, a[href], [role=tab], [role=radio], [role=option], [role=menuitem], summary'
	// A control matches when it, or an element inside it, carries exactly the label text or accessible name.
	const labelled = text => {
		const matches = [...document.querySelectorAll('body *')].filter(element => isVisible(element) && (normalize(element.innerText) === text || normalize(element.getAttribute('aria-label')) === text))
		return [...new Set(matches.map(element => element.closest(clickable)).filter(element => element !== null))]
	}
	const inputFor = text => {
		for (const label of document.querySelectorAll('label')) {
			const labelText = normalize(label.innerText)
			if (labelText !== text && !labelText.startsWith(text + ' ')) continue
			const control = label.control ?? label.querySelector('input, textarea, select')
			if (control !== null && control !== undefined) return control
		}
		return [...document.querySelectorAll('input, textarea, select')].find(element => normalize(element.getAttribute('aria-label')) === text)
	}
	window.__docsScreenshot = {
		click: (text, nth) => {
			const matches = labelled(text).filter(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true')
			const target = pickMatch(matches, nth)
			if (target === undefined) return 'No enabled control labelled "' + text + '" (' + matches.length + ' found)'
			target.scrollIntoView({ block: 'center' })
			target.click()
			return ''
		},
		fill: (text, value) => {
			const input = inputFor(text)
			if (input === undefined) return 'No input labelled "' + text + '"'
			const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
			Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value)
			input.dispatchEvent(new Event('input', { bubbles: true }))
			input.dispatchEvent(new Event('change', { bubbles: true }))
			return ''
		},
		enabled: text => labelled(text).some(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true'),
		cropRect: (selector, containing, padding) => {
			const matches = [...document.querySelectorAll(selector)].filter(element => isVisible(element) && (containing === '' || element.innerText.includes(containing)))
			if (matches.length === 0) return undefined
			const smallest = matches.reduce((best, element) => (element.contains(best) ? best : best.contains(element) ? element : best))
			// Show scrollable panels, such as modal bodies, from their start, and measure from an unscrolled page so fixed
			// dialogs and in-flow content share one coordinate space.
			for (const element of [smallest, ...smallest.querySelectorAll('*')]) if (element.scrollHeight > element.clientHeight) element.scrollTop = 0
			for (let ancestor = smallest.parentElement; ancestor !== null; ancestor = ancestor.parentElement) ancestor.scrollTop = 0
			window.scrollTo(0, 0)
			// Hide everything beside the target so floating bars and overlapped page content stay out of the image.
			for (let node = smallest; node.parentElement !== null; node = node.parentElement) {
				for (const sibling of node.parentElement.children) if (sibling !== node && sibling instanceof HTMLElement) sibling.style.visibility = 'hidden'
			}
			const rect = smallest.getBoundingClientRect()
			const x = Math.max(0, Math.floor(rect.left + scrollX - padding))
			const y = Math.max(0, Math.floor(rect.top + scrollY - padding))
			const width = Math.min(document.documentElement.scrollWidth - x, Math.ceil(rect.width + padding * 2))
			const height = Math.min(document.documentElement.scrollHeight - y, Math.ceil(rect.height + padding * 2))
			return { x, y, width, height }
		},
	}
})()`

const quote = (value: string) => JSON.stringify(value)

/** Builds the app from this checkout and serves it on a free port, so another checkout's server on the fixed port is never captured. */
async function startDevServer(appId: UiAppId): Promise<{ readonly server: ChildProcess; readonly baseUrl: string }> {
	console.log(`Building the ${appId} UI (the first build compiles contracts and can take several minutes)...`)
	const build = Bun.spawn([process.execPath, './tooling/ui/apps.mts', appId], { cwd: repositoryRoot, stdout: 'ignore', stderr: 'inherit' })
	if ((await build.exited) !== 0) throw new Error(`Building the ${appId} UI failed`)
	const server = spawn(process.execPath, ['./tooling/ui/dev-server.ts', appId], { cwd: repositoryRoot, env: { ...process.env, UI_DEV_SERVER_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
	let output = ''
	const collect = (chunk: unknown) => {
		output = `${output}${String(chunk)}`.slice(-10_000)
	}
	server.stdout?.on('data', collect)
	server.stderr?.on('data', collect)
	const deadline = Date.now() + SERVER_LISTEN_TIMEOUT_MILLISECONDS
	while (Date.now() < deadline) {
		const port = /listening at http:\/\/localhost:(\d+)/.exec(output)?.[1]
		if (port !== undefined) return { server, baseUrl: `http://127.0.0.1:${port}` }
		if (server.exitCode !== null) throw new Error(`The ${appId} development server exited with code ${server.exitCode.toString()}:\n${output}`)
		await Bun.sleep(200)
	}
	stopDevServer(server)
	throw new Error(`The ${appId} development server did not start listening within ${(SERVER_LISTEN_TIMEOUT_MILLISECONDS / 1000).toString()} seconds:\n${output}`)
}

// The server shares this process group, so an interrupt stops it together with the capture.
function stopDevServer(server: ChildProcess) {
	if (server.exitCode === null) server.kill('SIGTERM')
}

async function runHelper(session: DevToolsSession, call: string, context: string) {
	const failure = await session.evaluate(`window.__docsScreenshot.${call}`)
	if (typeof failure === 'string' && failure !== '') throw new Error(`${context}: ${failure}`)
}

async function runStep(session: DevToolsSession, step: UiScreenshotStep, specId: string) {
	const context = `Screenshot '${specId}'`
	const waitOptions = { attempts: 600, intervalMilliseconds: 100, retryFailures: true }
	if ('click' in step) {
		await session.waitFor(`window.__docsScreenshot.enabled(${quote(step.click)})`, { ...waitOptions, message: `${context}: no enabled control labelled "${step.click}" appeared` })
		await runHelper(session, `click(${quote(step.click)}, ${(step.nth ?? 0).toString()})`, context)
	} else if ('fill' in step) await runHelper(session, `fill(${quote(step.fill)}, ${quote(step.value)})`, context)
	else if ('waitForText' in step) await session.waitFor(`document.body.innerText.includes(${quote(step.waitForText)})`, { ...waitOptions, message: `${context}: timed out waiting for text "${step.waitForText}"` })
	else if ('waitForNoText' in step) await session.waitFor(`!document.body.innerText.includes(${quote(step.waitForNoText)})`, { ...waitOptions, message: `${context}: text "${step.waitForNoText}" never disappeared` })
	else if ('waitForEnabled' in step) await session.waitFor(`window.__docsScreenshot.enabled(${quote(step.waitForEnabled)})`, { ...waitOptions, message: `${context}: "${step.waitForEnabled}" never became enabled` })
	else await session.evaluate('history.back()')
	await Bun.sleep(300)
}

const isRect = (value: unknown): value is { x: number; y: number; width: number; height: number } => typeof value === 'object' && value !== null && ['x', 'y', 'width', 'height'].every(key => key in value && typeof Reflect.get(value, key) === 'number')

async function cropRect(session: DevToolsSession, crop: UiScreenshotCrop, specId: string) {
	const rect = await session.evaluate(`window.__docsScreenshot.cropRect(${quote(crop.selector)}, ${quote(crop.containing ?? '')}, ${(crop.padding ?? 16).toString()})`)
	if (!isRect(rect)) throw new Error(`Screenshot '${specId}': no visible element matches crop selector '${crop.selector}'${crop.containing === undefined ? '' : ` containing "${crop.containing}"`}`)
	return { ...rect, scale: 1 }
}

async function captureScreenshot(chromiumPath: string, baseUrl: string, spec: UiScreenshotSpec): Promise<Uint8Array> {
	const app = screenshotApp(spec.app)
	const viewport = spec.viewport ?? DEFAULT_VIEWPORT
	const pageUrl = `${baseUrl}/?simulate=1&simScenario=${encodeURIComponent(spec.scenario)}${spec.route ?? ''}`
	const session = await createDevToolsSession(chromiumPath, pageUrl, viewport)
	try {
		await session.send('Runtime.enable')
		await session.send('Page.enable')
		await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
		await session.send('Emulation.setEmulatedMedia', {
			features: [
				{ name: 'prefers-reduced-motion', value: 'reduce' },
				{ name: 'prefers-color-scheme', value: 'light' },
			],
		})
		await session.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('zoltar.theme', 'light') } catch {}\n${PAGE_HELPERS}` })
		await session.send('Page.navigate', { url: pageUrl })
		await session.waitFor(`document.readyState === 'complete' && document.body.innerText.includes(${quote(app.title)}) && !document.body.innerText.includes('BOOTSTRAPPING') && !document.body.innerText.includes('Starting simulation')`, {
			attempts: APP_READY_ATTEMPTS,
			intervalMilliseconds: 250,
			retryFailures: true,
			message: `Screenshot '${spec.id}': ${app.title} did not finish loading ${pageUrl}`,
		})
		await Bun.sleep(SETTLE_MILLISECONDS)
		try {
			for (const step of spec.steps ?? []) await runStep(session, step, spec.id)
			for (const text of spec.expectText ?? [])
				await session.waitFor(`document.body.innerText.includes(${quote(text)})`, { attempts: 300, intervalMilliseconds: 100, message: `Screenshot '${spec.id}': expected text "${text}" is not visible. If the UI label changed, update the screenshot spec and the documentation that quotes it.` })
		} catch (error) {
			const failurePath = path.join(os.tmpdir(), `docs-screenshot-${spec.app}-${spec.id}-failure.png`)
			const failure = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
			if (typeof failure === 'object' && failure !== null && 'data' in failure && typeof failure.data === 'string') await fs.writeFile(failurePath, Buffer.from(failure.data, 'base64'))
			throw new Error(`${error instanceof Error ? error.message : String(error)}\nPage at the time of failure: ${failurePath}`)
		}
		await Bun.sleep(SETTLE_MILLISECONDS)
		if (spec.crop !== undefined) {
			// Capturing beyond the viewport resizes it mid-capture and shifts viewport-relative layout, so grow the viewport to the page first.
			const pageHeight = Number(await session.evaluate('document.documentElement.scrollHeight'))
			await session.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: Math.max(viewport.height, pageHeight), deviceScaleFactor: 1, mobile: false })
			await Bun.sleep(SETTLE_MILLISECONDS)
		}
		const clip = spec.crop === undefined ? undefined : await cropRect(session, spec.crop, spec.id)
		const result = await session.send('Page.captureScreenshot', { format: 'png', ...(clip === undefined ? {} : { clip }) })
		const data = typeof result === 'object' && result !== null && 'data' in result ? result.data : undefined
		if (typeof data !== 'string') throw new Error(`Screenshot '${spec.id}': Chromium returned no image data`)
		const pageErrors = session.issues.filter(issue => issue.kind === 'pageerror')
		if (pageErrors.length > 0) console.warn(`Screenshot '${spec.id}' page errors:\n${pageErrors.map(issue => `  ${issue.detail}`).join('\n')}`)
		return Buffer.from(data, 'base64')
	} finally {
		await session.close()
	}
}

async function main() {
	const { values } = parseArgs({ options: { app: { type: 'string' }, only: { type: 'string' }, help: { type: 'boolean' }, 'sync-sizes': { type: 'boolean' } } })
	if (values.help === true) {
		console.log(usage)
		return
	}
	const only = values.only === undefined ? undefined : new Set(values.only.split(',').map(id => id.trim()))
	const specs = UI_SCREENSHOTS.filter(spec => (values.app === undefined || spec.app === values.app) && (only === undefined || only.has(spec.id)))
	if (specs.length === 0) throw new Error(`No screenshots match${values.app === undefined ? '' : ` --app ${values.app}`}${values.only === undefined ? '' : ` --only ${values.only}`}.\n\n${usage}`)
	if (values['sync-sizes'] === true) {
		for (const spec of specs) {
			const outputPath = screenshotOutputPath(spec)
			await updateEmbeddingPages(path.join(repositoryRoot, 'docs'), spec, outputPath, readPngSize(await fs.readFile(path.join(repositoryRoot, outputPath))), console.warn)
		}
		return
	}
	const chromiumPath = process.env['CHROMIUM_PATH'] ?? getChromiumPath()
	if (chromiumPath === undefined) throw new Error('Chromium is required to capture screenshots. Install Chromium or set CHROMIUM_PATH.')

	const fingerprints = await readScreenshotFingerprints(repositoryRoot)
	for (const appId of screenshotAppIds(specs)) {
		const { server, baseUrl } = await startDevServer(appId)
		try {
			for (const spec of specs.filter(candidate => candidate.app === appId)) {
				const outputPath = screenshotOutputPath(spec)
				const image = await captureScreenshot(chromiumPath, baseUrl, spec)
				await fs.mkdir(path.dirname(path.join(repositoryRoot, outputPath)), { recursive: true })
				await fs.writeFile(path.join(repositoryRoot, outputPath), image)
				await updateEmbeddingPages(path.join(repositoryRoot, 'docs'), spec, outputPath, readPngSize(image), console.warn)
				console.log(`Captured ${outputPath}`)
			}
		} finally {
			stopDevServer(server)
		}
		// A partial run leaves the other screenshots unverified, so only a complete app run refreshes the fingerprint.
		if (only === undefined) fingerprints[appId] = await computeScreenshotFingerprint(repositoryRoot, appId)
	}
	const sorted = Object.fromEntries(Object.entries(fingerprints).sort(([left], [right]) => left.localeCompare(right)))
	await fs.writeFile(path.join(repositoryRoot, SCREENSHOT_FINGERPRINT_PATH), `${JSON.stringify(sorted, undefined, '\t')}\n`)
}

await main()
