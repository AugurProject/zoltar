import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { UI_APP_IDS, isUiAppId, type UiAppId } from './appIds.mts'
import { createDevToolsSession, type DevToolsSession } from './browserSmoke.mts'
import { getChromiumPath } from './chromiumPath.js'
import { startDevServer, stopDevServer } from './devServerProcess.mts'
import { layoutAuditExpression, type LayoutAuditOptions, type LayoutFinding, type LayoutFindingKind, type LayoutRect, type LayoutSeverity } from './layoutAudit.ts'
import { installLayoutScanHelpers, type LayoutScanTab } from './layoutScanPage.ts'

const repositoryRoot = path.resolve(import.meta.dir, '..', '..')

const usage = () => `Usage: bun run ui:layout-scan -- --app <ids> [options]

Opens each named UI in the walletless simulation, visits every route, tab, disclosure, and dialog launcher it can reach at
several viewport sizes, and reports content that overflows, is cut off, overlaps, or is squeezed. Each finding names
the element, its measurements, the likely cause, and the source files that render and style it, with a highlighted
screenshot.

Options:
  --app <ids>          Required. Apps to scan, comma separated (${UI_APP_IDS.join(', ')}). Scan the apps whose UI changed.
  --scenario <ids>     Simulation scenarios, comma separated. Default: every scenario the app registers.
  --viewport <list>    Viewports as WIDTHxHEIGHT, comma separated. Default: ${DEFAULT_VIEWPORTS.map(formatViewport).join(', ')}.
  --route <hashes>     Only scan these hash routes, for example "#/portfolio,#/questions".
  --base-url <url>     Scan an already running server instead of building and serving the app (one app only).
  --out <dir>          Report directory. Default: ${path.join(os.tmpdir(), 'zoltar-layout-scan')}.
  --min-severity <s>   Lowest severity to report: low, medium, or high. Default: low.
  --fail-on <s>        Exit with code 1 when a finding of this severity or higher remains: low, medium, or high.
  --no-interactions    Only scan routes as they load: no tabs, disclosures, or dialogs.
  --no-screenshots     Skip the per-finding screenshots.
  --max-states <n>     Most tab states explored per route and viewport. Default: 12.
  --help               Show this help.

Writes <out>/report.md, <out>/report.json, and <out>/screenshots/<finding>.png, and prints a summary.`

type Viewport = { readonly width: number; readonly height: number }

const DEFAULT_VIEWPORTS: readonly Viewport[] = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 768, height: 1024 },
	{ width: 390, height: 844 },
	{ width: 320, height: 640 },
]
const APP_TITLES: Record<UiAppId, string> = { openoracle: 'OpenOracle', statoblast: 'Augur Statoblast', trading: 'Statoblast Trading', zoltar: 'Zoltar' }
const SEVERITY_ORDER: Record<LayoutSeverity, number> = { high: 0, medium: 1, low: 2 }
const KIND_TITLES: Record<LayoutFindingKind, string> = {
	'viewport-overflow': 'Runs off the screen',
	clipped: 'Content cut off',
	truncated: 'Truncated without the full text',
	spill: 'Content escapes its box',
	'text-overlap': 'Overlapping text',
	obscured: 'Text hidden behind another element',
	'control-overlap': 'Overlapping controls',
	squeezed: 'Squeezed text',
	'broken-word': 'Word split across lines',
	'wrapped-label': 'Short label wraps',
	'field-clipped': 'Field text cut off',
	'dialog-overflow': 'Dialog larger than the screen',
}
const APP_READY_ATTEMPTS = 1200
const SETTLE_QUIET_MILLISECONDS = 500
const SETTLE_TIMEOUT_MILLISECONDS = 8_000
const SCROLL_STEP_RATIO = 0.8
const OVERLAY_SCROLLBAR_BELOW_WIDTH = 1024

function formatViewport(viewport: Viewport) {
	return `${viewport.width.toString()}x${viewport.height.toString()}`
}

function parseViewports(value: string | undefined): readonly Viewport[] {
	if (value === undefined) return DEFAULT_VIEWPORTS
	return value.split(',').map(entry => {
		const match = /^(\d+)x(\d+)$/.exec(entry.trim())
		if (match?.[1] === undefined || match[2] === undefined) throw new Error(`Invalid viewport '${entry}'; expected WIDTHxHEIGHT.\n\n${usage()}`)
		return { width: Number(match[1]), height: Number(match[2]) }
	})
}

function parseSeverity(value: string | undefined, option: string): LayoutSeverity | undefined {
	if (value === undefined) return undefined
	if (value === 'low' || value === 'medium' || value === 'high') return value
	throw new Error(`Invalid ${option} '${value}'; expected low, medium, or high.`)
}

/** Where a finding was seen: one app, scenario, route, interaction state, and viewport. */
type LayoutOccurrence = { readonly app: UiAppId; readonly scenario: string; readonly route: string; readonly state: string; readonly viewport: string }

type LayoutReportEntry = {
	readonly id: string
	readonly finding: LayoutFinding
	readonly occurrences: LayoutOccurrence[]
	screenshot?: string
	sources: string[]
}

type ScanContext = {
	readonly session: DevToolsSession
	readonly app: UiAppId
	readonly scenario: string
	readonly outDir: string
	readonly screenshots: boolean
	readonly entries: Map<string, LayoutReportEntry>
	readonly minSeverity: LayoutSeverity
}

const HELPER_SOURCE = `(${installLayoutScanHelpers.toString()})()`
const quote = (value: string) => JSON.stringify(value)

async function settle(session: DevToolsSession) {
	const deadline = Date.now() + SETTLE_TIMEOUT_MILLISECONDS
	while (Date.now() < deadline) {
		const state = await session.evaluate(`(() => { const helpers = window.__layoutScan; return helpers === undefined ? 'missing' : helpers.quietFor() >= ${SETTLE_QUIET_MILLISECONDS.toString()} && !helpers.busy() && document.fonts.status === 'loaded' ? 'settled' : 'busy' })()`, { exceptions: 'ignore' })
		if (state === 'settled') return
		await Bun.sleep(150)
	}
}

async function runAudit(session: DevToolsSession, options: LayoutAuditOptions): Promise<LayoutFinding[]> {
	const result = await session.evaluate(layoutAuditExpression(options))
	if (!Array.isArray(result)) throw new Error('The layout audit returned no findings array')
	return result as LayoutFinding[]
}

/** Audits the current page at every scroll position, so overlaps and occlusion are confirmed against what is actually painted. */
async function auditPage(session: DevToolsSession, scope: string | undefined): Promise<LayoutFinding[]> {
	const baseOptions = scope === undefined ? {} : { scope }
	await session.evaluate('window.scrollTo(0, 0)')
	await Bun.sleep(50)
	const findings = await runAudit(session, baseOptions)
	const extent = (await session.evaluate('window.__layoutScan.scrollExtent()')) as { height: number; viewport: number }
	const step = Math.max(200, Math.floor(extent.viewport * SCROLL_STEP_RATIO))
	const maxScroll = Math.max(0, extent.height - extent.viewport)
	const positions: number[] = []
	for (let position = step; position < maxScroll; position += step) positions.push(position)
	if (maxScroll > 0) positions.push(maxScroll)
	for (const position of positions) {
		await session.evaluate(`window.scrollTo(0, ${position.toString()})`)
		await Bun.sleep(60)
		findings.push(...(await runAudit(session, { ...baseOptions, viewportChecksOnly: true })))
	}
	await session.evaluate('window.scrollTo(0, 0)')
	const unique = new Map<string, LayoutFinding>()
	for (const finding of findings) if (!unique.has(finding.signature)) unique.set(finding.signature, finding)
	return [...unique.values()]
}

async function captureFinding(context: ScanContext, entry: LayoutReportEntry) {
	const { session } = context
	const finding = entry.finding
	const clip = (await session.evaluate(`window.__layoutScan.highlight(${quote(finding.element.scanId)}, ${finding.related === undefined ? 'undefined' : quote(finding.related.scanId)}, ${quote(`${entry.id} ${finding.kind}`)})`)) as LayoutRect | undefined
	if (clip === undefined || clip.width < 1 || clip.height < 1) return
	await Bun.sleep(60)
	try {
		const result = await session.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })
		const data = typeof result === 'object' && result !== null && 'data' in result ? result.data : undefined
		if (typeof data !== 'string') return
		const file = path.join(context.outDir, 'screenshots', `${entry.id}.png`)
		await fs.writeFile(file, Buffer.from(data, 'base64'))
		entry.screenshot = file
	} finally {
		await session.evaluate('window.__layoutScan.clearHighlight()')
	}
}

async function record(context: ScanContext, findings: readonly LayoutFinding[], occurrence: LayoutOccurrence) {
	for (const finding of findings) {
		if (SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[context.minSeverity]) continue
		const key = `${occurrence.app}|${finding.signature}`
		const existing = context.entries.get(key)
		if (existing !== undefined) {
			existing.occurrences.push(occurrence)
			continue
		}
		const entry: LayoutReportEntry = { id: `${occurrence.app}-${(context.entries.size + 1).toString().padStart(3, '0')}`, finding, occurrences: [occurrence], sources: [] }
		context.entries.set(key, entry)
		if (context.screenshots) await captureFinding(context, entry)
	}
}

async function navigate(session: DevToolsSession, route: string) {
	// Leaving through an unknown route remounts the target, so tab state from an earlier visit does not carry over.
	await session.evaluate(`window.location.hash = ${quote('#/__layout-scan-reset')}`)
	await Bun.sleep(50)
	await session.evaluate(`window.location.hash = ${quote(route)}`)
	await settle(session)
}

async function pressEscape(session: DevToolsSession) {
	await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
	await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

async function replayTabs(session: DevToolsSession, route: string, tabPath: readonly string[]) {
	await navigate(session, route)
	for (const tab of tabPath) {
		const clicked = await session.evaluate(`window.__layoutScan.clickTab(${quote(tab)})`)
		if (clicked !== true) return false
		await settle(session)
	}
	return true
}

async function expand(session: DevToolsSession) {
	for (let round = 0; round < 3; round++) {
		const expanded = Number(await session.evaluate('window.__layoutScan.expandDisclosures()'))
		if (expanded === 0) break
		await settle(session)
	}
}

type RouteScan = { readonly discoveredRoutes: Set<string> }

async function scanRoute(context: ScanContext, route: string, viewport: Viewport, interactions: boolean, maxStates: number, probedLaunchers: Set<string>): Promise<RouteScan> {
	const { session } = context
	const discoveredRoutes = new Set<string>()
	const visitedTabs = new Set<string>()
	const queue: string[][] = [[]]
	let states = 0
	while (queue.length > 0 && states < maxStates) {
		const tabPath = queue.shift() ?? []
		if (!(await replayTabs(session, route, tabPath))) continue
		const currentRoute = String(await session.evaluate('window.__layoutScan.routeHash()'))
		if (currentRoute !== route.split('?')[0]) {
			discoveredRoutes.add(currentRoute)
			continue
		}
		states++
		if (interactions) await expand(session)
		const state = tabPath.length === 0 ? 'initial' : tabPath.map(tab => tab.split('::').at(-1) ?? tab).join(' › ')
		const occurrence = { app: context.app, scenario: context.scenario, route, state, viewport: formatViewport(viewport) }
		await record(context, await auditPage(session, undefined), occurrence)
		for (const found of (await session.evaluate('window.__layoutScan.routes()')) as string[]) discoveredRoutes.add(found)
		if (!interactions) continue

		const tabs = (await session.evaluate('window.__layoutScan.tabs()')) as LayoutScanTab[]
		for (const tab of tabs) {
			if (visitedTabs.has(tab.id)) continue
			visitedTabs.add(tab.id)
			queue.push([...tabPath, tab.id])
		}

		const launchers = (await session.evaluate('window.__layoutScan.launchers()')) as LayoutScanTab[]
		for (const launcher of launchers) {
			if (probedLaunchers.has(launcher.id)) continue
			probedLaunchers.add(launcher.id)
			if ((await session.evaluate(`window.__layoutScan.clickLauncher(${quote(launcher.id)})`)) !== true) continue
			await settle(session)
			const popup = await session.evaluate('window.__layoutScan.openPopup()')
			if (typeof popup === 'string') {
				await record(context, await auditPage(session, '[role=dialog], dialog[open], [aria-modal=true], [role=menu]'), { ...occurrence, state: `${state} › ${launcher.label} (${popup})` })
				for (let attempt = 0; attempt < 3; attempt++) {
					if ((await session.evaluate('window.__layoutScan.closePopup()')) === true) break
					await settle(session)
					if ((await session.evaluate('window.__layoutScan.openPopup()')) === undefined) break
					await pressEscape(session)
					await settle(session)
				}
			}
			// A launcher may also navigate or change the page, so restore the state before the next one.
			const stillOpen = (await session.evaluate('window.__layoutScan.openPopup()')) !== undefined
			const movedRoute = String(await session.evaluate('window.__layoutScan.routeHash()')) !== route.split('?')[0]
			if (stillOpen || movedRoute) {
				await replayTabs(session, route, tabPath)
				if (interactions) await expand(session)
			}
		}
	}
	return { discoveredRoutes }
}

/** Phones and tablets draw overlay scrollbars that take no layout width; desktop widths keep classic scrollbars. */
async function applyViewport(session: DevToolsSession, viewport: Viewport) {
	await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
	await session.send('Emulation.setScrollbarsHidden', { hidden: viewport.width < OVERLAY_SCROLLBAR_BELOW_WIDTH })
}

async function openSession(chromiumPath: string, baseUrl: string, scenario: string, viewport: Viewport, app: UiAppId) {
	const pageUrl = `${baseUrl.replace(/\/$/, '')}/?simulate=1&genesis=yes&simScenario=${encodeURIComponent(scenario)}`
	const session = await createDevToolsSession(chromiumPath, pageUrl, viewport)
	await session.send('Runtime.enable')
	await session.send('Page.enable')
	await applyViewport(session, viewport)
	await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
	await session.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPER_SOURCE })
	await session.send('Page.navigate', { url: pageUrl })
	const title = APP_TITLES[app]
	await session.waitFor(`document.readyState === 'complete' && document.body.innerText.includes(${quote(title)}) && !document.body.innerText.includes('BOOTSTRAPPING') && !document.body.innerText.includes('Starting simulation')`, {
		attempts: APP_READY_ATTEMPTS,
		intervalMilliseconds: 250,
		retryFailures: true,
		message: `${title} did not finish loading ${pageUrl}`,
	})
	await settle(session)
	return session
}

/**
 * Returns the scenarios to scan. An unregistered name would silently load the baseline chain while the report named
 * the requested scenario, so requested names must be registered by the app.
 */
export function selectScenarios(app: UiAppId, registered: readonly string[], requested: readonly string[] | 'all'): readonly string[] {
	if (requested === 'all') return registered
	const unknown = requested.filter(scenario => !registered.includes(scenario))
	if (unknown.length > 0) throw new Error(`The ${app} app does not register the simulation scenario${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. Registered: ${registered.join(', ')}.`)
	return requested
}

async function readRegisteredScenarios(session: DevToolsSession): Promise<readonly string[]> {
	const scenarios = await session.evaluate(`import('@zoltar/ui-core-shared/simulation/scenarios.js').then(module => module.getRegisteredSimulationScenarios())`)
	if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error('Could not read the registered simulation scenarios')
	return scenarios.map(String)
}

async function scanApp(
	chromiumPath: string,
	baseUrl: string,
	app: UiAppId,
	options: { scenarios: readonly string[] | 'all'; viewports: readonly Viewport[]; routes: readonly string[] | undefined; interactions: boolean; maxStates: number; outDir: string; screenshots: boolean; minSeverity: LayoutSeverity; entries: Map<string, LayoutReportEntry> },
) {
	const firstViewport = options.viewports[0] ?? DEFAULT_VIEWPORTS[0] ?? { width: 1440, height: 900 }
	const probe = await openSession(chromiumPath, baseUrl, 'baseline', firstViewport, app)
	let registered: readonly string[]
	try {
		registered = await readRegisteredScenarios(probe)
	} finally {
		await probe.close()
	}
	const scenarios = selectScenarios(app, registered, options.scenarios)
	for (const scenario of scenarios) {
		const session = await openSession(chromiumPath, baseUrl, scenario, firstViewport, app)
		const context: ScanContext = { session, app, scenario, outDir: options.outDir, screenshots: options.screenshots, entries: options.entries, minSeverity: options.minSeverity }
		try {
			for (const viewport of options.viewports) {
				await applyViewport(session, viewport)
				await settle(session)
				const pending = [...(options.routes ?? ((await session.evaluate('window.__layoutScan.routes()')) as string[]))]
				const visited = new Set<string>()
				const routeShapes = new Map<string, number>()
				const probedLaunchers = new Set<string>()
				while (pending.length > 0) {
					const route = pending.shift()
					if (route === undefined || visited.has(route) || route === '' || route.includes('__layout-scan')) continue
					visited.add(route)
					// Parameterized routes repeat one page for many records; scan two records per route shape.
					const shape = route.replace(/0x[0-9a-fA-F]{8,}/g, '0x…').replace(/([/=])\d+(?=[/&]|$)/g, '$1n')
					const seenShape = routeShapes.get(shape) ?? 0
					if (seenShape >= 2) continue
					routeShapes.set(shape, seenShape + 1)
					const before = options.entries.size
					const started = Date.now()
					const { discoveredRoutes } = await scanRoute(context, route, viewport, options.interactions, options.maxStates, probedLaunchers)
					console.log(`[layout-scan] ${app} ${scenario} ${formatViewport(viewport)} ${route}: ${(options.entries.size - before).toString()} new findings (${((Date.now() - started) / 1000).toFixed(1)}s)`)
					if (options.routes === undefined) for (const found of discoveredRoutes) if (!visited.has(found)) pending.push(found)
				}
			}
			const pageErrors = session.issues.filter(issue => issue.kind === 'pageerror')
			if (pageErrors.length > 0) console.warn(`[layout-scan] ${app} ${scenario} page errors:\n${pageErrors.map(issue => `  ${issue.detail.split('\n')[0] ?? ''}`).join('\n')}`)
		} finally {
			await session.close()
		}
	}
}

// ---------- Source lookup ----------

type SourceIndex = { readonly files: readonly { readonly path: string; readonly lines: readonly string[] }[] }

async function buildSourceIndex(): Promise<SourceIndex> {
	const files: { path: string; lines: string[] }[] = []
	const glob = new Bun.Glob('ui/*/{css/**/*.css,ts/**/*.tsx}')
	for await (const file of glob.scan({ cwd: repositoryRoot })) {
		if (file.includes('/tests/') || file.includes('/js/') || file.includes('node_modules')) continue
		files.push({ path: file, lines: (await fs.readFile(path.join(repositoryRoot, file), 'utf8')).split('\n') })
	}
	files.sort((left, right) => left.path.localeCompare(right.path))
	return { files }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Finds the stylesheet rules and components that use the finding's most specific classes. */
function findSources(index: SourceIndex, classes: readonly string[], limit = 4): string[] {
	const results: string[] = []
	for (const className of classes) {
		if (results.length >= limit) break
		const cssPattern = new RegExp(`\\.${escapeRegExp(className)}(?![\\w-])`)
		const tsxPattern = new RegExp(`className=[^>]*['"\` ]${escapeRegExp(className)}(?![\\w-])|className=['"\`]${escapeRegExp(className)}(?![\\w-])`)
		const matches: string[] = []
		for (const file of index.files) {
			const pattern = file.path.endsWith('.css') ? cssPattern : tsxPattern
			file.lines.forEach((line, lineIndex) => {
				if (matches.length < 3 && pattern.test(line)) matches.push(`${file.path}:${(lineIndex + 1).toString()} (.${className})`)
			})
		}
		results.push(...matches.slice(0, limit - results.length))
	}
	return results
}

// ---------- Reports ----------

function sortEntries(entries: Iterable<LayoutReportEntry>) {
	return [...entries].sort((left, right) => SEVERITY_ORDER[left.finding.severity] - SEVERITY_ORDER[right.finding.severity] || left.finding.kind.localeCompare(right.finding.kind) || left.id.localeCompare(right.id))
}

function summarizeOccurrences(occurrences: readonly LayoutOccurrence[]) {
	const viewports = [...new Set(occurrences.map(occurrence => occurrence.viewport))]
	const places = [...new Set(occurrences.map(occurrence => `${occurrence.scenario} ${occurrence.route}${occurrence.state === 'initial' ? '' : ` [${occurrence.state}]`}`))]
	return { viewports, places }
}

function renderMarkdownReport(entries: readonly LayoutReportEntry[], outDir: string) {
	const counts = new Map<LayoutSeverity, number>()
	for (const entry of entries) counts.set(entry.finding.severity, (counts.get(entry.finding.severity) ?? 0) + 1)
	const lines = ['# UI layout scan', '', `${entries.length.toString()} findings: ${(['high', 'medium', 'low'] as const).map(severity => `${(counts.get(severity) ?? 0).toString()} ${severity}`).join(', ')}.`, '']
	for (const entry of entries) {
		const { finding } = entry
		const { viewports, places } = summarizeOccurrences(entry.occurrences)
		lines.push(`## ${entry.id} · ${finding.severity} · ${KIND_TITLES[finding.kind]}`, '')
		lines.push(`**Where:** ${entry.occurrences[0]?.app ?? ''} — ${finding.context === '' ? 'page' : `"${finding.context}"`}; viewports ${viewports.join(', ')}`)
		lines.push(`**Seen at:** ${places.slice(0, 4).join('; ')}${places.length > 4 ? `; and ${(places.length - 4).toString()} more` : ''}`)
		lines.push(`**Element:** \`${finding.element.path}\`${finding.related === undefined ? '' : ` (related: \`${finding.related.path}\`)`}`, '')
		lines.push(`**Problem:** ${finding.message}`, '')
		lines.push(`**Fix:** ${finding.fix}`, '')
		if (entry.sources.length > 0) lines.push(`**Source:** ${entry.sources.map(source => `\`${source}\``).join(', ')}`, '')
		if (entry.screenshot !== undefined) lines.push(`![${entry.id}](${path.relative(outDir, entry.screenshot)})`, '')
	}
	return `${lines.join('\n')}\n`
}

function printSummary(entries: readonly LayoutReportEntry[]) {
	for (const entry of entries) {
		const { viewports } = summarizeOccurrences(entry.occurrences)
		console.log(`\n${entry.id} [${entry.finding.severity}] ${KIND_TITLES[entry.finding.kind]} — ${entry.finding.context} (${viewports.join(', ')})`)
		console.log(`  ${entry.finding.message}`)
		console.log(`  Fix: ${entry.finding.fix}`)
		if (entry.sources.length > 0) console.log(`  Source: ${entry.sources.join(', ')}`)
		if (entry.screenshot !== undefined) console.log(`  Screenshot: ${entry.screenshot}`)
	}
}

async function main() {
	const { values } = parseArgs({
		options: {
			app: { type: 'string' },
			scenario: { type: 'string' },
			viewport: { type: 'string' },
			route: { type: 'string' },
			'base-url': { type: 'string' },
			out: { type: 'string' },
			'min-severity': { type: 'string' },
			'fail-on': { type: 'string' },
			'no-interactions': { type: 'boolean' },
			'no-screenshots': { type: 'boolean' },
			'max-states': { type: 'string' },
			help: { type: 'boolean' },
		},
	})
	if (values.help === true) {
		console.log(usage())
		return
	}
	if (values.app === undefined || values.app.trim() === '') throw new Error(`Name the apps to scan with --app.\n\n${usage()}`)
	const apps = [...new Set(values.app.split(',').map(app => app.trim()))]
	for (const app of apps) if (!isUiAppId(app)) throw new Error(`Unknown app '${app}'.\n\n${usage()}`)
	const appIds = apps.filter(isUiAppId)
	if (values['base-url'] !== undefined && appIds.length !== 1) throw new Error('--base-url scans one running app; pass exactly one --app.')
	const requestedScenarios = values.scenario === undefined || values.scenario === 'all' ? 'all' : values.scenario.split(',').map(scenario => scenario.trim())
	const viewports = parseViewports(values.viewport)
	const routes = values.route?.split(',').map(route => route.trim())
	const outDir = path.resolve(values.out ?? path.join(os.tmpdir(), 'zoltar-layout-scan'))
	const minSeverity = parseSeverity(values['min-severity'], '--min-severity') ?? 'low'
	const failOn = parseSeverity(values['fail-on'], '--fail-on')
	const maxStates = Number(values['max-states'] ?? '12')
	if (!Number.isInteger(maxStates) || maxStates < 1) throw new Error('--max-states must be a positive integer')
	const chromiumPath = process.env['CHROMIUM_PATH'] ?? getChromiumPath()
	if (chromiumPath === undefined) throw new Error('Chromium is required for the layout scan. Install Chromium or set CHROMIUM_PATH.')

	await fs.rm(path.join(outDir, 'screenshots'), { recursive: true, force: true })
	await fs.mkdir(path.join(outDir, 'screenshots'), { recursive: true })
	const entries = new Map<string, LayoutReportEntry>()
	for (const app of appIds) {
		let server: ChildProcess | undefined
		let baseUrl = values['base-url']
		if (baseUrl === undefined) {
			const started = await startDevServer(app, { prepareSnapshots: true })
			server = started.server
			baseUrl = started.baseUrl
		}
		try {
			await scanApp(chromiumPath, baseUrl, app, {
				scenarios: requestedScenarios,
				viewports,
				routes,
				interactions: values['no-interactions'] !== true,
				maxStates,
				outDir,
				screenshots: values['no-screenshots'] !== true,
				minSeverity,
				entries,
			})
		} finally {
			if (server !== undefined) stopDevServer(server)
		}
	}

	const sourceIndex = await buildSourceIndex()
	for (const entry of entries.values()) entry.sources = findSources(sourceIndex, [...entry.finding.element.classes, ...(entry.finding.related?.classes ?? [])])
	const sorted = sortEntries(entries.values())
	await fs.writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(sorted, undefined, '\t')}\n`)
	await fs.writeFile(path.join(outDir, 'report.md'), renderMarkdownReport(sorted, outDir))
	printSummary(sorted)
	const failing = failOn === undefined ? [] : sorted.filter(entry => SEVERITY_ORDER[entry.finding.severity] <= SEVERITY_ORDER[failOn])
	console.log(`\n[layout-scan] ${sorted.length.toString()} findings. Report: ${path.join(outDir, 'report.md')}`)
	if (failing.length > 0) {
		console.error(`[layout-scan] ${failing.length.toString()} findings at or above ${failOn ?? ''} severity.`)
		process.exitCode = 1
	}
}

if (import.meta.main) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	})
}
