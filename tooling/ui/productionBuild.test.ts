import { AUGUR_GENESIS_FORK_QUESTION } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as process from 'node:process'
import { bytesToHex, decodeFunctionResult, encodeFunctionData, getAddress, hexToBytes, zeroAddress, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createSimulationProfile } from '../../ui/coreShared/ts/wallet/networkProfile.js'
import { getInfraContractAddresses } from '../../ui/statoblastShared/ts/protocol/deploymentHelpers.js'
import { getDeploymentSteps } from '../../ui/statoblastShared/ts/protocol/deployment.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory } from '../../ui/statoblastShared/ts/contractArtifact.js'
import * as portfolioCopy from '../../ui/statoblastShared/ts/copy/portfolio.js'
import * as collateralCopy from '../../ui/statoblastShared/ts/copy/collateral.js'
import * as capitalCopy from '../../ui/statoblastShared/ts/copy/portfolioCapital.js'
import { UI_APP_IDS, featureStylesheets, getUiAppPaths, getUiCoreSharedPaths, isUiAppId, type UiAppId } from './appPaths.mts'
import { launchChromium, writeViewportScreenshot } from './chromiumDevTools.mts'
import { getChromiumPath, withChromiumTestLock } from './chromiumPath.js'
import { createProductionBrowserNavigation } from './productionBrowserNavigation.ts'
import { browserButtonNameExpression, createProductionBrowserActions } from './productionBrowserActions.ts'
import { productionWorkflowTestName, selectProductionWorkflowScenarios, type ProductionWorkflowScenario } from './productionWorkflowScenarios.ts'

const appPathsById = new Map(UI_APP_IDS.map(appId => [appId, getUiAppPaths(appId)]))
const repositoryRootPath = getUiCoreSharedPaths().repositoryRoot
const CHROMIUM_COMMAND_TIMEOUT_MILLISECONDS = 30_000
const PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS = 120_000
const PORTFOLIO_BROWSER_TIMEOUT_MILLISECONDS = 600_000
const PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS = 600_000

let server: Bun.Server | undefined

const chromiumPath = getChromiumPath()
const productionBrowserTest = (name: string, run: () => Promise<void>) => test(name, run, PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS)
const selectedWorkflowScenarios = selectProductionWorkflowScenarios(process.env['ZOLTAR_BROWSER_WORKFLOW_SCENARIO'])
const productionWorkflowTest = (scenario: ProductionWorkflowScenario, run: () => Promise<void>) => {
	const register = process.env['RUN_PRODUCTION_BROWSER_WORKFLOWS'] === '1' && selectedWorkflowScenarios.includes(scenario) ? test : test.skip
	// Oracle funding, reporting, fork creation and child migration share one complete transaction workflow.
	const timeoutMilliseconds = PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS
	register(productionWorkflowTestName(scenario), run, timeoutMilliseconds)
}
const productionRebuildInvariantTest = process.env['ZOLTAR_USE_EXISTING_PRODUCTION_BUILD'] === '1' && process.env['ZOLTAR_RUN_PRODUCTION_REBUILD_INVARIANTS'] !== '1' ? test.skip : test

function stylesheetHrefs(html: string) {
	return [...html.matchAll(/<link\b[^>]*>/giu)].flatMap(([tag]) => {
		if (!/\brel=["']stylesheet["']/iu.test(tag)) return []
		const href = /\bhref=["']([^"']+)["']/iu.exec(tag)?.[1]
		if (href === undefined) throw new Error('Stylesheet link must define href')
		return [href]
	})
}

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
	const expectedTitles: Record<UiAppId, string> = { openoracle: 'OpenOracle', statoblast: 'Augur Statoblast', trading: 'Statoblast Trading', zoltar: 'Zoltar' }
	const expectedTitle = expectedTitles[appId]
	const otherTitles = ['Zoltar', 'Augur Statoblast', 'Statoblast Trading'].filter(title => title !== expectedTitle)
	const expectedRoutes: Record<UiAppId, string> = { openoracle: '#/open-oracle', statoblast: '#/pools', trading: '#/markets', zoltar: '#/zoltar' }
	const expectedRoute = expectedRoutes[appId]

	test(`${appId} production includes the same stylesheets as development`, async () => {
		const developmentHtml = await fs.readFile(appPaths.appIndexHtml, 'utf8')
		const productionHtml = await fs.readFile(productionIndexPath, 'utf8')
		const productionStyles = await Promise.all(stylesheetHrefs(productionHtml).map(href => fs.readFile(path.join(distRootPath, href), 'utf8')))
		const missingStyles: string[] = []
		for (const href of stylesheetHrefs(developmentHtml)) {
			const sourcePath = href.startsWith('/') ? path.join(repositoryRootPath, href) : path.join(appPaths.appRoot, href)
			if (!productionStyles.includes(await fs.readFile(sourcePath, 'utf8'))) missingStyles.push(href)
		}
		expect(missingStyles).toEqual([])
	})

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
	waitForReady: () => Promise<void>
	waitForTransactionStatus: (status: string, title: string) => Promise<string>
}

async function loadProductionDocumentInChromiumUnlocked(pageUrl: string, viewport: { height: number; width: number }, interact?: (driver: ProductionBrowserDriver) => Promise<void>, bootstrapTimeoutMilliseconds = PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS) {
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
		const navigation = createProductionBrowserNavigation({
			bootstrapTimeoutMilliseconds,
			navigateDocument: async url => {
				const result = await send('Page.navigate', { url })
				return { startsNewDocument: typeof result === 'object' && result !== null && 'loaderId' in result && typeof result.loaderId === 'string' }
			},
			readDocument: async () => {
				const document = await evaluate('({ body: document.body?.innerText ?? "", timeOrigin: performance.timeOrigin })')
				if (typeof document !== 'object' || document === null || !('body' in document) || typeof document.body !== 'string' || !('timeOrigin' in document) || typeof document.timeOrigin !== 'number') throw new Error('Chromium did not return production document state')
				return { body: document.body, timeOrigin: document.timeOrigin }
			},
		})

		await send('Runtime.enable')
		await send('Page.enable')
		await send('Page.addScriptToEvaluateOnNewDocument', {
			source: `(() => { const NativeWorker = window.Worker; window.__zoltarProductionWorkers = []; window.Worker = class TrackedProductionWorker extends NativeWorker { constructor(...args) { super(...args); window.__zoltarProductionWorkers.push(this) } } })()`,
		})
		await resize(viewport)
		await navigation.navigate(pageUrl)
		const driver: ProductionBrowserDriver = {
			...createProductionBrowserActions({ evaluate, readBody }),
			captureScreenshot: async screenshotPath => await writeViewportScreenshot(send, screenshotPath),
			evaluate,
			evaluateAsync: expression => page.evaluate(expression),
			navigate: async url => {
				await navigation.navigate(new URL(url, pageUrl).href)
			},
			pressTab: async () => {
				await send('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyDown' })
				await send('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyUp' })
			},
			resize,
			setInputByLabel: async (label, value) => {
				const updated = await evaluate(
					`(() => { const label = [...document.querySelectorAll('label')].find(candidate => candidate.textContent?.trim() === ${JSON.stringify(label)} || [...candidate.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim() === ${JSON.stringify(label)} || [...candidate.querySelectorAll('span')].some(span => span.textContent?.trim() === ${JSON.stringify(label)})); const input = label?.control; if (!(input instanceof HTMLInputElement)) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
				)
				if (updated !== true) throw new Error(`Unable to update browser input ${label}`)
			},
			waitForButtonEnabled: async (label, occurrence = 0) => {
				for (let attempt = 0; attempt < 600; attempt += 1) {
					const enabled = await evaluate(`[...document.querySelectorAll('button')].filter(button => ${browserButtonNameExpression} === ${JSON.stringify(label)} && !button.disabled)[${occurrence.toString()}] instanceof HTMLButtonElement`)
					if (enabled === true) return
					await Bun.sleep(50)
				}
				throw new Error(`Timed out waiting for enabled browser button ${label}. Last body: ${await readBody()}`)
			},
			waitForBodyText: async text => await waitForBody(body => body.includes(text), JSON.stringify(text)),
			waitForBodyWithoutText: async text => await waitForBody(body => !body.includes(text), `body to omit ${JSON.stringify(text)}`),
			waitForReady: navigation.waitForReady,
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

async function loadProductionDocumentInChromium(pageUrl: string, viewport: { height: number; width: number }, interact?: (driver: ProductionBrowserDriver) => Promise<void>, bootstrapTimeoutMilliseconds = PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS) {
	return await withChromiumTestLock(async () => await loadProductionDocumentInChromiumUnlocked(pageUrl, viewport, interact, bootstrapTimeoutMilliseconds))
}

const productionBrowserScenarios = [
	{
		appId: 'zoltar',
		hash: '#/deploy?simulate=1&genesis=yes&simScenario=baseline',
		expected: 'Deploy contracts',
		workflow: false,
		name: 'zoltar baseline deployment',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'zoltar',
		hash: '#/zoltar?simulate=1&genesis=yes&simScenario=deployed',
		expected: 'Questions',
		workflow: false,
		name: 'zoltar deployed protocol',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'zoltar',
		hash: '#/zoltar?simulate=1&genesis=no&simScenario=deployed',
		expected: 'Questions',
		workflow: false,
		name: 'zoltar No genesis deployed protocol',
		viewport: { height: 844, width: 390 },
	},
	{
		appId: 'openoracle',
		hash: '#/deploy?simulate=1&simScenario=baseline',
		expected: 'Deploy contracts',
		workflow: false,
		name: 'openoracle baseline deployment',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'openoracle',
		hash: '#/open-oracle?simulate=1&simScenario=deployed',
		expected: 'Browse reports',
		workflow: false,
		name: 'openoracle deployed report browser at narrow width',
		viewport: { height: 844, width: 390 },
	},
	{
		appId: 'statoblast',
		hash: '#/deploy?simulate=1&genesis=yes&simScenario=baseline',
		expected: 'Deploy contracts',
		workflow: false,
		name: 'statoblast baseline deployment',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'statoblast',
		hash: '#/pools?simulate=1&genesis=yes&simScenario=security-pool',
		expected: 'Portfolio questions',
		workflow: false,
		name: 'statoblast seeded pool at narrow width',
		viewport: { height: 844, width: 390 },
	},
	{
		appId: 'statoblast',
		hash: '#/pools?simulate=1&genesis=no&simScenario=security-pool',
		expected: 'Portfolio questions',
		workflow: false,
		name: 'statoblast No genesis seeded pool',
		viewport: { height: 900, width: 1440 },
	},
	{
		appId: 'trading',
		hash: '#/markets?simulate=1&genesis=no&simScenario=trading-funded',
		expected: 'Markets',
		workflow: false,
		name: 'trading No genesis funded market',
		viewport: { height: 844, width: 390 },
	},
	{
		appId: 'statoblast',
		hash: '#/portfolios?simulate=1&genesis=yes&simScenario=portfolio-auction',
		expected: 'Fork choices and recovery',
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
		const state = JSON.parse(await loadProductionDocumentInChromium(`${baseUrl}/${scenario.appId}/${scenario.hash}`, scenario.viewport, undefined, scenario.workflow ? PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS : PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS))
		if (typeof state !== 'object' || state === null || !('body' in state) || !('html' in state) || typeof state.body !== 'string' || typeof state.html !== 'string' || !('height' in state) || !('width' in state)) {
			throw new Error(`${scenario.name} returned an invalid document state`)
		}
		expect(state.html).toContain('<main')
		expect(state.body).toContain(scenario.expected)
		const appNames = { zoltar: 'Zoltar', trading: 'Statoblast Trading', statoblast: 'Augur Statoblast', openoracle: 'OpenOracle' }
		expect(state.body).toContain(appNames[scenario.appId])
		expect(state.body).toContain('Browser simulation')
		expect(state.height).toBe(scenario.viewport.height)
		expect(state.width).toBe(scenario.viewport.width)
		expect(state.body).not.toContain('Failed to initialize the app environment')
	}
	if (scenario.workflow) productionWorkflowTest('auction-boot', run)
	else productionBrowserTest(`production bundle boots the ${scenario.name} scenario in Chromium`, run)
}

test(
	'production bundle boots the authenticated Statoblast portfolio and seeded question balances in Chromium',
	async () => {
		if (server === undefined) throw new Error('Production test server did not start')
		const baseUrl = server.url.toString().replace(/\/$/, '')
		await loadProductionDocumentInChromium(
			`${baseUrl}/statoblast/#/portfolios?simulate=1&genesis=yes&simScenario=portfolio`,
			{ height: 900, width: 1440 },
			async driver => {
				// Worker bootstrap can finish before main-thread discovery authenticates the ledger.
				const body = await driver.waitForBodyText(capitalCopy.priceValid.toUpperCase())
				expect(body).toContain('Browser simulation')
				expect(body).not.toContain('Could not load the portfolio snapshot')
				expect(body).toContain(capitalCopy.prepareProgress(4))
				await driver.waitForButtonEnabled(capitalCopy.claim)
				const seededPools = await createWorkflowActions(driver).loadSeededPools()
				const questionIds = seededPools
					.filter(pool => pool.universeId === 0n && pool.parent === zeroAddress)
					.slice(0, 2)
					.map(pool => String(pool.questionId))
				expect(questionIds).toHaveLength(2)
				expect(
					await driver.evaluate(`(() => {
			const input = text => [...document.querySelectorAll('label')].find(label => label.textContent?.trim() === text)?.control?.value;
			const section = title => [...document.querySelectorAll('section')].find(node => node.querySelector('h3')?.textContent === title);
			const capital = section(${JSON.stringify(capitalCopy.title)});
			const backing = section(${JSON.stringify(capitalCopy.poolTitle)});
			const positions = section(${JSON.stringify(capitalCopy.positions)});
			const amounts = (scope, label) => [...scope.querySelectorAll('.metric-label')].filter(node => node.textContent === label).map(node => node.parentElement.querySelector('.currency-value')?.getAttribute('title')?.replace(/\\s/g, ''));
			const questions = [...section(${JSON.stringify(portfolioCopy.mint)}).querySelectorAll('select option')].filter(option => option.value !== '').map(option => String(BigInt(option.value)));
			const manager = input(${JSON.stringify(portfolioCopy.manager)});
			return {
				managerLoaded: /^0x[0-9a-f]{40}$/i.test(manager) && manager.toLowerCase() !== ${JSON.stringify(zeroAddress)},
				owner: input(${JSON.stringify(portfolioCopy.owner)})?.toLowerCase(),
				withdrawableRep: amounts(capital, ${JSON.stringify(capitalCopy.withdrawableRep)}),
				principalRep: amounts(capital, ${JSON.stringify(capitalCopy.principalRep)}),
				commitment: amounts(capital, ${JSON.stringify(capitalCopy.commitment)}),
				poolPledgedRep: amounts(backing, ${JSON.stringify(capitalCopy.totalPledged)}),
				positionPledgedRep: amounts(positions, ${JSON.stringify(capitalCopy.positionPledged)}),
				healthyCommitment: amounts(backing, ${JSON.stringify(capitalCopy.healthyCommitment)}),
				health: capital.textContent.includes('120%'),
				positions: positions.querySelectorAll('.workflow-subsection').length,
				feeMetrics: section(${JSON.stringify(capitalCopy.earnings)}).textContent.includes(${JSON.stringify(capitalCopy.ethEarnings)}) && section(${JSON.stringify(capitalCopy.earnings)}).textContent.includes(${JSON.stringify(capitalCopy.repEarnings)}),
				questions: questions.toSorted()
			};
		})()`),
				).toEqual({
					managerLoaded: true,
					owner: '0x00000000000000000000000000000000000000a1',
					// The seeded 3 REP/WETH price, 5% oracle band and 2× multiplier retain 75.789473684210526336 REP at the saved 120% target.
					withdrawableRep: ['4924.210526315789473664REP'],
					principalRep: ['5000REP'],
					commitment: ['10WETH'],
					poolPledgedRep: ['5000REP'],
					positionPledgedRep: ['5000REP'],
					healthyCommitment: ['10WETH'],
					health: true,
					positions: 1,
					feeMetrics: true,
					questions: questionIds.toSorted(),
				})
			},
			PORTFOLIO_BROWSER_TIMEOUT_MILLISECONDS - PRODUCTION_BROWSER_TIMEOUT_MILLISECONDS,
		)
	},
	PORTFOLIO_BROWSER_TIMEOUT_MILLISECONDS,
)

for (const appId of ['zoltar', 'statoblast', 'trading'] as const) {
	productionBrowserTest(`production bundle requires a genesis choice before starting ${appId}`, async () => {
		if (server === undefined) throw new Error('Production test server did not start')
		const baseUrl = server.url.toString().replace(/\/$/, '')
		await loadProductionDocumentInChromium(`${baseUrl}/${appId}/?simulate=1&simScenario=baseline`, { height: 844, width: 390 }, async driver => {
			const body = await driver.waitForBodyText(AUGUR_GENESIS_FORK_QUESTION.title)
			expect(body).toContain('Choose the truthful universe')
			expect(body).toContain('If the rocket explodes on the launch pad while attempting to launch on a launch day, then this market will resolve as No.')
			expect(body).toContain('2026-04-08 00:00:00 UTC')
			expect(body).toContain('Market address')
			expect(
				await driver.evaluate(`(() => {
					const question = document.querySelector('.question-summary')
					return { links: [...question.querySelectorAll('a')].map(link => ({ href: link.getAttribute('href'), target: link.getAttribute('target'), noreferrer: link.relList.contains('noreferrer'), nestedButton: link.querySelector('button, [role="button"]') !== null })), copyLabels: [...question.querySelectorAll('[role="button"]')].map(button => button.getAttribute('aria-label')) }
				})()`),
			).toEqual({
				links: [AUGUR_GENESIS_FORK_QUESTION.marketAddress, AUGUR_GENESIS_FORK_QUESTION.creator, AUGUR_GENESIS_FORK_QUESTION.designatedReporter].map(address => ({ href: `https://etherscan.io/address/${address}`, target: '_blank', noreferrer: true, nestedButton: false })),
				copyLabels: [AUGUR_GENESIS_FORK_QUESTION.marketAddress, AUGUR_GENESIS_FORK_QUESTION.creator, AUGUR_GENESIS_FORK_QUESTION.designatedReporter].map(address => `Copy address ${address}`),
			})
			expect(await driver.evaluate('window.__zoltarProductionWorkers.length')).toBe(0)
			await driver.clickButton('Open No universe')
			await driver.waitForBodyText('Browser simulation')
			expect(await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.genesisOutcome')).toBe('no')
			expect(await driver.evaluate('new URLSearchParams(location.search).get("genesis")')).toBe('no')
		})
	})
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
	// Read fixture addresses from the seeded chain, then use the same address-entry flow as a user.
	const loadSeededPools = async () => {
		await driver.waitForReady()
		const genesisRepTokenAddress = await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.genesisRepTokenAddress')
		const wethAddress = await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.wethAddress')
		if (typeof genesisRepTokenAddress !== 'string' || typeof wethAddress !== 'string') throw new Error('Simulation network profile was not available')
		const profile = createSimulationProfile({ genesisOutcome: 'yes', genesisRepTokenAddress: getAddress(genesisRepTokenAddress), wethAddress: getAddress(wethAddress) })
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
	return { completeTransactionReview, loadSeededPools }
}

function productionInteractionTest(scenario: ProductionWorkflowScenario, route: string, viewport: { height: number; width: number }, interact: (driver: ProductionBrowserDriver) => Promise<void>) {
	productionWorkflowTest(scenario, async () => {
		if (server === undefined) throw new Error('Production test server did not start')
		if (chromiumPath === undefined) throw new Error('Chromium is required for the production browser workflow test')
		const baseUrl = server.url.toString().replace(/\/$/, '')
		const state = JSON.parse(await loadProductionDocumentInChromium(`${baseUrl}/statoblast/${route}`, viewport, interact, PRODUCTION_WORKFLOW_TIMEOUT_MILLISECONDS))
		if (typeof state !== 'object' || state === null || !('body' in state) || typeof state.body !== 'string') throw new Error('Production workflow returned invalid document state')
		expect(state.body).not.toContain('Failed to initialize the app environment')
		expect(state.height).toBe(viewport.height)
		expect(state.width).toBe(viewport.width)
	})
}

async function portfolioMetric(driver: ProductionBrowserDriver, label: string) {
	return driver.evaluate(`(() => { const field = [...document.querySelectorAll('.metric-label')].find(node => node.textContent === ${JSON.stringify(label)}); return field?.parentElement.querySelector('.currency-value')?.getAttribute('title')?.replace(/\\s/g, '') })()`)
}

productionInteractionTest('capital-recovery', '#/portfolios?simulate=1&genesis=yes&simScenario=portfolio', { height: 844, width: 390 }, async driver => {
	await driver.waitForBodyText(capitalCopy.priceValid.toUpperCase())
	const before = await portfolioMetric(driver, capitalCopy.principalRep)
	expect(before).toBe('5000REP')
	await driver.setInputByLabel(capitalCopy.repAmount, '1')
	await driver.waitForButtonEnabled('Approve 1\u00a0REP')
	await driver.clickButton('Approve 1\u00a0REP')
	await createWorkflowActions(driver).completeTransactionReview(undefined, portfolioCopy.confirmed)
	await driver.waitForButtonEnabled(capitalCopy.deposit)
	await driver.clickButton(capitalCopy.deposit)
	const failureInjected = await driver.evaluate(
		`(() => { const worker = window.__zoltarProductionWorkers?.at(-1); if (!(worker instanceof Worker)) return false; const original = worker.postMessage.bind(worker); Object.defineProperty(worker, 'postMessage', { configurable: true, value: (...args) => { if (args[0]?.type === 'rpc' && args[0]?.method === 'eth_sendTransaction') { Object.defineProperty(worker, 'postMessage', { configurable: true, value: original }); throw new Error('Injected production workflow failure') } return original(...args) } }); return true })()`,
	)
	expect(failureInjected).toBe(true)
	await createWorkflowActions(driver).completeTransactionReview(undefined, 'Injected production workflow failure')
	await driver.waitForBodyText('Injected production workflow failure')
	expect(await portfolioMetric(driver, capitalCopy.principalRep)).toBe(before)
	await driver.clickButton('Close')
	await driver.waitForButtonEnabled(capitalCopy.deposit)
	await driver.clickButton(capitalCopy.deposit)
	await createWorkflowActions(driver).completeTransactionReview(undefined, portfolioCopy.confirmed)
	await driver.waitForBodyText(portfolioCopy.confirmed)
	expect(await portfolioMetric(driver, capitalCopy.principalRep)).toBe('5001REP')
})

productionInteractionTest('portfolio-purchase', '#/portfolios?simulate=1&genesis=yes&simScenario=portfolio', { height: 900, width: 1440 }, async driver => {
	await driver.waitForBodyText(capitalCopy.priceValid.toUpperCase())
	const selected = await driver.evaluate(
		`(() => { const label = [...document.querySelectorAll('label')].find(node => node.textContent === ${JSON.stringify(portfolioCopy.registeredQuestions)}); const select = label?.control; if (!(select instanceof HTMLSelectElement)) return false; const option = [...select.options].find(option => option.value !== ''); if (!option) return false; select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`,
	)
	expect(selected).toBe(true)
	await driver.setInputByLabel(collateralCopy.amount(portfolioCopy.mintAmount, collateralCopy.weth), '0.01')
	await driver.setInputByLabel(collateralCopy.amount(portfolioCopy.maximumPurchaseFee, collateralCopy.weth), '0.1')
	await driver.setInputByLabel(portfolioCopy.minimumShares, '0')
	await driver.waitForButtonEnabled(portfolioCopy.mint)
	await driver.clickButton(portfolioCopy.mint)
	await createWorkflowActions(driver).completeTransactionReview(undefined, portfolioCopy.confirmed)
	await driver.waitForBodyText(portfolioCopy.confirmed)
	expect(await portfolioMetric(driver, capitalCopy.principalRep)).toBe('5000REP')
	expect(await portfolioMetric(driver, capitalCopy.demand)).toContain('WETH')
	expect(await portfolioMetric(driver, capitalCopy.demand)).not.toBe('0WETH')
})

productionInteractionTest('deployment', '#/deploy?simulate=1&genesis=yes&simScenario=baseline', { height: 900, width: 1440 }, async driver => {
	await driver.evaluate('document.body.focus()')
	await driver.pressTab()
	expect(await driver.evaluate('document.activeElement?.textContent?.trim()')).toBe('Skip to main content')
	await driver.waitForButtonEnabled('Deploy next contract')
	const genesisRepTokenAddress = await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.genesisRepTokenAddress')
	const wethAddress = await driver.evaluate('window.__zoltarRuntimeNetworkProfile__?.wethAddress')
	if (typeof genesisRepTokenAddress !== 'string' || typeof wethAddress !== 'string') throw new Error('Simulation network profile was not available')
	const steps = getDeploymentSteps(createSimulationProfile({ genesisOutcome: 'yes', genesisRepTokenAddress: getAddress(genesisRepTokenAddress), wethAddress: getAddress(wethAddress) }))
	await driver.waitForBodyText(`0 / ${steps.length}`)
	await driver.clickButton('Deploy next contract')
	expect(await driver.waitForBodyText(`1 / ${steps.length}`)).toContain('Proxy Deployer')
})
