import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { unavailableOperationCatalog } from '../src/runtime/canonical-scan.ts'

type CdpMessage = {
	error: { message?: string } | undefined
	id: number | undefined
	method: string | undefined
	params: unknown
	result: unknown
}

type CaptureRequest = {
	catalogDetail?: true | undefined
	catalogExpectedExplanation?: string | undefined
	catalogOperationId?: string | undefined
	fullDocument?: true | undefined
	height: number
	name: string
	recoveryRefreshFailure?: 'candidate' | undefined
	resumeDialog?: true | undefined
	route: string
	stateRefreshFailure?: true | undefined
	submissionReadiness?: 'blocked' | 'ready' | undefined
	verticalScroll?: 'rpc-health' | 'submission-health' | 'topology' | undefined
	width: number
}

type PaintTarget = {
	accent?: 'absent' | 'present' | undefined
	label: string
	minimumDistinctColors: number
	selector: string
}

const outputDirectory = resolve(import.meta.dir, '..', '.state', 'qa')
const unavailableCatalog = unavailableOperationCatalog('visual fixture')
const expectedCatalogEntryCount = new Set(unavailableCatalog.map(evaluation => evaluation.definition.id)).size
const expectedCopyableOperationCount = new Set(unavailableCatalog.filter(evaluation => evaluation.definition.classification === 'selectable' && evaluation.definition.independentlyExecutable !== false).map(evaluation => evaluation.definition.id)).size
const expectedIndependentOperationCounts = ['zoltar', 'statoblast', 'open-oracle', 'trading'].map(ecosystem => ({
	count: new Set(
		unavailableCatalog.filter(evaluation => evaluation.definition.ecosystem === ecosystem && (evaluation.definition.independentlyExecutable ?? (evaluation.definition.classification === 'selectable' || evaluation.definition.classification === 'lifecycle-obligation'))).map(evaluation => evaluation.definition.id),
	).size,
	ecosystem,
}))
await mkdir(outputDirectory, { recursive: true })
const requestedCaptureSource = process.argv[2]
if (requestedCaptureSource === undefined) {
	const captures: CaptureRequest[] = [
		{ height: 900, name: 'chaos-overview-desktop', route: 'overview', width: 1_440 },
		{ height: 900, name: 'chaos-resume-desktop', resumeDialog: true, route: 'overview', width: 1_440 },
		{ height: 900, name: 'chaos-catalog-desktop', route: 'catalog', width: 1_440 },
		{ height: 900, name: 'chaos-ecosystem-desktop', route: 'ecosystem', width: 1_440 },
		{ height: 900, name: 'chaos-ecosystem-desktop-topology', route: 'ecosystem', verticalScroll: 'topology', width: 1_440 },
		{ height: 900, name: 'chaos-activity-desktop', route: 'activity', width: 1_440 },
		{ height: 900, name: 'chaos-settings-desktop', route: 'settings', width: 1_440 },
		{ height: 844, name: 'chaos-overview-mobile', route: 'overview', width: 390 },
		{ height: 844, name: 'chaos-resume-mobile', resumeDialog: true, route: 'overview', width: 390 },
		{ height: 844, name: 'chaos-overview-mobile-rpc-health', route: 'overview', stateRefreshFailure: true, verticalScroll: 'rpc-health', width: 390 },
		{ height: 844, name: 'chaos-catalog-mobile', route: 'catalog', width: 390 },
		{ catalogDetail: true, height: 844, name: 'chaos-catalog-mobile-details', route: 'catalog', width: 390 },
		{
			catalogDetail: true,
			catalogExpectedExplanation: 'This method is submitted only as a prerequisite inside an eligible durable workflow',
			catalogOperationId: 'surface.genesis-reputation-token.approve',
			height: 844,
			name: 'chaos-genesis-approve-mobile',
			route: 'catalog',
			width: 390,
		},
		{
			catalogDetail: true,
			catalogExpectedExplanation: 'Exact payable alias of WETH9.deposit and the same bounded wrap operation.',
			catalogOperationId: 'surface.weth9.receive',
			height: 844,
			name: 'chaos-weth-receive-mobile',
			route: 'catalog',
			width: 390,
		},
		{ height: 844, name: 'chaos-ecosystem-mobile-topology', route: 'ecosystem', verticalScroll: 'topology', width: 390 },
		{ height: 844, name: 'chaos-activity-mobile', route: 'activity', width: 390 },
		{ height: 844, name: 'chaos-activity-mobile-retry', recoveryRefreshFailure: 'candidate', route: 'activity', width: 390 },
		{ fullDocument: true, height: 844, name: 'chaos-settings-mobile', route: 'settings', width: 390 },
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
	const catalogDetail = Reflect.get(parsed, 'catalogDetail')
	const catalogExpectedExplanation = Reflect.get(parsed, 'catalogExpectedExplanation')
	const catalogOperationId = Reflect.get(parsed, 'catalogOperationId')
	const fullDocument = Reflect.get(parsed, 'fullDocument')
	const height = Reflect.get(parsed, 'height')
	const name = Reflect.get(parsed, 'name')
	const recoveryRefreshFailure = Reflect.get(parsed, 'recoveryRefreshFailure')
	const resumeDialog = Reflect.get(parsed, 'resumeDialog')
	const route = Reflect.get(parsed, 'route')
	const stateRefreshFailure = Reflect.get(parsed, 'stateRefreshFailure')
	const submissionReadiness = Reflect.get(parsed, 'submissionReadiness')
	const verticalScroll = Reflect.get(parsed, 'verticalScroll')
	const width = Reflect.get(parsed, 'width')
	if (
		(catalogDetail !== undefined && catalogDetail !== true) ||
		(catalogDetail === true && route !== 'catalog') ||
		(catalogExpectedExplanation !== undefined && (typeof catalogExpectedExplanation !== 'string' || catalogExpectedExplanation.trim() === '' || catalogExpectedExplanation.trim() !== catalogExpectedExplanation || catalogOperationId === undefined)) ||
		(catalogOperationId !== undefined && (typeof catalogOperationId !== 'string' || catalogOperationId.trim() === '' || catalogOperationId.trim() !== catalogOperationId || catalogDetail !== true || route !== 'catalog')) ||
		(fullDocument !== undefined && fullDocument !== true) ||
		typeof height !== 'number' ||
		typeof name !== 'string' ||
		(recoveryRefreshFailure !== undefined && recoveryRefreshFailure !== 'candidate') ||
		(resumeDialog !== undefined && resumeDialog !== true) ||
		typeof route !== 'string' ||
		(stateRefreshFailure !== undefined && stateRefreshFailure !== true) ||
		(submissionReadiness !== undefined && submissionReadiness !== 'blocked' && submissionReadiness !== 'ready') ||
		(submissionReadiness !== undefined && route !== 'overview') ||
		(verticalScroll !== undefined && verticalScroll !== 'rpc-health' && verticalScroll !== 'submission-health' && verticalScroll !== 'topology') ||
		typeof width !== 'number'
	)
		throw new Error('Capture request fields are invalid')
	return { catalogDetail, catalogExpectedExplanation, catalogOperationId, fullDocument, height, name, recoveryRefreshFailure, resumeDialog, route, stateRefreshFailure, submissionReadiness, verticalScroll, width }
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
		const exceptionDetails = Reflect.get(response, 'exceptionDetails')
		if (typeof exceptionDetails === 'object' && exceptionDetails !== null) {
			const exception = Reflect.get(exceptionDetails, 'exception')
			const description = typeof exception === 'object' && exception !== null ? Reflect.get(exception, 'description') : undefined
			const textValue = Reflect.get(exceptionDetails, 'text')
			let message = 'Runtime evaluation failed'
			if (typeof description === 'string') message = description
			else if (typeof textValue === 'string') message = textValue
			throw new Error(message)
		}
		const result = Reflect.get(response, 'result')
		if (typeof result !== 'object' || result === null || Array.isArray(result)) throw new Error('Runtime evaluation omitted its result')
		return Reflect.get(result, 'value')
	}

	const capture = async ({ catalogDetail, catalogExpectedExplanation, catalogOperationId, fullDocument, height, name, recoveryRefreshFailure, resumeDialog, route, stateRefreshFailure, submissionReadiness, verticalScroll, width }: CaptureRequest) => {
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
		const renderedState = await evaluate(`(() => {
			const visiblePage = document.querySelector(${JSON.stringify(`[data-page-content="${route}"]`)})
			const labels = [...document.querySelectorAll('#catalog-rows .operation-name strong')].map(element => element.textContent)
			const coverageAlias = [...document.querySelectorAll('#catalog-rows tr')].find(row => row.querySelector('.operation-name small.mono')?.textContent?.trim() === 'surface.weth9.receive')
			const normalize = value => value?.trim().replaceAll(/\\s+/g, ' ').replace(/[.?!]+$/, '').toLowerCase()
			const redundantCatalogCopy = [...document.querySelectorAll('#catalog-rows tr')].flatMap(row => {
				const description = normalize(row.querySelector('.operation-description')?.textContent)
				if (description === undefined || description === '') return []
				return [...row.querySelectorAll('.blocker-list li')].some(blocker => normalize(blocker.textContent) === description) ? [row.querySelector('.operation-name strong')?.textContent] : []
			})
			const ecosystemToggles = [...document.querySelectorAll('[data-ecosystem-toggle]')]
			const workflowValidityUnit = document.querySelector('#workflow-valid-blocks + span')
			const workflowValidityUnitBounds = workflowValidityUnit?.getBoundingClientRect()
			return {
				bodyPage: document.body.dataset.page,
				catalogCaption: document.querySelector('#catalog-caption')?.textContent,
				catalogCoverageAlias: coverageAlias === undefined ? undefined : {
					classification: coverageAlias.querySelector('td:nth-child(3) .badge')?.textContent,
					copyable: coverageAlias.querySelector('.operation-id-copy') instanceof HTMLButtonElement,
					eligibility: coverageAlias.querySelector('td:nth-child(6) .badge')?.textContent,
				},
				catalogLabels: labels,
				catalogRedundantCopy: redundantCatalogCopy,
				ecosystemMetrics: [...document.querySelectorAll('#ecosystem-grid .ecosystem-card')].map(card => {
					const metrics = [...card.querySelectorAll('.ecosystem-metrics > div')]
					return {
						ecosystem: card.dataset['ecosystem'],
						independent: metrics[0]?.querySelector('strong')?.textContent,
						labels: metrics.map(metric => metric.querySelector('span')?.textContent),
					}
				}),
				execute: document.querySelector('#execute') instanceof HTMLInputElement ? document.querySelector('#execute').checked : undefined,
				highRisk: document.querySelector('#allow-high-risk') instanceof HTMLInputElement ? document.querySelector('#allow-high-risk').checked : undefined,
				irreversible: document.querySelector('#allow-irreversible') instanceof HTMLInputElement ? document.querySelector('#allow-irreversible').checked : undefined,
				mode: document.querySelector('#mode-badge')?.textContent,
				network: document.querySelector('#network-badge')?.textContent,
				pause: document.querySelector('#pause-button')?.textContent,
				refresh: document.querySelector('#refresh-button')?.textContent,
				settingsDisabled: document.querySelector('#settings-fields') instanceof HTMLFieldSetElement ? document.querySelector('#settings-fields').disabled : undefined,
				settingsScope: document.querySelector('#settings-scope')?.textContent,
				toggleCount: ecosystemToggles.length,
				togglesChecked: ecosystemToggles.every(toggle => toggle instanceof HTMLInputElement && toggle.checked),
				visiblePage: visiblePage instanceof HTMLElement && getComputedStyle(visiblePage).display !== 'none',
				workflowValidityUnit: workflowValidityUnit?.textContent?.trim(),
				workflowValidityUnitVisible: (workflowValidityUnitBounds?.width ?? 0) > 0 && (workflowValidityUnitBounds?.height ?? 0) > 0,
			}
		})()`)
		if (typeof renderedState !== 'object' || renderedState === null || Array.isArray(renderedState)) throw new Error(`Dashboard route /${route} did not expose its rendered state`)
		if (Reflect.get(renderedState, 'bodyPage') !== route || Reflect.get(renderedState, 'visiblePage') !== true) throw new Error(`Dashboard route /${route} rendered the wrong page: ${JSON.stringify(renderedState)}`)
		if (route === 'catalog') {
			const labels = Reflect.get(renderedState, 'catalogLabels')
			const caption = Reflect.get(renderedState, 'catalogCaption')
			const coverageAlias = Reflect.get(renderedState, 'catalogCoverageAlias')
			const redundantCopy = Reflect.get(renderedState, 'catalogRedundantCopy')
			const requiredLabels = ['Create binary question', 'Deposit REP to vault', 'GenesisReputationToken.approve', 'Submit OpenOracle report', 'Router enter', 'settle report', 'WETH9.receive']
			if (
				!Array.isArray(labels) ||
				labels.length !== expectedCatalogEntryCount ||
				requiredLabels.some(label => !labels.includes(label)) ||
				caption !== `${expectedCatalogEntryCount.toString()} of ${expectedCatalogEntryCount.toString()} classified catalog entries shown · 7 live candidates.` ||
				typeof coverageAlias !== 'object' ||
				coverageAlias === null ||
				Reflect.get(coverageAlias, 'classification') !== 'Coverage alias' ||
				Reflect.get(coverageAlias, 'copyable') !== false ||
				Reflect.get(coverageAlias, 'eligibility') !== 'Not independently selectable' ||
				!Array.isArray(redundantCopy) ||
				redundantCopy.length !== 0
			) {
				throw new Error(`Catalog fixture was incomplete before capture: ${JSON.stringify(renderedState)}`)
			}
		}
		if (route === 'ecosystem') {
			const metrics = Reflect.get(renderedState, 'ecosystemMetrics')
			if (
				!Array.isArray(metrics) ||
				metrics.length !== expectedIndependentOperationCounts.length ||
				expectedIndependentOperationCounts.some((expected, index) => {
					const metric = metrics[index]
					return typeof metric !== 'object' || metric === null || Reflect.get(metric, 'ecosystem') !== expected.ecosystem || Reflect.get(metric, 'independent') !== expected.count.toString() || JSON.stringify(Reflect.get(metric, 'labels')) !== JSON.stringify(['Independent operations', 'Eligible', 'Candidates'])
				})
			) {
				throw new Error(`Ecosystem metrics did not distinguish independent operations from classified coverage: ${JSON.stringify(metrics)}`)
			}
		}
		if (route === 'settings') {
			const settingsMatchFixture =
				Reflect.get(renderedState, 'execute') === false &&
				Reflect.get(renderedState, 'highRisk') === false &&
				Reflect.get(renderedState, 'irreversible') === false &&
				Reflect.get(renderedState, 'mode') === 'Dry run' &&
				Reflect.get(renderedState, 'network') === 'sepolia · 11155111' &&
				Reflect.get(renderedState, 'pause') === 'Pause' &&
				Reflect.get(renderedState, 'refresh') === 'Refresh' &&
				Reflect.get(renderedState, 'settingsDisabled') === true &&
				Reflect.get(renderedState, 'settingsScope') === 'sepolia · chain 11155111' &&
				Reflect.get(renderedState, 'toggleCount') === 4 &&
				Reflect.get(renderedState, 'togglesChecked') === true &&
				Reflect.get(renderedState, 'workflowValidityUnit') === 'blocks' &&
				Reflect.get(renderedState, 'workflowValidityUnitVisible') === true
			if (!settingsMatchFixture) throw new Error(`Settings controls did not match the visual fixture before capture: ${JSON.stringify(renderedState)}`)
		}
		if (submissionReadiness !== undefined) {
			const expectedStatus = submissionReadiness === 'ready' ? 'Path ready' : 'Path blocked'
			const expectedHealthy = submissionReadiness === 'ready' ? '2 of 3 origins' : '1 of 3 origins'
			const submissionState = await evaluate(`({
				executionMode: document.querySelector('#mode-badge')?.textContent,
				freshness: document.querySelector('#submission-freshness')?.textContent,
				healthy: document.querySelector('#submission-healthy-count')?.textContent,
				mode: document.querySelector('#submission-mode')?.textContent,
				proof: document.querySelector('#submission-signer-proof')?.textContent,
				required: document.querySelector('#submission-required-threshold')?.textContent,
				status: document.querySelector('#submission-health-status')?.textContent,
			})`)
			if (
				typeof submissionState !== 'object' ||
				submissionState === null ||
				Array.isArray(submissionState) ||
				Reflect.get(submissionState, 'executionMode') !== 'Live execution' ||
				Reflect.get(submissionState, 'freshness') !== '3 fresh of 3 checked' ||
				Reflect.get(submissionState, 'healthy') !== expectedHealthy ||
				Reflect.get(submissionState, 'mode') !== 'Private relay' ||
				Reflect.get(submissionState, 'proof') !== 'Matches current signer' ||
				Reflect.get(submissionState, 'required') !== '2 origins' ||
				Reflect.get(submissionState, 'status') !== expectedStatus
			) {
				throw new Error(`Private submission fixture did not render ${submissionReadiness} readiness: ${JSON.stringify(submissionState)}`)
			}
		}
		if (stateRefreshFailure === true) {
			await command('Network.setBlockedURLs', { urls: ['*://127.0.0.1:4193/api/state*'] })
			await evaluate("document.querySelector('#refresh-button')?.click()")
			let failureReady = false
			for (let poll = 0; poll < 60; poll += 1) {
				failureReady = (await evaluate("document.querySelector('#rpc-health-status')?.textContent === 'Health unavailable' && document.querySelector('#rpc-health-retry-button')?.textContent === 'Retry' && document.querySelector('#rpc-health-retry-button')?.disabled === false")) === true
				if (failureReady) break
				await Bun.sleep(100)
			}
			if (!failureReady) throw new Error(`Dashboard route /${route} did not expose local Retry after the forced state-refresh failure`)
		}
		if (recoveryRefreshFailure === 'candidate') {
			await evaluate("document.querySelector('#pause-button')?.click()")
			let pauseReady = false
			for (let poll = 0; poll < 60; poll += 1) {
				pauseReady = (await evaluate("document.querySelector('#mode-badge')?.textContent === 'Paused' && document.querySelector('#refresh-button')?.textContent === 'Refresh' && document.querySelector('#pause-status')?.textContent === ''")) === true
				if (pauseReady) break
				await Bun.sleep(100)
			}
			if (!pauseReady) throw new Error('Dashboard fixture did not pause before recovery-failure capture')
			await command('Network.setBlockedURLs', { urls: ['*://127.0.0.1:4193/api/state*'] })
			await evaluate(`(() => {
				const form = document.querySelector('#candidate-form')
				if (!(form instanceof HTMLFormElement)) return false
				form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				return true
			})()`)
			let failureReady = false
			for (let poll = 0; poll < 60; poll += 1) {
				failureReady = (await evaluate("document.querySelector('#candidate-status')?.textContent?.includes('unavailable') === true && document.querySelector('#candidate-retry')?.textContent === 'Retry' && document.querySelector('#candidate-retry')?.disabled === false")) === true
				if (failureReady) break
				await Bun.sleep(100)
			}
			if (!failureReady) throw new Error('Dashboard fixture did not expose candidate recovery Retry after the forced state-refresh failure')
		}
		if (resumeDialog === true) {
			await evaluate("document.querySelector('#pause-button')?.click()")
			let paused = false
			for (let poll = 0; poll < 60; poll += 1) {
				paused = (await evaluate("document.querySelector('#mode-badge')?.textContent === 'Paused' && document.querySelector('#pause-button')?.textContent === 'Resume' && document.querySelector('#pause-status')?.textContent === ''")) === true
				if (paused) break
				await Bun.sleep(100)
			}
			if (!paused) throw new Error('Dashboard fixture did not pause before the resume-dialog capture')
			await evaluate("document.querySelector('#pause-button')?.click()")
			let dialogOpen = false
			for (let poll = 0; poll < 60; poll += 1) {
				dialogOpen = (await evaluate("document.querySelector('#resume-dialog')?.open === true")) === true
				if (dialogOpen) break
				await Bun.sleep(100)
			}
			if (!dialogOpen) throw new Error('Dashboard fixture did not open the resume confirmation')
			const modalLayout = await evaluate(`(() => {
				const dialog = document.querySelector('#resume-dialog')
				const title = document.querySelector('#resume-dialog-title')
				if (!(dialog instanceof HTMLDialogElement) || !(title instanceof HTMLHeadingElement)) return undefined
				const bounds = dialog.getBoundingClientRect()
				const actions = [...dialog.querySelectorAll('.dialog-actions button')]
				const visualOrder = [...actions].sort((left, right) => {
					const leftBounds = left.getBoundingClientRect()
					const rightBounds = right.getBoundingClientRect()
					return Math.abs(leftBounds.top - rightBounds.top) > 1 ? leftBounds.top - rightBounds.top : leftBounds.left - rightBounds.left
				})
				return {
					active: document.activeElement?.id,
					bottom: bounds.bottom,
					buttonHeights: [...dialog.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
					domOrder: actions.map(action => action.id),
					labelledBy: dialog.getAttribute('aria-labelledby'),
					left: bounds.left,
					right: bounds.right,
					scrollContained: dialog.scrollWidth <= dialog.clientWidth,
					title: title.textContent?.trim(),
					top: bounds.top,
					visualOrder: visualOrder.map(action => action.id),
				}
			})()`)
			const buttonHeights = typeof modalLayout === 'object' && modalLayout !== null ? Reflect.get(modalLayout, 'buttonHeights') : undefined
			const modalBottom = typeof modalLayout === 'object' && modalLayout !== null ? Reflect.get(modalLayout, 'bottom') : undefined
			const modalLeft = typeof modalLayout === 'object' && modalLayout !== null ? Reflect.get(modalLayout, 'left') : undefined
			const modalRight = typeof modalLayout === 'object' && modalLayout !== null ? Reflect.get(modalLayout, 'right') : undefined
			const modalTop = typeof modalLayout === 'object' && modalLayout !== null ? Reflect.get(modalLayout, 'top') : undefined
			if (
				typeof modalLayout !== 'object' ||
				modalLayout === null ||
				Array.isArray(modalLayout) ||
				Reflect.get(modalLayout, 'active') !== 'cancel-resume' ||
				typeof modalBottom !== 'number' ||
				modalBottom > height + 1 ||
				Reflect.get(modalLayout, 'labelledBy') !== 'resume-dialog-title' ||
				typeof modalLeft !== 'number' ||
				modalLeft < -1 ||
				typeof modalRight !== 'number' ||
				modalRight > width + 1 ||
				Reflect.get(modalLayout, 'scrollContained') !== true ||
				Reflect.get(modalLayout, 'title') !== 'Resume chaos scheduling?' ||
				typeof modalTop !== 'number' ||
				modalTop < -1 ||
				JSON.stringify(Reflect.get(modalLayout, 'domOrder')) !== JSON.stringify(['cancel-resume', 'confirm-resume']) ||
				JSON.stringify(Reflect.get(modalLayout, 'visualOrder')) !== JSON.stringify(['cancel-resume', 'confirm-resume']) ||
				!Array.isArray(buttonHeights) ||
				buttonHeights.some(buttonHeight => typeof buttonHeight !== 'number' || buttonHeight < (width === 390 ? 44 : 32))
			) {
				throw new Error(`Resume confirmation did not fit its labelled modal viewport: ${JSON.stringify(modalLayout)}`)
			}
			await command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', nativeVirtualKeyCode: 9, type: 'rawKeyDown', windowsVirtualKeyCode: 9 })
			await command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', nativeVirtualKeyCode: 9, type: 'keyUp', windowsVirtualKeyCode: 9 })
			if ((await evaluate("document.activeElement?.id === 'confirm-resume'")) !== true) throw new Error('Resume confirmation Tab order did not follow its visual action order')
			await evaluate("document.querySelector('#cancel-resume')?.focus()")
		}
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
		if (route === 'catalog' && width <= 672) {
			const copyTargetHeights = await evaluate(`[...document.querySelectorAll('#catalog-rows .operation-id-copy')].map(button => button.getBoundingClientRect().height)`)
			if (!Array.isArray(copyTargetHeights) || copyTargetHeights.length !== expectedCopyableOperationCount || copyTargetHeights.some(height => typeof height !== 'number' || height < 44)) {
				throw new Error(`Mobile catalog Copy ID controls did not retain 44px touch targets: ${JSON.stringify(copyTargetHeights)}`)
			}
		}
		if (route === 'catalog' && width >= 1_440) {
			const catalogLayout = await evaluate(`(() => {
				const shell = document.querySelector('.table-shell')
				const headers = [...document.querySelectorAll('.table-shell thead th')]
				if (!(shell instanceof HTMLElement)) return undefined
				const shellBounds = shell.getBoundingClientRect()
				const eligibilityBounds = headers.at(-1)?.getBoundingClientRect()
				return {
					clientWidth: shell.clientWidth,
					headerLabels: headers.map(header => header.textContent?.trim()),
					eligibilityRight: eligibilityBounds?.right,
					scrollWidth: shell.scrollWidth,
					shellRight: shellBounds.right,
				}
			})()`)
			if (
				typeof catalogLayout !== 'object' ||
				catalogLayout === null ||
				Array.isArray(catalogLayout) ||
				Reflect.get(catalogLayout, 'clientWidth') !== Reflect.get(catalogLayout, 'scrollWidth') ||
				JSON.stringify(Reflect.get(catalogLayout, 'headerLabels')) !== JSON.stringify(['Operation', 'Ecosystem', 'Classification', 'Risk', 'Candidates', 'Eligibility']) ||
				typeof Reflect.get(catalogLayout, 'eligibilityRight') !== 'number' ||
				typeof Reflect.get(catalogLayout, 'shellRight') !== 'number' ||
				Number(Reflect.get(catalogLayout, 'eligibilityRight')) > Number(Reflect.get(catalogLayout, 'shellRight')) + 1
			) {
				throw new Error(`Desktop catalog did not expose all six columns without hidden horizontal content: ${JSON.stringify(catalogLayout)}`)
			}
		}
		if (route === 'activity' && width === 390) {
			const danglingRecoveryPrefixes = await evaluate(`[
				...document.querySelectorAll('#pending-transactions .identifier-line > span:first-child'),
			].map(prefix => prefix.textContent?.trim()).filter(prefix => prefix?.endsWith('·'))`)
			if (!Array.isArray(danglingRecoveryPrefixes) || danglingRecoveryPrefixes.length !== 0) {
				throw new Error(`Mobile recovery metadata retained a dangling separator: ${JSON.stringify(danglingRecoveryPrefixes)}`)
			}
		}
		const disabledButtonContrast = await evaluate(`(() => {
			const rgb = value => {
				const match = value.match(/^rgba?\\(\\s*(\\d+(?:\\.\\d+)?)\\s*,?\\s*(\\d+(?:\\.\\d+)?)\\s*,?\\s*(\\d+(?:\\.\\d+)?)/)
				return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
			}
			const luminance = value => {
				const channels = rgb(value)
				if (channels === undefined) return undefined
				const linear = channels.map(channel => {
					const normalized = channel / 255
					return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
				})
				return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
			}
			return [...document.querySelectorAll('button:disabled')].flatMap(button => {
				if (!(button instanceof HTMLButtonElement)) return []
				const bounds = button.getBoundingClientRect()
				if (bounds.width === 0 || bounds.height === 0) return []
				const style = getComputedStyle(button)
				const foreground = luminance(style.color)
				const background = luminance(style.backgroundColor)
				if (foreground === undefined || background === undefined) return [{ contrast: undefined, id: button.id, label: button.textContent?.trim() }]
				return [{
					contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
					id: button.id,
					label: button.textContent?.trim(),
				}]
			})
		})()`)
		if (!Array.isArray(disabledButtonContrast) || disabledButtonContrast.some(result => typeof result !== 'object' || result === null || typeof Reflect.get(result, 'contrast') !== 'number' || Number(Reflect.get(result, 'contrast')) < 4.5)) {
			throw new Error(`Dashboard route /${route} exposed an illegible disabled button: ${JSON.stringify(disabledButtonContrast)}`)
		}
		if (catalogDetail === true) {
			const expectedCatalogRowDisplay = width <= 768 ? 'grid' : 'table-row'
			const detail = await evaluate(`new Promise(resolve => {
				const shell = document.querySelector('.table-shell')
				const requestedExplanation = ${JSON.stringify(catalogExpectedExplanation)}
				const requestedOperationId = ${JSON.stringify(catalogOperationId)}
				const row = requestedOperationId === undefined
					? document.querySelector('#catalog-rows tr:first-child')
					: [...document.querySelectorAll('#catalog-rows tr')].find(candidate => candidate.querySelector('.operation-name small.mono')?.textContent?.trim() === requestedOperationId)
				if (!(shell instanceof HTMLElement) || !(row instanceof HTMLTableRowElement)) {
					resolve(undefined)
					return
				}
				row.setAttribute('data-qa-catalog-detail', 'true')
				row.scrollIntoView({ block: 'center' })
				requestAnimationFrame(() => requestAnimationFrame(() => {
					const rowBounds = row.getBoundingClientRect()
					resolve({
						attributes: [...row.querySelectorAll(':scope > td')].map(cell => ({
							label: cell.dataset['label'],
							text: cell.textContent?.trim(),
						})),
						cellsContained: [...row.querySelectorAll(':scope > td')].every(cell => cell.scrollWidth <= cell.clientWidth),
						explanationOccurrences: requestedExplanation === undefined ? undefined : [...row.querySelectorAll('.operation-description, .blocker-list li')].filter(element => element.textContent?.trim() === requestedExplanation).length,
						identity: row.querySelector('.operation-name strong')?.textContent?.trim(),
						operationId: row.querySelector('.operation-name small.mono')?.textContent?.trim(),
						maximumHorizontalScroll: shell.scrollWidth - shell.clientWidth,
						rowDisplay: getComputedStyle(row).display,
						rowOverflow: row.scrollWidth > row.clientWidth,
						rowViewportContained: rowBounds.top >= -1 && rowBounds.bottom <= innerHeight + 1,
					})
				}))
			})`)
			const attributes = typeof detail === 'object' && detail !== null && !Array.isArray(detail) ? Reflect.get(detail, 'attributes') : undefined
			const expectedLabels = ['Operation', 'Ecosystem', 'Classification', 'Risk', 'Candidates', 'Eligibility']
			if (
				typeof detail !== 'object' ||
				detail === null ||
				Array.isArray(detail) ||
				!Array.isArray(attributes) ||
				JSON.stringify(attributes.map(attribute => (typeof attribute === 'object' && attribute !== null ? Reflect.get(attribute, 'label') : undefined))) !== JSON.stringify(expectedLabels) ||
				attributes.some(attribute => typeof attribute !== 'object' || attribute === null || typeof Reflect.get(attribute, 'text') !== 'string' || String(Reflect.get(attribute, 'text')).length === 0) ||
				Reflect.get(detail, 'cellsContained') !== true ||
				(catalogExpectedExplanation !== undefined && Reflect.get(detail, 'explanationOccurrences') !== 1) ||
				typeof Reflect.get(detail, 'identity') !== 'string' ||
				String(Reflect.get(detail, 'identity')).length === 0 ||
				(catalogOperationId !== undefined && Reflect.get(detail, 'operationId') !== catalogOperationId) ||
				Reflect.get(detail, 'maximumHorizontalScroll') !== 0 ||
				Reflect.get(detail, 'rowDisplay') !== expectedCatalogRowDisplay ||
				Reflect.get(detail, 'rowOverflow') !== false ||
				Reflect.get(detail, 'rowViewportContained') !== true
			) {
				throw new Error(`Catalog detail did not retain a complete non-overflowing operation row: ${JSON.stringify(detail)}`)
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
		if (verticalScroll === 'submission-health') {
			const submissionPanel = await evaluate(`new Promise(resolve => {
				const panel = document.querySelector('.submission-health-panel')
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
			if (typeof submissionPanel !== 'object' || submissionPanel === null) throw new Error('Submission health panel was not available for vertical-scroll capture')
			const bottom = Reflect.get(submissionPanel, 'bottom')
			const top = Reflect.get(submissionPanel, 'top')
			if (typeof bottom !== 'number' || typeof top !== 'number' || top < -1 || bottom > height + 1) throw new Error(`Submission health panel did not fit the requested viewport: ${JSON.stringify(submissionPanel)}`)
		}
		if (verticalScroll === 'topology') {
			const topology = await evaluate(`new Promise(resolve => {
				const panel = document.querySelector('.topology-panel')
				if (!(panel instanceof HTMLElement)) {
					resolve(undefined)
					return
				}
				panel.scrollIntoView({ block: 'start' })
				requestAnimationFrame(() => requestAnimationFrame(() => {
					const bounds = panel.getBoundingClientRect()
					const topbarColor = getComputedStyle(document.querySelector('.topbar')).backgroundColor
					const topbarAlpha = topbarColor.startsWith('rgba(') ? Number(topbarColor.match(/,\\s*([0-9.]+)\\)$/)?.[1]) : 1
					const identifiers = [...panel.querySelectorAll('.compact-identifier')].map(identifier => {
						const full = identifier.querySelector('.identifier-full')
						return {
							copy: identifier.querySelector('.identifier-copy') instanceof HTMLButtonElement,
							disclosure: identifier.querySelector('.identifier-disclosure') instanceof HTMLButtonElement,
							value: full instanceof HTMLTextAreaElement ? full.value : undefined,
						}
					})
					resolve({
						identifiers,
						summaryHeights: [...panel.querySelectorAll('.topology-grid summary')].map(summary => summary.getBoundingClientRect().height),
						top: bounds.top,
						topbarColor,
						topbarOpaque: topbarAlpha === 1,
					})
				}))
			})`)
			if (typeof topology !== 'object' || topology === null || Array.isArray(topology)) throw new Error('Anchored topology was not available for capture')
			const identifiers = Reflect.get(topology, 'identifiers')
			const summaryHeights = Reflect.get(topology, 'summaryHeights')
			const top = Reflect.get(topology, 'top')
			const values = Array.isArray(identifiers) ? identifiers.map(identifier => (typeof identifier === 'object' && identifier !== null ? Reflect.get(identifier, 'value') : undefined)) : []
			if (
				typeof top !== 'number' ||
				top < -1 ||
				top > height / 3 ||
				!Array.isArray(identifiers) ||
				identifiers.length !== 9 ||
				identifiers.some(identifier => typeof identifier !== 'object' || identifier === null || Reflect.get(identifier, 'copy') !== true || Reflect.get(identifier, 'disclosure') !== true) ||
				!Array.isArray(summaryHeights) ||
				summaryHeights.length !== 5 ||
				summaryHeights.some(summaryHeight => typeof summaryHeight !== 'number' || summaryHeight < 44) ||
				Reflect.get(topology, 'topbarOpaque') !== true ||
				values.some(value => typeof value !== 'string' || value.length < 42) ||
				new Set(values).size < 6
			) {
				throw new Error(`Anchored topology did not expose complete identifier controls for capture: ${JSON.stringify(topology)}`)
			}
		}
		if (recoveryRefreshFailure === 'candidate') {
			const retry = await evaluate(`new Promise(resolve => {
				const button = document.querySelector('#candidate-retry')
				button?.scrollIntoView({ block: 'center' })
				requestAnimationFrame(() => requestAnimationFrame(() => {
					const bounds = button?.getBoundingClientRect()
					resolve({ bottom: bounds?.bottom, height: bounds?.height, top: bounds?.top })
				}))
			})`)
			if (typeof retry !== 'object' || retry === null) throw new Error('Candidate recovery Retry was not available for capture')
			const bottom = Reflect.get(retry, 'bottom')
			const buttonHeight = Reflect.get(retry, 'height')
			const top = Reflect.get(retry, 'top')
			if (typeof bottom !== 'number' || typeof buttonHeight !== 'number' || typeof top !== 'number' || top < -1 || bottom > height + 1 || buttonHeight < 44) throw new Error(`Candidate recovery Retry did not fit the requested viewport: ${JSON.stringify(retry)}`)
		}
		let captureHeight = height
		if (fullDocument === true) {
			await evaluate('window.scrollTo(0, 0)')
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const documentHeight = await evaluate('Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))')
				if (typeof documentHeight !== 'number' || !Number.isSafeInteger(documentHeight) || documentHeight < height || documentHeight > 12_000) {
					throw new Error(`Dashboard route /${route} returned an invalid full-document height: ${String(documentHeight)}`)
				}
				captureHeight = documentHeight
				await command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: captureHeight, mobile: false, width })
				await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
				const fitsViewport = await evaluate('Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)) <= window.innerHeight')
				if (fitsViewport === true) break
				if (attempt === 2) throw new Error(`Dashboard route /${route} did not fit its expanded full-document viewport`)
			}
			const fullDocumentLayout = await evaluate(`(() => {
				const content = document.querySelector(${JSON.stringify(`[data-page-content="${route}"]`)})
				const bounds = content?.getBoundingClientRect()
				return {
					contentBottom: bounds?.bottom,
					contentTop: bounds?.top,
					documentHeight: Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)),
					innerHeight: window.innerHeight,
					scrollY: window.scrollY,
				}
			})()`)
			const contentBottom = typeof fullDocumentLayout === 'object' && fullDocumentLayout !== null ? Reflect.get(fullDocumentLayout, 'contentBottom') : undefined
			const contentTop = typeof fullDocumentLayout === 'object' && fullDocumentLayout !== null ? Reflect.get(fullDocumentLayout, 'contentTop') : undefined
			if (
				typeof fullDocumentLayout !== 'object' ||
				fullDocumentLayout === null ||
				Reflect.get(fullDocumentLayout, 'documentHeight') !== captureHeight ||
				Reflect.get(fullDocumentLayout, 'innerHeight') !== captureHeight ||
				Reflect.get(fullDocumentLayout, 'scrollY') !== 0 ||
				typeof contentBottom !== 'number' ||
				contentBottom > captureHeight ||
				typeof contentTop !== 'number' ||
				contentTop < 0
			) {
				throw new Error(`Dashboard route /${route} was not complete in its full-document viewport: ${JSON.stringify(fullDocumentLayout)}`)
			}
		}
		if (fullDocument !== true && catalogDetail !== true && verticalScroll === undefined && recoveryRefreshFailure === undefined) {
			await evaluate('window.scrollTo(0, 0)')
			await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
			if ((await evaluate('window.scrollY')) !== 0) throw new Error(`Dashboard route /${route} did not return to the top before capture`)
		}
		const paintTargets: PaintTarget[] = []
		if (resumeDialog === true) {
			paintTargets.push(
				{ label: 'resume confirmation', minimumDistinctColors: 12, selector: '#resume-dialog .dialog-body' },
				{ label: 'resume confirmation title', minimumDistinctColors: 8, selector: '#resume-dialog-title' },
				{ label: 'resume preflight', minimumDistinctColors: 12, selector: '#resume-preflight' },
				{ label: 'keep-paused action', minimumDistinctColors: 8, selector: '#cancel-resume' },
				{ label: 'resume action', minimumDistinctColors: 8, selector: '#confirm-resume' },
			)
		} else if (catalogDetail === true) {
			const catalogDetailSelector = '#catalog-rows tr[data-qa-catalog-detail="true"]'
			paintTargets.push(
				{ label: 'complete catalog operation card', minimumDistinctColors: 12, selector: catalogDetailSelector },
				{ label: 'catalog operation identity', minimumDistinctColors: 8, selector: `${catalogDetailSelector} .operation-name` },
				{ label: 'catalog operation risk', minimumDistinctColors: 8, selector: `${catalogDetailSelector} td:nth-child(4)` },
				{ label: 'catalog operation candidates', minimumDistinctColors: 8, selector: `${catalogDetailSelector} td:nth-child(5)` },
				{ label: 'catalog operation eligibility and blockers', minimumDistinctColors: 12, selector: `${catalogDetailSelector} td:nth-child(6)` },
			)
		} else if (verticalScroll === 'rpc-health') {
			paintTargets.push({ label: 'RPC health panel', minimumDistinctColors: 12, selector: '.rpc-health-panel' }, { label: 'RPC health Retry', minimumDistinctColors: 8, selector: '#rpc-health-retry-button' })
		} else if (verticalScroll === 'submission-health') {
			paintTargets.push({ label: 'transaction submission health panel', minimumDistinctColors: 12, selector: '.submission-health-panel' }, { label: 'transaction submission readiness', minimumDistinctColors: 8, selector: '#submission-health-status' })
		} else if (verticalScroll === 'topology') {
			paintTargets.push(
				{ label: 'topology heading', minimumDistinctColors: 12, selector: '.topology-panel .panel-heading' },
				{ label: 'topology identifier Copy', minimumDistinctColors: 8, selector: '#topology-universes .identifier-copy' },
				{ label: 'topology identifier disclosure', minimumDistinctColors: 8, selector: '#topology-universes .identifier-disclosure' },
			)
		} else if (recoveryRefreshFailure === 'candidate') {
			paintTargets.push({ label: 'candidate recovery form', minimumDistinctColors: 12, selector: '#candidate-form' }, { label: 'candidate recovery Retry', minimumDistinctColors: 8, selector: '#candidate-retry' })
		} else {
			paintTargets.push(
				{ label: 'operator brand heading', minimumDistinctColors: 8, selector: '.brand h1' },
				{ label: 'Refresh control', minimumDistinctColors: 8, selector: '#refresh-button' },
				{ label: 'Pause control', minimumDistinctColors: 8, selector: '#pause-button' },
				{ label: `${route} heading`, minimumDistinctColors: 8, selector: `[data-page-content="${route}"] h2` },
			)
			if (route === 'overview') paintTargets.push({ label: 'schedule panel', minimumDistinctColors: 12, selector: '.schedule-panel' })
			if (route === 'catalog') {
				paintTargets.push({ label: 'catalog caption', minimumDistinctColors: 8, selector: '#catalog-caption' }, { label: 'first catalog row', minimumDistinctColors: 12, selector: '#catalog-rows tr:first-child' })
				if (fullDocument === true) paintTargets.push({ label: 'last catalog row', minimumDistinctColors: 12, selector: '#catalog-rows tr:last-child' })
			}
			if (route === 'ecosystem') paintTargets.push({ label: 'first ecosystem card', minimumDistinctColors: 12, selector: '#ecosystem-grid .ecosystem-card:first-child' })
			if (route === 'activity') paintTargets.push({ label: 'pending recovery heading', minimumDistinctColors: 8, selector: '.recovery-columns .panel:first-child .panel-heading' })
			if (route === 'settings') {
				paintTargets.push(
					{ label: 'execution policy', minimumDistinctColors: 12, selector: '#settings-form' },
					{ accent: 'absent', label: 'live execution checkbox', minimumDistinctColors: 3, selector: '#execute' },
					{ accent: 'absent', label: 'high-risk checkbox', minimumDistinctColors: 3, selector: '#allow-high-risk' },
					{ accent: 'absent', label: 'irreversible checkbox', minimumDistinctColors: 3, selector: '#allow-irreversible' },
				)
				if (fullDocument === true) {
					paintTargets.push(
						{ accent: 'absent', label: 'disabled Zoltar ecosystem checkbox', minimumDistinctColors: 3, selector: '[data-ecosystem-toggle="zoltar"]' },
						{ accent: 'absent', label: 'disabled Statoblast ecosystem checkbox', minimumDistinctColors: 3, selector: '[data-ecosystem-toggle="statoblast"]' },
						{ accent: 'absent', label: 'disabled Open Oracle ecosystem checkbox', minimumDistinctColors: 3, selector: '[data-ecosystem-toggle="open-oracle"]' },
						{ accent: 'absent', label: 'disabled Trading ecosystem checkbox', minimumDistinctColors: 3, selector: '[data-ecosystem-toggle="trading"]' },
						{ label: 'transaction signer form', minimumDistinctColors: 12, selector: '#signer-form' },
					)
				}
			}
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
		const paintTargetSource = JSON.stringify(paintTargets)
		const screenshotSource = JSON.stringify(data)
		const screenshotIntegrity = await evaluate(`(async () => {
			const binary = atob(${screenshotSource})
			const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
			const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
			const canvas = document.createElement('canvas')
			canvas.width = bitmap.width
			canvas.height = bitmap.height
			const context = canvas.getContext('2d', { willReadFrequently: true })
			if (context === null) return undefined
			context.drawImage(bitmap, 0, 0)
			const targets = ${paintTargetSource}.map(target => {
				const element = document.querySelector(target.selector)
				if (!(element instanceof HTMLElement)) return { ...target, available: false }
				const bounds = element.getBoundingClientRect()
				const left = Math.max(0, Math.floor(bounds.left))
				const right = Math.min(bitmap.width, Math.ceil(bounds.right))
				const top = Math.max(0, Math.floor(bounds.top))
				const bottom = Math.min(bitmap.height, Math.ceil(bounds.bottom))
				if (right - left < 3 || bottom - top < 3) return { ...target, available: false, bottom, left, right, top }
				const pixels = context.getImageData(left, top, right - left, bottom - top).data
				const colors = new Set()
				let accentPixels = 0
				for (let index = 0; index < pixels.length; index += 4) {
					const red = pixels[index]
					const green = pixels[index + 1]
					const blue = pixels[index + 2]
					colors.add((red << 16) | (green << 8) | blue)
					if (red === 49 && green === 189 && blue === 137) accentPixels += 1
				}
				return { ...target, accentPixels, available: true, bottom, distinctColors: colors.size, left, right, top }
			})
			bitmap.close()
			return { height: canvas.height, targets, width: canvas.width }
		})()`)
		if (typeof screenshotIntegrity !== 'object' || screenshotIntegrity === null || Array.isArray(screenshotIntegrity)) throw new Error(`Dashboard route /${route} could not decode its captured PNG at original resolution`)
		if (Reflect.get(screenshotIntegrity, 'height') !== captureHeight || Reflect.get(screenshotIntegrity, 'width') !== width) {
			throw new Error(`Dashboard route /${route} captured the wrong PNG dimensions: ${JSON.stringify(screenshotIntegrity)}`)
		}
		const targetResults = Reflect.get(screenshotIntegrity, 'targets')
		if (!Array.isArray(targetResults) || targetResults.length !== paintTargets.length) throw new Error(`Dashboard route /${route} omitted screenshot paint assertions`)
		for (const target of targetResults) {
			if (typeof target !== 'object' || target === null || Array.isArray(target)) throw new Error(`Dashboard route /${route} returned an invalid screenshot paint assertion`)
			const label = Reflect.get(target, 'label')
			const colors = Reflect.get(target, 'distinctColors')
			const minimumColors = Reflect.get(target, 'minimumDistinctColors')
			const accent = Reflect.get(target, 'accent')
			const accentPixels = Reflect.get(target, 'accentPixels')
			if (Reflect.get(target, 'available') !== true || typeof colors !== 'number' || typeof minimumColors !== 'number' || colors < minimumColors) {
				throw new Error(`Dashboard route /${route} did not paint ${String(label)} into the captured PNG: ${JSON.stringify(target)}`)
			}
			if ((accent === 'absent' && accentPixels !== 0) || (accent === 'present' && (typeof accentPixels !== 'number' || accentPixels === 0))) {
				throw new Error(`Dashboard route /${route} painted the wrong control state for ${String(label)}: ${JSON.stringify(target)}`)
			}
		}
		const path = resolve(outputDirectory, `${name}.png`)
		await Bun.write(path, Buffer.from(data, 'base64'))
		console.log(`${name}: ${width.toString()}x${captureHeight.toString()} · /${route} · ${paintTargets.length.toString()} paint assertions · ${path}`)
		if (recoveryRefreshFailure === 'candidate') {
			const restored = await evaluate(`(async () => {
				const configurationResponse = await fetch('/api/configuration')
				if (!configurationResponse.ok) return false
				const configuration = await configurationResponse.json()
				const response = await fetch('/api/paused', {
					body: JSON.stringify({ paused: false, revision: configuration.revision }),
					headers: { 'content-type': 'application/json' },
					method: 'PUT',
				})
				return response.ok
			})()`)
			if (restored !== true) throw new Error('Dashboard fixture did not restore its running state after recovery-failure capture')
		}
		if (resumeDialog === true) {
			const restored = await evaluate(`(async () => {
				document.querySelector('#cancel-resume')?.click()
				const configurationResponse = await fetch('/api/configuration')
				if (!configurationResponse.ok) return false
				const configuration = await configurationResponse.json()
				const response = await fetch('/api/paused', {
					body: JSON.stringify({ paused: false, revision: configuration.revision }),
					headers: { 'content-type': 'application/json' },
					method: 'PUT',
				})
				return response.ok
			})()`)
			if (restored !== true) throw new Error('Dashboard fixture did not restore its running state after the resume-dialog capture')
		}
	}

	await capture(requestedCapture)
	if (diagnostics.length > 0) throw new Error(`Dashboard produced browser diagnostics: ${diagnostics.join('\n')}`)
	socket.close()
} finally {
	browser.kill()
	await browser.exited
	await rm(browserProfileDirectory, { force: true, recursive: true })
}
