import { join } from 'node:path'
import { launchChromium } from '../../../../tooling/ui/chromiumDevTools.mts'

type Chromium = Awaited<ReturnType<typeof launchChromium>>

/** Launches the desktop-sized headless Chromium every capture shares. */
export async function launchCaptureBrowser(chromium: string) {
	return await launchChromium({ extraArgs: ['--hide-scrollbars', '--run-all-compositor-stages-before-draw'], path: chromium, profilePrefix: 'zoltar-open-oracle-docs-', target: 'browser', viewport: { height: 900, width: 1440 } })
}

function evaluationValue(result: unknown) {
	return typeof result === 'object' && result !== null && 'result' in result && typeof result.result === 'object' && result.result !== null && 'value' in result.result ? result.result.value : undefined
}

/**
 * One reusable page target in the capture browser. It records runtime exceptions and console entries, stubs page intervals unless a
 * URL opts in with `allowIntervals=1`, and writes PNG captures into the output directory.
 */
export function createBrowserSession(browser: Chromium, outputDirectory: string) {
	const runtimeDiagnostics: string[] = []
	browser.socket.addEventListener('message', event => {
		const response: unknown = JSON.parse(String(event.data))
		if (typeof response !== 'object' || response === null) return
		if ('method' in response && (response.method === 'Runtime.exceptionThrown' || response.method === 'Log.entryAdded')) runtimeDiagnostics.push(JSON.stringify(response))
	})
	const command = browser.send
	let targetId = ''
	let sessionId = ''

	async function attachTarget() {
		const target = await command('Target.createTarget', { url: 'about:blank' })
		if (typeof target !== 'object' || target === null || !('targetId' in target) || typeof target.targetId !== 'string') throw new Error('Chromium did not create a screenshot target')
		targetId = target.targetId
		const attachment = await command('Target.attachToTarget', { flatten: true, targetId })
		if (typeof attachment !== 'object' || attachment === null || !('sessionId' in attachment) || typeof attachment.sessionId !== 'string') throw new Error('Chromium did not attach to the screenshot target')
		sessionId = attachment.sessionId
		await command('Page.enable', {}, sessionId)
		await command('Runtime.enable', {}, sessionId)
		await command('Log.enable', {}, sessionId)
		await command('Page.addScriptToEvaluateOnNewDocument', { source: `const nativeSetInterval = window.setInterval; window.setInterval = (callback, timeout, ...args) => location.search.includes('allowIntervals=1') ? nativeSetInterval(callback, timeout, ...args) : 0` }, sessionId)
	}

	async function setViewport(width: number, height: number) {
		await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height, mobile: false, width }, sessionId)
	}

	async function replacePage(url: string, width: number, height: number) {
		if (targetId === '') await attachTarget()
		await setViewport(width, height)
		await command('Emulation.setVisibleSize', { height, width }, sessionId)
		await command('Page.navigate', { url }, sessionId)
		await command('Target.activateTarget', { targetId })
		await command('Page.bringToFront', {}, sessionId)
	}

	async function settlePaint() {
		await command('Target.activateTarget', { targetId })
		await command('Page.bringToFront', {}, sessionId)
		await command(
			'Runtime.evaluate',
			{
				awaitPromise: true,
				expression: `(async () => {
					await document.fonts.ready
					await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
				})()`,
			},
			sessionId,
		)
	}

	async function capturePng(name: string) {
		await settlePaint()
		const capture = await command('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true }, sessionId)
		if (typeof capture !== 'object' || capture === null || !('data' in capture) || typeof capture.data !== 'string') throw new Error(`Chromium did not capture ${name}`)
		const bytes = await Bun.write(join(outputDirectory, name), Buffer.from(capture.data, 'base64'))
		if (bytes === 0) throw new Error(`Chromium wrote an empty ${name}`)
	}

	/** Evaluates `expression` in the page for its side effects. */
	async function run(expression: string) {
		await command('Runtime.evaluate', { expression }, sessionId)
	}

	/** Evaluates `expression` in the page and returns its JSON value, or `undefined` when evaluation produced none. */
	async function read(expression: string) {
		return evaluationValue(await command('Runtime.evaluate', { expression, returnByValue: true }, sessionId))
	}

	/** Throws when Chromium reported any diagnostic other than the expected failed `path` request with `status`, then clears them. */
	function expectOnlyFailedRequestDiagnostics(status: string, path: string, context: string) {
		const unexpected = runtimeDiagnostics.filter(diagnostic => !diagnostic.includes(`Failed to load resource: the server responded with a status of ${status}`) || !diagnostic.includes(path))
		if (unexpected.length > 0) throw new Error(`Chromium reported unexpected ${context} diagnostics: ${unexpected.join('\n')}`)
		runtimeDiagnostics.length = 0
	}

	async function close() {
		if (targetId !== '') await command('Target.closeTarget', { targetId })
	}

	return { runtimeDiagnostics, replacePage, setViewport, settlePaint, capturePng, run, read, expectOnlyFailedRequestDiagnostics, close }
}

export type BrowserSession = ReturnType<typeof createBrowserSession>

/** The desktop and narrow viewports every state is captured at. */
export const VIEWPORTS = [
	{ mobile: false, width: 1440, height: 900, suffix: 'desktop' },
	{ mobile: true, width: 390, height: 844, suffix: 'mobile' },
] as const
