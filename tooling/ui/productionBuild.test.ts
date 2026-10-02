import { afterAll, beforeAll, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import * as liquidationCopy from '../../ui/statoblastShared/ts/copy/liquidation.js'
import { bytesToHex, decodeFunctionResult, encodeFunctionData, getAddress, hexToBytes, zeroAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createSimulationProfile } from '../../ui/coreShared/ts/wallet/networkProfile.js'
import { getInfraContractAddresses } from '../../ui/statoblastShared/ts/protocol/deploymentHelpers.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../../ui/statoblastShared/ts/contractArtifact.js'
import * as securityPoolCopy from '../../ui/statoblastShared/ts/copy/securityPool.js'
import { UI_APP_IDS, featureStylesheets, getUiAppPaths, getUiCoreSharedPaths, isUiAppId, type UiAppId } from './appPaths.mts'
import { launchChromium } from './chromiumDevTools.mts'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'
import { productionWorkflowTestName, selectProductionWorkflowScenarios, type ProductionWorkflowScenario } from './productionWorkflowScenarios.ts'

const appPathsById = new Map(UI_APP_IDS.map(appId => [appId, getUiAppPaths(appId)]))
const repositoryRootPath = getUiCoreSharedPaths().repositoryRoot
const CHROMIUM_COMMAND_TIMEOUT_MILLISECONDS = 30_000
const PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS = 120_000
const PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS = 600_000

let server: Bun.Server | undefined

const chromiumPath = getChromiumPath()
const productionBrowserTest = (name: string, run: () => Promise<void>) => test(name, run, PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS)
const selectedWorkflowScenarios = selectProductionWorkflowScenarios(process.env['ZOLTAR_BROWSER_WORKFLOW_SCENARIO'])
const productionWorkflowTest = (scenario: ProductionWorkflowScenario, run: () => Promise<void>) => {
	const register = process.env['RUN_PRODUCTION_BROWSER_WORKFLOWS'] === '1' && selectedWorkflowScenarios.includes(scenario) ? test : test.skip
	register(productionWorkflowTestName(scenario), run, PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS)
}
const productionRebuildInvariantTest = process.env['ZOLTAR_USE_EXISTING_PRODUCTION_BUILD'] === '1' && process.env['ZOLTAR_RUN_PRODUCTION_REBUILD_INVARIANTS'] !== '1' ? test.skip : test

beforeAll(async () => {
	if (process.env['ZOLTAR_USE_EXISTING_PRODUCTION_BUILD'] !== '1') {
		const result = Bun.spawnSync([process.execPath, 'run', 'ui:build:prod'], {
			cwd: repositoryRootPath,
			stderr: 'pipe',
			stdout: 'pipe',
		})
		if (result.exitCode !== 0) {
			throw new Error(`ui:build:prod failed\n${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`)
		}
	}

	server = Bun.serve({
		fetch: async request => {
			const requestUrl = new URL(request.url)
			// The CI prepare job uploads the app dist directories preserving their full
			// ui/<app>/dist layout, so serve both layouts: /zoltar/... and /ui/zoltar/dist/...
			// resolve to the app dist root, and unprefixed / falls back to zoltar.
			const uiLayoutMatch = /^\/ui\/([a-z]+)\/dist(\/.*)?$/.exec(requestUrl.pathname)
			const uiLayoutAppId = uiLayoutMatch?.[1]
			const pathname = uiLayoutMatch?.[2] ?? requestUrl.pathname
			const matchedAppId = uiLayoutAppId !== undefined && isUiAppId(uiLayoutAppId) ? uiLayoutAppId : (UI_APP_IDS.find(appId => pathname === `/${appId}` || pathname.startsWith(`/${appId}/`)) ?? (pathname === '/' || pathname.startsWith('/assets/') || pathname.startsWith('/css/') ? 'zoltar' : undefined))
			if (matchedAppId === undefined) {
				return new Response('not found', { status: 404 })
			}
			const appPaths = appPathsById.get(matchedAppId)
			if (appPaths === undefined) throw new Error(`No path information recorded for ${matchedAppId}.`)
			let appRelativePath = pathname
			if (pathname === `/${matchedAppId}` || pathname === '/') appRelativePath = '/'
			else if (pathname.startsWith(`/${matchedAppId}/`)) appRelativePath = pathname.slice(`/${matchedAppId}`.length)
			const relativePath = appRelativePath === '/' ? 'index.html' : appRelativePath.replace(/^\/+/, '')
			const filePath = path.join(appPaths.appDistRoot, relativePath)
			if (!filePath.startsWith(`${appPaths.appDistRoot}${path.sep}`)) {
				return new Response('forbidden', { status: 403 })
			}
			const file = Bun.file(filePath)
			if (!(await file.exists())) {
				return new Response('not found', { status: 404 })
			}
			return new Response(file)
		},
		hostname: '127.0.0.1',
		port: 0,
	})
}, PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS)

afterAll(() => {
	server?.stop(true)
})

for (const appId of UI_APP_IDS) {
	const appPaths = appPathsById.get(appId)
	if (appPaths === undefined) throw new Error(`No path information recorded for ${appId}.`)
	const distRootPath = appPaths.appDistRoot
	const distAssetsPath = appPaths.appDistAssetsRoot
	const appBundlePath = path.join(distAssetsPath, 'app.js')
	const appSourceMapPath = path.join(distAssetsPath, 'app.js.map')
	const workerBundlePath = path.join(distAssetsPath, 'tevmWorker.worker.js')
	const workerSourceMapPath = path.join(distAssetsPath, 'tevmWorker.worker.js.map')
	const productionIndexPath = path.join(distRootPath, 'index.html')
	const productionCssPath = path.join(distRootPath, 'css', 'index.css')
	const productionTokensCssPath = path.join(distRootPath, 'css', 'tokens.css')
	const productionFaviconPaths = [path.join(distRootPath, 'favicon.svg')]
	const expectedTitles: Record<UiAppId, string> = { statoblast: 'Augur Statoblast', trading: 'Statoblast Trading', zoltar: 'Zoltar' }
	const expectedTitle = expectedTitles[appId]
	const otherTitles = ['Zoltar', 'Augur Statoblast', 'Statoblast Trading'].filter(title => title !== expectedTitle)
	const expectedRoutes: Record<UiAppId, string> = { statoblast: '#/pools', trading: '#/markets', zoltar: '#/zoltar' }
	const expectedRoute = expectedRoutes[appId]

	test(`${appId} production build emits the deployable artifact set`, async () => {
		const expectedPaths = [
			productionIndexPath,
			productionCssPath,
			productionTokensCssPath,
			...['base.css', 'simulation-banner.css', 'protocol-surfaces.css', 'application-surfaces.css', 'controls-and-responsive.css', 'visual-foundation.css', 'protocol-apps.css'].map(stylesheet => path.join(distRootPath, 'css', stylesheet)),
			...featureStylesheets[appId].map(stylesheet => path.join(distRootPath, 'css', stylesheet)),
			path.join(distRootPath, 'vendor', 'fonts', 'ibm-plex-mono-latin-400-normal.woff2'),
			path.join(distRootPath, 'vendor', 'fonts', 'ibm-plex-mono-latin-600-normal.woff2'),
			appBundlePath,
			appSourceMapPath,
			workerBundlePath,
			workerSourceMapPath,
			...productionFaviconPaths,
			...(appId === 'trading' ? [path.join(distRootPath, 'core-deployments.json')] : []),
		]

		for (const expectedPath of expectedPaths) {
			await expect(fs.access(expectedPath)).resolves.toBeNull()
		}
	})

	test(`${appId} production index html references the bundled app and does not use the dev import map`, async () => {
		const html = await fs.readFile(productionIndexPath, 'utf8')

		expect(html).toMatch(/<script\s+async\s+type=["']module["']\s+src=["']\.\/assets\/app\.js["']\s*>\s*<\/script>/)
		expect(html).not.toContain('importmap')
		expect(html).not.toContain('./js/')
		expect(html).not.toContain('./vendor/')
		expect(html).toContain(`<title>${expectedTitle}</title>`)
		expect(html).toContain(`<html lang="en" data-product="${appId}">`)
		const stylesheetLinks = ['index.css', ...featureStylesheets[appId]].map(stylesheet => `<link rel="stylesheet" href="./css/${stylesheet}" />`)
		const stylesheetLinkOffsets = stylesheetLinks.map(link => html.indexOf(link))
		expect(stylesheetLinkOffsets.every(offset => offset >= 0)).toBe(true)
		expect([...stylesheetLinkOffsets].sort((left, right) => left - right)).toEqual(stylesheetLinkOffsets)
		if (appId === 'statoblast' || appId === 'trading') {
			expect(html).toContain('<link rel="stylesheet" href="./css/price-oracle.css" />')
			const oracleCss = await fs.readFile(path.join(distRootPath, 'css', 'price-oracle.css'), 'utf8')
			expect(oracleCss).toContain('.request-price-fields {')
			expect(oracleCss).toContain('.price-request-estimate-prompt {')
		}
		for (const otherTitle of otherTitles) expect(html).not.toContain(`<title>${otherTitle}</title>`)
	})

	test(`${appId} production javascript is self-contained for deploys`, async () => {
		const appBundle = await fs.readFile(appBundlePath, 'utf8')
		const workerBundle = await fs.readFile(workerBundlePath, 'utf8')
		const appSourceMap = JSON.parse(await fs.readFile(appSourceMapPath, 'utf8')) as { sources: string[] }
		const workerSourceMap = JSON.parse(await fs.readFile(workerSourceMapPath, 'utf8')) as { sources: string[]; sourcesContent: string[] }

		expect(appBundle).not.toContain('./vendor/')
		expect(appBundle).not.toContain('./js/')
		expect(appBundle).toContain('new URL("./tevmWorker.worker.js", import.meta.url)')
		expect(appBundle).toContain('"/assets/"')
		expect(workerBundle).not.toContain('./vendor/')
		expect(workerBundle).not.toContain('./js/')
		expect(appSourceMap.sources.some(source => source.replaceAll('\\', '/').startsWith('../../ts/'))).toBe(true)
		expect(workerSourceMap.sources.some(source => source.replaceAll('\\', '/').startsWith('../../ts/'))).toBe(true)
		const tevmActionsSourceIndex = workerSourceMap.sources.findIndex(source => source.replaceAll('\\', '/').endsWith('/@tevm/actions/dist/index.js'))
		expect(tevmActionsSourceIndex).toBeGreaterThanOrEqual(0)
		expect(workerSourceMap.sourcesContent[tevmActionsSourceIndex]).toStartWith("import { Buffer } from 'node:buffer'")
		expect(appBundle).toContain(expectedRoute)
		if (appId === 'trading') {
			expect(appBundle).not.toContain('SIMULATED DATA')
			expect(appBundle).not.toContain('Demo mode')
			expect(appBundle).not.toContain('demo-banner')
		}
	})

	test(`${appId} production build can be served as static files`, async () => {
		if (server === undefined) {
			throw new Error('Production test server did not start')
		}

		const baseUrl = server.url.toString().replace(/\/$/, '')
		const responses = await Promise.all([
			fetch(`${baseUrl}/${appId}/`),
			fetch(`${baseUrl}/${appId}/assets/app.js`),
			fetch(`${baseUrl}/${appId}/assets/tevmWorker.worker.js`),
			fetch(`${baseUrl}/${appId}/css/index.css`),
			fetch(`${baseUrl}/${appId}/css/tokens.css`),
			fetch(`${baseUrl}/${appId}/css/visual-foundation.css`),
			fetch(`${baseUrl}/${appId}/css/protocol-apps.css`),
		])

		for (const response of responses) {
			expect(response.status).toBe(200)
		}
		const favicon = await fetch(`${baseUrl}/${appId}/favicon.svg`)
		expect(favicon.status).toBe(200)
		expect(favicon.headers.get('content-type')).toContain('image/svg+xml')
		expect(await favicon.text()).toBe(await fs.readFile(appPaths.faviconSvg, 'utf8'))
	})

	test(`building ${appId} does not remove the other app's production output`, async () => {
		const otherAppId = appId === 'zoltar' ? 'statoblast' : 'zoltar'
		const otherPaths = appPathsById.get(otherAppId)
		if (otherPaths === undefined) throw new Error(`No path information recorded for ${otherAppId}.`)
		const otherIndexPath = path.join(otherPaths.appDistRoot, 'index.html')
		const otherHtml = await fs.readFile(otherIndexPath, 'utf8')
		expect(otherHtml).toContain('<title>')
		expect(distRootPath).not.toBe(otherPaths.appDistRoot)
	})

	productionRebuildInvariantTest(`${appId} production output is independent of the invoking working directory and development fonts`, async () => {
		const rootBuild = await fs.readFile(appBundlePath)
		// CI restores production artifacts without the shared development font directory.
		const fontDirectory = path.join(appPaths.coreSharedRoot, 'vendor', 'fonts')
		const backupDirectory = await fs.mkdtemp(path.join(appPaths.coreSharedRoot, 'production-fonts-'))
		const backupPath = path.join(backupDirectory, 'fonts')
		const hadFonts = await fs.stat(fontDirectory).then(
			() => true,
			error => {
				if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
				throw error
			},
		)
		if (hadFonts) await fs.rename(fontDirectory, backupPath)
		try {
			const result = Bun.spawnSync([process.execPath, appPaths.productionBuildScript, appId], {
				cwd: appPaths.appRoot,
				stderr: 'pipe',
				stdout: 'pipe',
			})
			if (result.exitCode !== 0) {
				throw new Error(`production build from ${appPaths.appRoot} failed\n${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`)
			}
			expect(await fs.readFile(appBundlePath)).toEqual(rootBuild)
			for (const weight of [400, 600]) {
				const fileName = `ibm-plex-mono-latin-${weight}-normal.woff2`
				const source = await fs.readFile(new URL(import.meta.resolve(`@fontsource/ibm-plex-mono/files/${fileName}`)))
				expect(await fs.readFile(path.join(distRootPath, 'vendor', 'fonts', fileName))).toEqual(source)
			}
		} finally {
			if (hadFonts) await fs.rename(backupPath, fontDirectory)
			await fs.rm(backupDirectory, { recursive: true, force: true })
		}
	})
}

function readEvaluationString(response: unknown) {
	if (typeof response !== 'object' || response === null || !('result' in response)) throw new Error('Chromium evaluation result was missing')
	const result = response.result
	if (typeof result !== 'object' || result === null || !('value' in result) || typeof result.value !== 'string') throw new Error('Chromium evaluation did not return a string')
	return result.value
}

type ProductionBrowserDriver = {
	captureScreenshot: (screenshotPath: string) => Promise<void>
	clickButton: (label: string, occurrence?: number) => Promise<void>
	evaluate: (expression: string) => Promise<unknown>
	evaluateAsync: (expression: string) => Promise<unknown>
	navigate: (url: string) => Promise<void>
	pressTab: () => Promise<void>
	resize: (viewport: { height: number; width: number }) => Promise<void>
	setInputByLabel: (label: string, value: string) => Promise<void>
	waitForButtonEnabled: (label: string, occurrence?: number) => Promise<void>
	waitForBodyText: (text: string) => Promise<string>
	waitForBodyWithoutText: (text: string) => Promise<string>
	waitForTransactionStatus: (status: string, title: string) => Promise<string>
}

async function loadProductionDocumentInChromiumUnlocked(pageUrl: string, viewport: { height: number; width: number }, interact?: (driver: ProductionBrowserDriver) => Promise<void>) {
	if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser smoke test')
	const page = await launchChromium({ commandTimeoutMilliseconds: CHROMIUM_COMMAND_TIMEOUT_MILLISECONDS, path: chromiumPath, profilePrefix: 'zoltar-production-browser-', viewport: { height: 900, width: 1440 } })
	try {
		const { send } = page
		const evaluate = async (expression: string) => await page.evaluate(expression, { awaitPromise: false, exceptions: 'ignore' })
		const readBody = async () => {
			const body = await evaluate('document.body?.innerText ?? ""')
			if (typeof body !== 'string') throw new Error('Chromium body evaluation did not return text')
			return body
		}
		const waitForBody = async (predicate: (body: string) => boolean, description: string) => {
			let body = ''
			for (let attempt = 0; attempt < 2400; attempt += 1) {
				body = await readBody()
				if (body.includes('Simulation bootstrap failed')) throw new Error(`Production simulation failed to bootstrap: ${body}`)
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
			if (typeof parsedState === 'object' && parsedState !== null && 'body' in parsedState && typeof parsedState.body === 'string' && parsedState.body.includes('Simulation bootstrap failed')) throw new Error(`Production simulation failed to bootstrap: ${parsedState.body}`)
			if (typeof parsedState === 'object' && parsedState !== null && 'body' in parsedState && typeof parsedState.body === 'string' && parsedState.body !== '' && parsedState.body !== 'Loading...' && !parsedState.body.includes('BOOTSTRAPPING') && !parsedState.body.includes('Starting simulation bootstrap')) {
				applicationReady = true
				break
			}
			await Bun.sleep(50)
		}
		if (!applicationReady) throw new Error(`Production application did not finish loading: ${state}`)
		const driver: ProductionBrowserDriver = {
			captureScreenshot: async screenshotPath => {
				const result = (await send('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true })) as { data?: unknown }
				if (typeof result.data !== 'string') throw new Error('Chromium did not return PNG screenshot data.')
				await fs.mkdir(path.dirname(screenshotPath), { recursive: true })
				await fs.writeFile(screenshotPath, Buffer.from(result.data, 'base64'))
			},
			clickButton: async (label, occurrence = 0) => {
				const clicked = await evaluate(
					`(() => { const buttons = [...document.querySelectorAll('button')].filter(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === ${JSON.stringify(label)} && !button.disabled); const button = buttons[${occurrence.toString()}]; if (!(button instanceof HTMLButtonElement)) return false; button.focus(); button.click(); return true })()`,
				)
				if (clicked !== true) throw new Error(`Unable to click enabled browser button ${label} at occurrence ${occurrence.toString()}`)
			},
			evaluate,
			evaluateAsync: expression => page.evaluate(expression),
			navigate: async url => {
				await send('Page.navigate', { url: new URL(url, pageUrl).href })
			},
			pressTab: async () => {
				await send('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyDown' })
				await send('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyUp' })
			},
			resize,
			setInputByLabel: async (label, value) => {
				const updated = await evaluate(
					`(() => { const label = [...document.querySelectorAll('label')].find(candidate => candidate.textContent?.trim() === ${JSON.stringify(label)} || [...candidate.querySelectorAll('span')].some(span => span.textContent?.trim() === ${JSON.stringify(label)})); const input = label?.control; if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
				)
				if (updated !== true) throw new Error(`Unable to update browser input ${label}`)
			},
			waitForButtonEnabled: async (label, occurrence = 0) => {
				for (let attempt = 0; attempt < 600; attempt += 1) {
					const enabled = await evaluate(`[...document.querySelectorAll('button')].filter(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === ${JSON.stringify(label)} && !button.disabled)[${occurrence.toString()}] instanceof HTMLButtonElement`)
					if (enabled === true) return
					await Bun.sleep(50)
				}
				throw new Error(`Timed out waiting for enabled browser button ${label}. Last body: ${await readBody()}`)
			},
			waitForBodyText: async text => await waitForBody(body => body.includes(text), JSON.stringify(text)),
			waitForBodyWithoutText: async text => await waitForBody(body => !body.includes(text), `body to omit ${JSON.stringify(text)}`),
			waitForTransactionStatus: async (status, title) => {
				for (let attempt = 0; attempt < 2400; attempt += 1) {
					const matches = await evaluate(`(() => { const notice = document.querySelector('.global-transaction-notice'); return notice?.querySelector('.badge')?.textContent?.trim() === ${JSON.stringify(status)} && notice?.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(title)} })()`)
					if (matches === true) return await readBody()
					await Bun.sleep(50)
				}
				throw new Error(`Timed out waiting for ${status} transaction ${title}. Last body: ${await readBody()}`)
			},
		}
		await interact?.(driver)
		return readEvaluationString(
			await send('Runtime.evaluate', {
				expression: `JSON.stringify({ body: document.body?.innerText ?? '', height: innerHeight, html: document.documentElement?.outerHTML ?? '', width: innerWidth })`,
				returnByValue: true,
			}),
		)
	} finally {
		await page.close()
	}
}

async function loadProductionDocumentInChromium(pageUrl: string, viewport: { height: number; width: number }, interact?: (driver: ProductionBrowserDriver) => Promise<void>) {
	return await withChromiumTestLock(async () => await loadProductionDocumentInChromiumUnlocked(pageUrl, viewport, interact))
}

const productionBrowserScenarios = [
	{
		appId: 'zoltar',
		hash: '#/deploy?simulate=1&simScenario=baseline',
		expected: 'Deploy contracts',
		workflow: false,
		name: 'zoltar baseline deployment',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'zoltar',
		hash: '#/zoltar?simulate=1&simScenario=deployed',
		expected: 'Questions',
		workflow: false,
		name: 'zoltar deployed protocol',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'statoblast',
		hash: '#/deploy?simulate=1&simScenario=baseline',
		expected: 'Deploy contracts',
		workflow: false,
		name: 'statoblast baseline deployment',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'statoblast',
		hash: '#/pools?simulate=1&simScenario=security-pool',
		expected: 'Browse pools',
		workflow: false,
		name: 'statoblast seeded pool at narrow width',
		viewport: { height: 844, width: 390 },
	},
	{
		appId: 'statoblast',
		hash: '#/pools?simulate=1&simScenario=securitypoolx2-auction',
		expected: 'Truth auction',
		workflow: true,
		name: 'statoblast fork and auction',
		viewport: { height: 900, width: 1440 },
	},
] as const

for (const scenario of productionBrowserScenarios) {
	const run = async () => {
		if (server === undefined) throw new Error('Production test server did not start')
		if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser smoke test')
		const baseUrl = server.url.toString().replace(/\/$/, '')
		const state = JSON.parse(await loadProductionDocumentInChromium(`${baseUrl}/${scenario.appId}/${scenario.hash}`, scenario.viewport))
		if (typeof state !== 'object' || state === null || !('body' in state) || !('html' in state) || typeof state.body !== 'string' || typeof state.html !== 'string' || !('height' in state) || !('width' in state)) {
			throw new Error(`${scenario.name} returned an invalid document state`)
		}
		expect(state.html).toContain('<main')
		expect(state.body).toContain(scenario.expected)
		expect(state.body).toContain(scenario.appId === 'zoltar' ? 'Zoltar' : 'Augur Statoblast')
		expect(state.body).toContain('Browser simulation')
		expect(state.height).toBe(scenario.viewport.height)
		expect(state.width).toBe(scenario.viewport.width)
		expect(state.body).not.toContain('Failed to initialize the app environment')
	}
	if (scenario.workflow) productionWorkflowTest('auction-boot', run)
	else productionBrowserTest(`production bundle boots the ${scenario.name} scenario in Chromium`, run)
}

function createWorkflowActions(driver: ProductionBrowserDriver) {
	// Completed prerequisite labels stay in the form; submitted outcomes use the shared status panel.
	const completeTransactionReview = async (inDialogSuccessTitle?: string, stopOnInlineText?: string) => {
		await driver.evaluate('window.__zoltarReviewClicked = false')
		for (let attempt = 0; attempt < 2400; attempt += 1) {
			const result = await driver.evaluate(
				`(() => { if (${JSON.stringify(stopOnInlineText ?? '')} && document.body.innerText.includes(${JSON.stringify(stopOnInlineText ?? '')})) return 'complete'; const status = document.querySelector('.global-transaction-dialog'); if (status) { const badge = status.querySelector('.badge')?.textContent?.trim(); const title = status.querySelector('.global-transaction-notice-header strong')?.textContent?.trim(); if (badge === 'Failed' || (${JSON.stringify(inDialogSuccessTitle ?? '')} && badge === 'Confirmed' && title === ${JSON.stringify(inDialogSuccessTitle ?? '')})) return 'complete'; if (badge === 'Pending' || badge === 'Awaiting wallet' || badge === 'Preparing') return 'waiting'; const nextAction = [...document.querySelectorAll('.transaction-step-actions .transaction-plan-action .tx-action-button')].some(candidate => candidate instanceof HTMLButtonElement && !candidate.disabled); const dismiss = status.querySelector('.global-transaction-dismiss'); if (dismiss instanceof HTMLButtonElement) dismiss.click(); return !${JSON.stringify(inDialogSuccessTitle ?? '')} && !nextAction ? 'complete' : 'waiting' } const actions = document.querySelector('.transaction-step-actions'); if (!actions) return window.__zoltarReviewClicked ? 'complete' : 'waiting'; const button = [...actions.querySelectorAll('.transaction-plan-action .tx-action-button')].find(candidate => candidate instanceof HTMLButtonElement && !candidate.disabled); if (button instanceof HTMLButtonElement) { button.click(); window.__zoltarReviewClicked = true } return 'waiting' })()`,
			)
			if (result === 'complete') return
			await Bun.sleep(50)
		}
		throw new Error(`Transaction review did not finish: ${String(await driver.evaluate('document.body.innerText'))}`)
	}
	// The tool counts as selected only once its tab is the active one; a dropped click must not pass as a selection.
	const isPoolToolSelected = async (label: 'Price oracle' | 'Fork & migration') => (await driver.evaluate(`[...document.querySelectorAll('.selected-pool-workspace-tabs [role="tab"][aria-selected="true"]')].some(tab => tab.textContent?.trim() === ${JSON.stringify(label)})`)) === true
	const selectPoolTool = async (label: 'Price oracle' | 'Fork & migration') => {
		for (let attempt = 0; attempt < 600; attempt += 1) {
			if (await isPoolToolSelected(label)) return
			await driver.evaluate(
				`(() => { const tab = [...document.querySelectorAll('.selected-pool-workspace-tabs [role="tab"]')].find(candidate => candidate.textContent?.trim() === ${JSON.stringify(label)}); if (tab instanceof HTMLElement) { tab.click(); return } const trigger = document.querySelector('.pool-tools-trigger'); if (!(trigger instanceof HTMLButtonElement)) return; if (trigger.getAttribute('aria-expanded') !== 'true') { trigger.click(); return } const button = [...document.querySelectorAll('.pool-tools-options button')].find(candidate => candidate.textContent?.trim() === ${JSON.stringify(label)}); if (button instanceof HTMLButtonElement && !button.disabled) button.click() })()`,
			)
			await Bun.sleep(50)
		}
		throw new Error(`Unable to select pool tool ${label}: ${String(await driver.evaluate('document.body.innerText'))}`)
	}
	// Read fixture addresses from the seeded chain, then use the same address-entry flow as a user.
	const loadSeededPools = async () => {
		await driver.waitForBodyWithoutText('BOOTSTRAPPING')
		const genesisRepTokenAddress = await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.genesisRepTokenAddress')
		const wethAddress = await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.wethAddress')
		if (typeof genesisRepTokenAddress !== 'string' || typeof wethAddress !== 'string') throw new Error('Simulation network profile was not available')
		const profile = createSimulationProfile({ genesisRepTokenAddress: getAddress(genesisRepTokenAddress), wethAddress: getAddress(wethAddress) })
		const { securityPoolFactory } = getInfraContractAddresses(profile)
		const abi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
		const readFixtureContract = async (data: Hex) => {
			const result = await driver.evaluateAsync(`new Promise((resolve, reject) => {
				const worker = window.__zoltarProductionWorkers?.at(-1)
				if (!(worker instanceof Worker)) { reject(new Error('Simulation worker was not available')); return }
				// App RPC IDs are positive; fixture reads use negative IDs to avoid consuming app responses.
				const id = window.__zoltarFixtureRequestId = (window.__zoltarFixtureRequestId ?? 0) - 1
				const timeout = setTimeout(() => { worker.removeEventListener('message', receive); reject(new Error('Seeded pool registry read timed out')) }, 10000)
				function receive(event) {
					const message = event.data
					if (message.id !== id) return
					clearTimeout(timeout)
					worker.removeEventListener('message', receive)
					if (message.type === 'error') reject(new Error(message.message))
					else resolve(message.value)
				}
				worker.addEventListener('message', receive)
				worker.postMessage({ id, type: 'rpc', method: 'eth_call', params: [{ to: ${JSON.stringify(securityPoolFactory)}, data: ${JSON.stringify(data)} }, 'latest'] })
			})`)
			if (typeof result !== 'string') throw new Error('Seeded pool registry returned invalid call data')
			return bytesToHex(hexToBytes(result))
		}
		const count = decodeFunctionResult({ abi, functionName: 'securityPoolDeploymentCount', data: await readFixtureContract(encodeFunctionData({ abi, functionName: 'securityPoolDeploymentCount' })) })
		expect(count > 0n && count <= 10n).toBe(true)
		const pools = decodeFunctionResult({ abi, functionName: 'securityPoolDeploymentsRange', data: await readFixtureContract(encodeFunctionData({ abi, functionName: 'securityPoolDeploymentsRange', args: [0n, count] })) })
		return pools
	}
	const openSeededPool = async (kind: 'origin' | 'auction' = 'origin') => {
		const pools = await loadSeededPools()
		const universe = await driver.evaluate("new URLSearchParams(location.hash.split('?')[1] ?? '').get('universe') ?? '0'")
		if (typeof universe !== 'string') throw new Error('Pool route universe was not available')
		const pool = pools.find(pool => pool.universeId === BigInt(universe) && (kind === 'origin' ? pool.parent === zeroAddress : pool.parent !== zeroAddress && pool.truthAuction !== zeroAddress))
		if (pool === undefined) throw new Error(`Seeded ${kind} pool was not found`)
		expect(await driver.evaluate("document.querySelector('.discovery-control') === null")).toBe(true)
		await driver.setInputByLabel('Search or paste a pool address', pool.securityPool)
		await driver.waitForButtonEnabled('Open pool at this address')
		await driver.clickButton('Open pool at this address')
		await driver.waitForBodyText('All pools')
		await driver.waitForBodyWithoutText('Loading vault details…')
		let favorited = false
		for (let attempt = 0; attempt < 600 && !favorited; attempt += 1) {
			favorited = (await driver.evaluate(`document.querySelector('button[aria-label^="Favorite:"][aria-pressed="true"]') !== null`)) === true
			if (!favorited) await Bun.sleep(50)
		}
		expect(favorited).toBe(true)
		// Opening the address must save it to Favorites and expose a working pool link there.
		const returnedToFavorites = await driver.evaluate(`(() => { const link = [...document.querySelectorAll('a')].find(candidate => candidate.textContent?.includes('All pools')); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true })()`)
		expect(returnedToFavorites).toBe(true)
		await driver.waitForBodyText('Favorites (1)')
		await driver.waitForBodyText(pool.securityPool)
		const reopened = await driver.evaluate(`(() => { const link = document.querySelector('a[aria-label^="Open pool:"]'); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true })()`)
		expect(reopened).toBe(true)
	}
	return { completeTransactionReview, isPoolToolSelected, selectPoolTool, openSeededPool, loadSeededPools }
}

function productionInteractionTest(scenario: ProductionWorkflowScenario, route: string, viewport: { height: number; width: number }, interact: (driver: ProductionBrowserDriver) => Promise<void>) {
	productionWorkflowTest(scenario, async () => {
		if (server === undefined) throw new Error('Production test server did not start')
		if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser workflow test')
		const baseUrl = server.url.toString().replace(/\/$/, '')
		const state = JSON.parse(await loadProductionDocumentInChromium(`${baseUrl}/statoblast/${route}`, viewport, interact))
		if (typeof state !== 'object' || state === null || !('body' in state) || typeof state.body !== 'string') throw new Error('Production workflow returned invalid document state')
		expect(state.body).not.toContain('Failed to initialize the app environment')
		expect(state.height).toBe(viewport.height)
		expect(state.width).toBe(viewport.width)
	})
}

productionInteractionTest('pool-recovery', '?workflow=pool#/pools?simulate=1&simScenario=security-pool', { height: 844, width: 390 }, async driver => {
	const { completeTransactionReview, openSeededPool } = createWorkflowActions(driver)
	await openSeededPool()
	await driver.waitForBodyWithoutText('Loading vault details…')
	await driver.waitForButtonEnabled('Deposit REP')
	await driver.clickButton('Deposit REP')
	await driver.waitForBodyText('REP backing')
	await driver.setInputByLabel('REP backing', '1')
	let depositReady = false
	for (let attempt = 0; attempt < 600 && !depositReady; attempt += 1) {
		const readiness = await driver.evaluate(
			`(() => { const dialog = document.querySelector('[role="dialog"]'); const buttons = [...(dialog?.querySelectorAll('button') ?? [])]; const deposit = buttons.find(candidate => candidate.textContent?.trim() === 'Deposit REP'); if (deposit instanceof HTMLButtonElement && !deposit.disabled) return true; const approval = buttons.find(candidate => candidate.textContent?.trim().startsWith('Approve ') && !candidate.disabled); if (approval instanceof HTMLButtonElement) { approval.click(); return 'approval' } return false })()`,
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
	await completeTransactionReview()
	const failedBody = await driver.waitForBodyText('Injected production workflow failure')
	expect(failedBody).toContain('FAILED')
	expect(failedBody).toContain('Deposit REP')
	await driver.clickButton('Dismiss')
	await driver.waitForButtonEnabled('Deposit REP', 1)
	await driver.clickButton('Deposit REP', 1)
	await completeTransactionReview('Deposit REP')
	const poolBody = await driver.waitForTransactionStatus('Confirmed', 'Deposit REP')
	expect(poolBody).toContain('All pools')
	await driver.clickButton('Dismiss')
})

productionInteractionTest('reporting-migration', '?workflow=reporting#/pools?simulate=1&simScenario=securitypoolx2', { height: 900, width: 1440 }, async driver => {
	const { completeTransactionReview, isPoolToolSelected, openSeededPool, selectPoolTool } = createWorkflowActions(driver)
	await openSeededPool()
	await driver.waitForBodyText('Will this resolve? (securitypoolx2 #1)')
	await driver.waitForBodyWithoutText('Loading vault details…')
	await driver.waitForButtonEnabled('Deposit REP')
	await driver.clickButton('Deposit REP')
	await driver.waitForBodyText('REP backing')
	await driver.setInputByLabel('REP backing', '2000000')
	let reportingDepositReady = false
	for (let attempt = 0; attempt < 600 && !reportingDepositReady; attempt += 1) {
		const readiness = await driver.evaluate(
			`(() => { const dialog = document.querySelector('[role="dialog"]'); const buttons = [...(dialog?.querySelectorAll('button') ?? [])]; const deposit = buttons.find(candidate => candidate.textContent?.trim() === 'Deposit REP'); if (deposit instanceof HTMLButtonElement && !deposit.disabled) return true; const approval = buttons.find(candidate => candidate.textContent?.trim().startsWith('Approve ') && !candidate.disabled); if (approval instanceof HTMLButtonElement) { approval.click(); return 'approval' } return false })()`,
		)
		reportingDepositReady = readiness === true
		if (!reportingDepositReady) await Bun.sleep(50)
	}
	expect(reportingDepositReady).toBe(true)
	await driver.clickButton('Deposit REP', 1)
	await completeTransactionReview('Deposit REP')
	await driver.waitForTransactionStatus('Confirmed', 'Deposit REP')
	await driver.clickButton('Dismiss')
	await driver.clickButton('+1 year')
	await selectPoolTool('Price oracle')
	await driver.waitForButtonEnabled('Request new price…')
	await driver.clickButton('Request new price…')
	await driver.waitForButtonEnabled('Fetch from Uniswap')
	expect(await driver.evaluate("document.querySelector('.request-price-fields input')?.value")).toBe('')
	expect(await driver.evaluate("document.querySelector('.transaction-funding') === null")).toBe(true)
	expect(await driver.evaluate("[...document.querySelectorAll('.transaction-step-actions .tx-action-button')].every(button => button.disabled)")).toBe(true)
	const priceDialogGeometry = () =>
		driver.evaluate(`['[role="dialog"]', '.request-price-fields input', '.transaction-step-actions', '.transaction-plan-action-final button'].map(selector => {
			const element = document.querySelector(selector)
			if (element === null) throw new Error('Missing price dialog element: ' + selector)
			const rect = element.getBoundingClientRect()
			return [rect.top, rect.width, rect.height].map(value => Math.round(value))
		})`)
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 390, height: 844 },
	]) {
		await driver.resize(viewport)
		await driver.setInputByLabel(securityPoolCopy.manualRepPerEth, '')
		await driver.waitForBodyText('Enter a starting price')
		expect(await driver.evaluate("document.querySelector('.transaction-funding') === null")).toBe(true)
		const emptyGeometry = await priceDialogGeometry()
		const emptyInputWidth = await driver.evaluate("Math.round(document.querySelector('.request-price-fields input')?.getBoundingClientRect().width ?? 0)")
		await driver.setInputByLabel(securityPoolCopy.manualRepPerEth, 'a')
		await driver.waitForBodyText('Enter a positive REP per ETH price')
		if (viewport.width > 600) expect(await driver.evaluate("Math.round(document.querySelector('.request-price-fields input')?.getBoundingClientRect().width ?? 0)")).toBe(emptyInputWidth)
		else {
			expect(
				await driver.evaluate("(() => { const error = document.querySelector('.request-price-fields .field-error'); const action = document.querySelector('.transaction-step-actions'); return error !== null && action !== null && error.getBoundingClientRect().bottom <= action.getBoundingClientRect().top })()"),
			).toBe(true)
			expect(await driver.evaluate("document.querySelector('[role=dialog]')?.scrollWidth <= document.querySelector('[role=dialog]')?.clientWidth")).toBe(true)
		}
		await driver.setInputByLabel(securityPoolCopy.manualRepPerEth, '')
		await driver.clickButton('Fetch from Uniswap')
		expect(await priceDialogGeometry()).toEqual(emptyGeometry)
		await driver.waitForButtonEnabled('Fetch from Uniswap')
		await driver.waitForBodyWithoutText('Preparing funding and approvals…')
		expect(await driver.evaluate("document.querySelector('.request-price-fields input')?.value")).toBe('3')
		expect(await driver.evaluate("[...document.querySelectorAll('.transaction-plan-action .tx-action-completed button:disabled')].map(button => button.textContent?.trim())")).toEqual(['WETH approved ✓', 'REP approved ✓'])
		expect(await driver.evaluate("document.querySelectorAll('.approval-amount-field input:disabled').length")).toBe(2)
		expect(await driver.evaluate("document.querySelector('[role=dialog]')?.scrollWidth <= document.querySelector('[role=dialog]')?.clientWidth")).toBe(true)
		await driver.setInputByLabel(securityPoolCopy.manualRepPerEth, '2')
		await driver.waitForBodyText('Preparing funding and approvals…')
		await driver.waitForBodyWithoutText('Preparing funding and approvals…')
		expect(await driver.evaluate("[...document.querySelectorAll('.transaction-plan-action .tx-action-completed button:disabled')].map(button => button.textContent?.trim())")).toEqual(['WETH approved ✓', 'REP approved ✓'])
		await driver.setInputByLabel(securityPoolCopy.manualRepPerEth, '')
		await driver.waitForBodyText('Enter a starting price')
		expect(await priceDialogGeometry()).toEqual(emptyGeometry)
	}
	await driver.resize({ width: 1440, height: 900 })
	expect(await driver.evaluate('document.querySelectorAll(\'[role="dialog"]\').length')).toBe(1)
	await driver.setInputByLabel(securityPoolCopy.manualRepPerEth, '3')
	await driver.waitForBodyText('Preparing funding and approvals…')
	await driver.waitForBodyWithoutText('Preparing funding and approvals…')
	await completeTransactionReview('Requested new price')
	await driver.waitForTransactionStatus('Confirmed', 'Requested new price')
	expect(await driver.evaluate("document.querySelector('.global-transaction-dialog .global-transaction-notice .badge')?.textContent?.trim()")).toBe('Confirmed')
	const priceResultDismissed = await driver.evaluate(`(() => { const button = document.querySelector('.global-transaction-dialog .global-transaction-dismiss'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()`)
	expect(priceResultDismissed).toBe(true)
	await driver.waitForBodyWithoutText('Requested new price')
	expect(await driver.evaluate("document.querySelector('[role=\"dialog\"]') === null && document.querySelector('.global-transaction-dialog') === null")).toBe(true)
	await driver.clickButton('+10 min')
	// The price was requested from the Price oracle tool, and advancing time must not move the view off it.
	expect(await isPoolToolSelected('Price oracle')).toBe(true)
	await driver.waitForBodyText('Pending request')
	const pendingReportId = await driver.evaluate(
		`(() => { const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim().startsWith('Report #')); if (!(button instanceof HTMLButtonElement)) return undefined; const reportId = button.textContent?.trim().slice('Report #'.length).trim(); button.click(); return reportId })()`,
	)
	if (typeof pendingReportId !== 'string' || !/^[0-9]+$/.test(pendingReportId)) throw new Error('Missing pending report ID')
	await driver.waitForButtonEnabled('Settle report')
	await driver.clickButton('Settle report')
	expect(await driver.evaluate("document.querySelector('.operation-modal-panel') === null")).toBe(true)
	const settledTitle = `Settled report #${pendingReportId}`
	await completeTransactionReview(settledTitle)
	await driver.waitForTransactionStatus('Confirmed', settledTitle)
	await driver.clickButton('Dismiss')
	const reportingPoolsOpened = await driver.evaluate(`(() => { history.back(); return true })()`)
	expect(reportingPoolsOpened).toBe(true)
	await selectPoolTool('Price oracle')
	await driver.waitForButtonEnabled('Reporting')
	await driver.clickButton('Reporting')
	await driver.waitForBodyText('Report outcome')

	const selectReportingOutcome = async (outcome: 'Yes' | 'No') => {
		let selected = false
		// Outcome radios stay disabled while reporting details load, which can take well over five seconds on a loaded machine; use the shared body-wait budget.
		for (let attempt = 0; attempt < 2400 && !selected; attempt += 1) {
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
		const amount = await driver.evaluate("document.querySelector('#reporting-contribution-amount')?.value")
		if (typeof amount !== 'string' || amount === '') throw new Error('Missing maximum reporting amount')
		const approvalLabel = `Approve ${amount} REP`
		const reportLabel = `Report ${outcome} · ${amount} REP…`
		const reportedTitle = `Reported ${amount} REP on ${outcome}`
		const approvalRequired = await driver.evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent?.trim() === ${JSON.stringify(approvalLabel)} && !button.disabled)`)
		if (approvalRequired === true) {
			const desktopScreenshotPath = process.env['UI_ORDINARY_REPORTING_DESKTOP_SCREENSHOT']
			const mobileScreenshotPath = process.env['UI_ORDINARY_REPORTING_MOBILE_SCREENSHOT']
			const captureQaScreenshots = (desktopScreenshotPath !== undefined && desktopScreenshotPath !== '') || (mobileScreenshotPath !== undefined && mobileScreenshotPath !== '')
			if (captureQaScreenshots) {
				const dismissAvailable = await driver.evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Dismiss' && !button.disabled)`)
				if (dismissAvailable === true) await driver.clickButton('Dismiss')
				await driver.evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent?.trim() === ${JSON.stringify(approvalLabel)}))?.scrollIntoView({ block: 'center' })`)
			}
			if (desktopScreenshotPath !== undefined && desktopScreenshotPath !== '') await driver.captureScreenshot(desktopScreenshotPath)
			if (mobileScreenshotPath !== undefined && mobileScreenshotPath !== '') {
				await driver.resize({ height: 844, width: 390 })
				await driver.evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent?.trim() === ${JSON.stringify(approvalLabel)}))?.scrollIntoView({ block: 'center' })`)
				await driver.captureScreenshot(mobileScreenshotPath)
				await driver.resize({ height: 900, width: 1440 })
			}
			await driver.clickButton(approvalLabel)
			await completeTransactionReview(`Approved ${amount} REP`)
			await driver.waitForButtonEnabled(reportLabel)
			const approvedDesktopScreenshotPath = process.env['UI_ORDINARY_REPORTING_APPROVED_DESKTOP_SCREENSHOT']
			const approvedMobileScreenshotPath = process.env['UI_ORDINARY_REPORTING_APPROVED_MOBILE_SCREENSHOT']
			const captureApprovedQaScreenshots = (approvedDesktopScreenshotPath !== undefined && approvedDesktopScreenshotPath !== '') || (approvedMobileScreenshotPath !== undefined && approvedMobileScreenshotPath !== '')
			if (captureApprovedQaScreenshots) {
				await driver.evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent?.trim() === ${JSON.stringify(reportLabel)}))?.scrollIntoView({ block: 'center' })`)
			}
			if (approvedDesktopScreenshotPath !== undefined && approvedDesktopScreenshotPath !== '') await driver.captureScreenshot(approvedDesktopScreenshotPath)
			if (approvedMobileScreenshotPath !== undefined && approvedMobileScreenshotPath !== '') {
				await driver.resize({ height: 844, width: 390 })
				await driver.evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent?.trim() === ${JSON.stringify(reportLabel)}))?.scrollIntoView({ block: 'center' })`)
				await driver.captureScreenshot(approvedMobileScreenshotPath)
				await driver.resize({ height: 900, width: 1440 })
			}
		}
		await driver.waitForButtonEnabled(reportLabel)
		await driver.clickButton(reportLabel)
		await completeTransactionReview(reportedTitle)
		await driver.waitForTransactionStatus('Confirmed', reportedTitle)
	}

	await selectReportingOutcome('Yes')
	await driver.waitForBodyText('Selected side is already full at')
	await driver.waitForBodyWithoutText('Submitting report…')
	const vaultLockedDesktopScreenshotPath = process.env['UI_ORDINARY_VAULT_LOCKED_DESKTOP_SCREENSHOT']
	const vaultLockedMobileScreenshotPath = process.env['UI_ORDINARY_VAULT_LOCKED_MOBILE_SCREENSHOT']
	const captureVaultLockedQaScreenshots = (vaultLockedDesktopScreenshotPath !== undefined && vaultLockedDesktopScreenshotPath !== '') || (vaultLockedMobileScreenshotPath !== undefined && vaultLockedMobileScreenshotPath !== '')
	if (captureVaultLockedQaScreenshots) {
		await driver.clickButton('Vaults')
		await driver.waitForBodyText('New vault REP backing is unavailable after this question ends.')
		await driver.waitForBodyWithoutText('Loading vault details…')
		await driver.evaluate(`([...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Deposit REP'))?.scrollIntoView({ block: 'center' })`)
		if (vaultLockedDesktopScreenshotPath !== undefined && vaultLockedDesktopScreenshotPath !== '') await driver.captureScreenshot(vaultLockedDesktopScreenshotPath)
		if (vaultLockedMobileScreenshotPath !== undefined && vaultLockedMobileScreenshotPath !== '') {
			await driver.resize({ height: 844, width: 390 })
			await driver.evaluate(
				`(() => { const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === 'Deposit REP'); const reasonId = button?.getAttribute('aria-describedby'); if (reasonId === null || reasonId === undefined) return; document.getElementById(reasonId)?.scrollIntoView({ block: 'center' }) })()`,
			)
			await driver.captureScreenshot(vaultLockedMobileScreenshotPath)
			await driver.resize({ height: 900, width: 1440 })
		}
		await driver.clickButton('Reporting')
		await driver.waitForBodyText('Report outcome')
	}
	await selectReportingOutcome('No')
	await driver.waitForButtonEnabled('Trigger universe fork')
	await driver.clickButton('Trigger universe fork')
	await completeTransactionReview()
	await driver.waitForButtonEnabled('Open fork & migration')
	await driver.clickButton('Open fork & migration')
	await driver.waitForBodyText('Fork & migration')

	// The fork workflow view now owns the full migration flow; drive it directly.
	await driver.waitForButtonEnabled('Migrate pool to Yes universe')
	await driver.clickButton('Migrate pool to Yes universe')
	await completeTransactionReview('Migrate REP to Zoltar')
	await driver.waitForTransactionStatus('Confirmed', 'Migrate REP to Zoltar')
	await driver.waitForButtonEnabled('Migrate vault to Yes')
	await driver.clickButton('Migrate vault to Yes')
	await completeTransactionReview('Migrate vault')
	await driver.waitForTransactionStatus('Confirmed', 'Migrate vault')
})

productionInteractionTest('deployment-auction', '#/deploy?simulate=1&simScenario=baseline', { height: 900, width: 1440 }, async driver => {
	await driver.evaluate('document.body.focus()')
	await driver.pressTab()
	expect(await driver.evaluate('document.activeElement?.textContent?.trim()')).toBe('Skip to main content')
	await driver.waitForButtonEnabled('Deploy next missing')
	await driver.clickButton('Deploy next missing')
	const deployedBody = await driver.waitForBodyText('1 / 15')
	expect(deployedBody).toContain('Proxy Deployer')
	expect(deployedBody).not.toContain('Failed to initialize the app environment')
	// Keep the lightweight deployment boot before the expensive auction fixture, as in the original workflow.
	await driver.navigate('?workflow=auction#/pools?simulate=1&simScenario=securitypoolx2-auction')
	await driver.waitForBodyText('Browse pools')
	await driver.waitForBodyWithoutText('BOOTSTRAPPING')
	const { completeTransactionReview, openSeededPool, selectPoolTool, loadSeededPools } = createWorkflowActions(driver)
	const universeDirectoryOpened = await driver.evaluate(`(() => { const link = [...document.querySelectorAll('a')].find(candidate => candidate.textContent?.trim() === 'Universe' && candidate.href.includes('#/pools/universes')); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true })()`)
	expect(universeDirectoryOpened).toBe(true)
	await driver.waitForBodyText('Open universe by ID')
	await driver.waitForBodyText('Child universes')
	await driver.waitForBodyWithoutText('Loading outcomes…')
	expect(await driver.evaluate("document.querySelectorAll('.universe-browser .entity-card-list').length")).toBe(0)
	// The fixture has one auction child; its fork outcome opens the child without entering its ID.
	const auctionPools = (await loadSeededPools()).filter(pool => pool.parent !== zeroAddress && pool.truthAuction !== zeroAddress)
	expect(auctionPools).toHaveLength(1)
	const auctionPool = auctionPools[0]
	if (auctionPool === undefined) throw new Error('Seeded auction child pool was not available')
	const openedOutcome = await driver.evaluate(`(() => { const button = document.querySelector('.universe-browser button[aria-label="Open Yes universe"]'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()`)
	expect(openedOutcome).toBe(true)
	expect(await driver.evaluate("new URLSearchParams(location.hash.split('?')[1] ?? '').get('universe')")).toBe(auctionPool.universeId.toString())
	await driver.waitForBodyWithoutText('Loading universe details')
	const childPoolBrowserOpened = await driver.evaluate(`(() => { const link = [...document.querySelectorAll('a')].find(candidate => candidate.textContent?.trim() === 'Browse pools'); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true })()`)
	expect(childPoolBrowserOpened).toBe(true)
	await driver.clickButton('+1 month')
	await openSeededPool('auction')
	const auctionPoolBody = await driver.waitForBodyText('All pools')
	if (auctionPoolBody.includes('Universe mismatch')) {
		const childUniverseOpened = await driver.evaluate(`(() => { const link = document.querySelector('section.tone-critical a.universe-link'); if (!(link instanceof HTMLAnchorElement)) return false; link.click(); return true })()`)
		expect(childUniverseOpened).toBe(true)
	}
	await driver.waitForBodyWithoutText('Universe mismatch')
	await selectPoolTool('Fork & migration')
	await driver.waitForButtonEnabled('Finalize truth auction')
	await driver.clickButton('Finalize truth auction')
	await completeTransactionReview('Finalize truth auction')
	const finalizedBody = await driver.waitForTransactionStatus('Confirmed', 'Finalize truth auction')
	expect(finalizedBody).toContain('Truth auction')
	expect(finalizedBody).toContain('Finalize truth auction')
})

function parseDisplayedAttoAmount(value: unknown, unit: string) {
	if (typeof value !== 'string' || !value.endsWith(` ${unit}`)) throw new Error(`Expected an exact ${unit} amount, got ${String(value)}`)
	const [whole = '', fraction = ''] = value
		.slice(0, -unit.length - 1)
		.replaceAll(' ', '')
		.split('.')
	if (!/^[0-9]+$/.test(whole) || !/^[0-9]{0,18}$/.test(fraction)) throw new Error(`Expected an exact ${unit} amount, got ${value}`)
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

async function readTechnicalTransactionRow(driver: ProductionBrowserDriver, label: 'Contract' | 'Function') {
	return await driver.evaluate(`[...document.querySelectorAll('.global-transaction-dialog .global-transaction-notice-row')].find(row => row.querySelector('dt')?.textContent?.trim() === ${JSON.stringify(label)})?.querySelector('dd')?.textContent?.trim()`)
}

async function readButtonDisabledReason(driver: ProductionBrowserDriver, label: string) {
	return await driver.evaluate(
		`(() => { const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === ${JSON.stringify(label)}); if (!(button instanceof HTMLButtonElement)) return undefined; const ids = button.getAttribute('aria-describedby')?.split(' ') ?? []; return JSON.stringify({ disabled: button.disabled, reason: ids.map(id => document.getElementById(id)?.textContent?.trim() ?? '').join(' ') }) })()`,
	)
}

productionInteractionTest('ended-pool-exit', '?workflow=ended#/pools?simulate=1&simScenario=ended-pool-commitment', { height: 900, width: 1440 }, async driver => {
	const { openSeededPool } = createWorkflowActions(driver)
	const readWalletRepAttoRep = async () => {
		const accountMenu = 'Account menu 0x000000…0000A1'
		await driver.clickButton(accountMenu)
		await driver.waitForBodyText('REP/ETH')
		const balance = await driver.evaluate(`document.querySelector('[data-wallet-asset="REP"] button')?.getAttribute('title')`)
		await driver.clickButton(accountMenu)
		return parseDisplayedAttoAmount(balance, 'REP')
	}
	await openSeededPool()
	await driver.waitForBodyText('Will this resolve? (ended pool)')
	await driver.waitForBodyText('FINALIZED AS YES')
	await driver.waitForButtonEnabled('Open vaults')
	await driver.clickButton('Open vaults')
	await driver.waitForBodyWithoutText('Loading vault details…')
	await driver.waitForButtonEnabled('Set commitment limit')
	const walletRepBeforeRedemption = await readWalletRepAttoRep()

	// With a commitment above 0, the ended pool blocks redemption and explains the exit path.
	const blockedBody = await driver.waitForBodyText('Set your commitment limit to 0 ETH before redeeming REP.')
	expect(blockedBody).toContain('Commitment limit\n80.00 ETH')
	expect(blockedBody).toContain('Vault REP backing\n10 000.00 REP')
	expect(JSON.parse(String(await readButtonDisabledReason(driver, 'Redeem REP')))).toEqual({ disabled: true, reason: 'Set your commitment limit to 0 ETH before redeeming REP. The pool keeps vault REP locked while the vault still has a commitment.' })

	// The resolved question makes the price coordinator reject staged operations, so the change goes straight to the pool.
	await driver.clickButton('Set commitment limit')
	await driver.waitForBodyText('The question has resolved, so this change goes straight to the pool without an oracle price.')
	await driver.setInputByLabel('Commitment limit', '0')
	await driver.waitForBodyText('Resulting commitment\n0 ETH')
	await driver.clickButton('Set commitment limit', 1)
	await driver.waitForTransactionStatus('Confirmed', 'Set commitment limit')
	expect(await readTechnicalTransactionRow(driver, 'Function')).toBe('setUnderwritingLimit')
	expect(await readTechnicalTransactionRow(driver, 'Contract')).toStartWith('SecurityPool (')
	await driver.waitForBodyText('Commitment limit changed')
	const exitedBody = await driver.waitForBodyText('Commitment limit\n0 ETH')
	expect(exitedBody).not.toContain('Queued')
	await driver.clickButton('Dismiss')

	await driver.waitForButtonEnabled('Redeem REP')
	await driver.clickButton('Redeem REP')
	await driver.waitForTransactionStatus('Confirmed', 'Redeem REP')
	expect(await readTechnicalTransactionRow(driver, 'Function')).toBe('redeemRepFromVault')
	await driver.clickButton('Dismiss')
	const redeemedBody = await driver.waitForBodyText('No redeemable REP is available for this vault.')
	expect(redeemedBody).not.toContain('Vault REP backing\n10 000.00 REP')
	expect(await readWalletRepAttoRep()).toBe(walletRepBeforeRedemption + 10_000n * 10n ** 18n)
})

productionInteractionTest('liquidation-distance', '?workflow=liquidation#/pools?simulate=1&simScenario=liquidation-distance', { height: 900, width: 1440 }, async driver => {
	const { openSeededPool } = createWorkflowActions(driver)
	const readVaultCommitment = async (vaultAddress: string) =>
		await driver.evaluate(
			`(() => { const row = [...document.querySelectorAll('.vault-position-strip')].find(candidate => candidate.querySelector('.vault-position-title-copy')?.textContent?.toLowerCase().includes(${JSON.stringify(vaultAddress.toLowerCase())})); return [...(row?.querySelectorAll('.vault-preview-strip > div') ?? [])].find(metric => metric.querySelector('.metric-label')?.textContent?.trim() === 'Commitment limit')?.querySelector('.currency-value')?.getAttribute('title') })()`,
		)
	const openLiquidationReview = async (targetVault: string) => {
		const opened = await driver.evaluate(
			`(() => { const row = [...document.querySelectorAll('.vault-position-strip')].find(candidate => candidate.querySelector('.vault-position-title-copy')?.textContent?.toLowerCase().includes(${JSON.stringify(targetVault.toLowerCase())})); const button = [...(row?.querySelectorAll('.vault-more-actions button') ?? [])].find(candidate => candidate.textContent?.trim() === 'Liquidate vault'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true })()`,
		)
		expect(opened).toBe(true)
		await driver.waitForBodyText('Commitment to transfer')
		// A valid settled price selects direct execution, so the review checks the protocol distance at that price.
		await driver.waitForBodyWithoutText(liquidationCopy.refreshingPriceValidity)
		await driver.waitForBodyText(liquidationCopy.executeVaultLiquidation)
		const modalBody = String(await driver.evaluate(`document.querySelector('[role="dialog"]')?.innerText`))
		expect(modalBody.toLowerCase()).toContain(targetVault.toLowerCase())
		expect(modalBody).toMatch(/4\.00\sREP\sper\sETH/)
	}
	const nearTargetVault = '0x00000000000000000000000000000000000000b2'
	const farTargetVault = '0x00000000000000000000000000000000000000c3'
	await openSeededPool()
	await driver.waitForBodyText('Will this resolve? (liquidation distance)')
	await driver.waitForButtonEnabled('Vaults')
	await driver.clickButton('Vaults')
	await driver.waitForButtonEnabled('All vaults')
	await driver.clickButton('All vaults')
	await driver.waitForBodyText(nearTargetVault)
	expect(await readVaultCommitment(nearTargetVault)).toBe('128 ETH')
	expect(await readVaultCommitment(farTargetVault)).toBe('160 ETH')

	// Undercollateralized, but its 3.906 REP/ETH threshold is only 2.3% below the 4 REP/ETH price.
	await openLiquidationReview(nearTargetVault)
	await driver.setInputByLabel('Commitment to transfer', '10')
	await driver.waitForBodyText(liquidationCopy.formatLiquidationDistanceTooLowReason('10%'))
	expect(JSON.parse(String(await readButtonDisabledReason(driver, 'Execute vault liquidation')))).toEqual({ disabled: true, reason: liquidationCopy.formatLiquidationDistanceTooLowReason('10%') })
	expect(await driver.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.trim() === 'Max')?.disabled`)).toBe(true)
	await driver.clickButton('Cancel')
	await driver.waitForBodyWithoutText('Commitment to transfer')

	// Its 3.125 REP/ETH threshold is 21.9% below the price, past the minimum distance.
	await openLiquidationReview(farTargetVault)
	await driver.waitForButtonEnabled('Max')
	await driver.clickButton('Max')
	await driver.waitForButtonEnabled('Execute vault liquidation')
	expect(await driver.evaluate('document.body.innerText')).not.toContain(liquidationCopy.formatLiquidationDistanceTooLowReason('10%'))
	await driver.clickButton('Execute vault liquidation')
	await driver.waitForTransactionStatus('Confirmed', 'Liquidation executed')
	await driver.clickButton('Dismiss')
	let commitments: unknown[] = []
	for (let attempt = 0; attempt < 600; attempt += 1) {
		commitments = await Promise.all([readVaultCommitment(farTargetVault), readVaultCommitment(nearTargetVault), readVaultCommitment('0x00000000000000000000000000000000000000a1')])
		if (commitments[0] === '0 ETH') break
		await Bun.sleep(50)
	}
	expect(commitments).toEqual(['0 ETH', '128 ETH', '240 ETH'])
})
