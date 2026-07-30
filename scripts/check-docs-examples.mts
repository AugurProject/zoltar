import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'
import {
	calculateAnnualizedRetentionFeePercent,
	calculateAuctionModel,
	calculateCollateralRepairModel,
	calculateEscalationDepositModel,
	calculateForkThresholdSeries,
	calculateLiquidationHealth,
	calculateOracleSecurityModel,
	calculateResolutionModel,
	describeLiquidationHealth,
	normalizedEscalationCost,
	parseLiquidationMultiplierBps,
} from '../docs/charts/chartModels'
import { updateDiagramControl } from '../docs/charts/diagramControl'

type InteractiveExampleHarness = {
	close: () => void
	inputState: (name: string) => { disabled: boolean; value: string }
	labelFor: (name: string) => string
	output: (name: string) => string
	setInput: (name: string, value: number) => void
	textFor: (name: string) => string
	textPosition: (name: string) => { x: number; y: number }
	valueFor: (name: string) => string
}

type AuctionExampleScenario = {
	defaultBindingCondition: string
	defaultAliceReceives: string
	defaultBobReceives: string
	defaultCarolReceives: string
	underfundedAliceReceives: string
	filePath: string
	exampleId: string
}

type DeploymentManifestResponse = {
	json: () => Promise<unknown>
	ok: boolean
	status: number
}

type DeploymentDecoderTransition = {
	ariaInvalid: string | null
	guidance: string
	input: string
	status: string | null
	statusState: string | null
	summary: string
}

async function loadInteractiveExample(filePath: string, exampleId: string): Promise<InteractiveExampleHarness> {
	const html = await readFile(filePath, 'utf8')
	const window = new Window({
		url: pathToFileURL(filePath).href,
	})
	window.document.write(html)
	window.document.close()

	const script = window.document.querySelector('script:not([src])')
	const scriptText = script?.textContent
	if (scriptText === undefined || scriptText.trim().length === 0) {
		window.close()
		throw new Error(`${filePath} is missing an inline auction example script`)
	}

	const runScript = new Function('window', 'document', 'SVGCircleElement', 'SVGElement', 'SVGLineElement', 'SVGPolylineElement', 'SVGRectElement', 'SVGTextElement', scriptText)
	runScript(window, window.document, window.SVGCircleElement, window.SVGElement, window.SVGLineElement, window.SVGPolylineElement, window.SVGRectElement, window.SVGTextElement)

	const example = window.document.getElementById(exampleId)
	if (example === null) {
		window.close()
		throw new Error(`${filePath} is missing #${exampleId}`)
	}

	const setInput = (name: string, value: number) => {
		const input = example.querySelector(`[data-example-input="${name}"]`)
		if (!(input instanceof window.HTMLInputElement)) {
			throw new Error(`Missing auction example input: ${name}`)
		}
		input.value = String(value)
		input.dispatchEvent(new window.Event('input', { bubbles: true }))
	}

	const output = (name: string) => {
		const element = example.querySelector(`[data-example-output="${name}"]`)
		if (!(element instanceof window.HTMLOutputElement)) {
			throw new Error(`Missing auction example output: ${name}`)
		}
		return element.value
	}

	const inputState = (name: string) => {
		const element = example.querySelector(`[data-example-input="${name}"]`)
		if (!(element instanceof window.HTMLInputElement)) {
			throw new Error(`Missing interactive example input: ${name}`)
		}
		return {
			disabled: element.disabled,
			value: element.value,
		}
	}

	const labelFor = (name: string) => {
		const element = example.querySelector(`[data-example-output="${name}"]`)
		if (!(element instanceof window.HTMLOutputElement)) {
			throw new Error(`Missing auction example output: ${name}`)
		}
		const label = element.parentElement?.querySelector('span')
		if (!(label instanceof window.HTMLSpanElement)) {
			throw new Error(`Missing auction example label: ${name}`)
		}
		return label.textContent.trim()
	}

	const textFor = (name: string) => {
		const element = example.querySelector(`[data-example-text="${name}"]`)
		if (element === null) {
			throw new Error(`Missing interactive example text: ${name}`)
		}
		return element.textContent.trim()
	}

	const textPosition = (name: string) => {
		const element = example.querySelector(`[data-example-text="${name}"]`)
		if (!(element instanceof window.SVGTextElement)) {
			throw new Error(`Missing auction example text: ${name}`)
		}
		return {
			x: Number(element.getAttribute('x')),
			y: Number(element.getAttribute('y')),
		}
	}

	const valueFor = (name: string) => {
		const element = example.querySelector(`[data-example-value="${name}"]`)
		if (element === null) {
			throw new Error(`Missing interactive example value: ${name}`)
		}
		return element.textContent.trim()
	}

	return {
		close: () => window.close(),
		inputState,
		labelFor,
		output,
		setInput,
		textFor,
		textPosition,
		valueFor,
	}
}

async function renderDeploymentMapping(
	response: DeploymentManifestResponse,
	retryResponse?: DeploymentManifestResponse,
	sepoliaResponse?: DeploymentManifestResponse,
): Promise<{
	busy: string | null
	decoderDisabled: boolean
	decoderGuidance: string
	decoderRetryDisabled: boolean
	decoderRetryHidden: boolean
	decoderTransitions: DeploymentDecoderTransition[]
	decoderSummary: string
	decoderStatus: string | null
	decoderToolbarResetDisabled: boolean
	decoderToolbarScenarioDisabled: boolean
	decoderToolbarStatus: string
	decoderValue: string
	fetchCount: number
	link: string | null
	rowCount: number
	text: string
}> {
	const filePath = 'docs/deployment-status.html'
	const html = await readFile(filePath, 'utf8')
	const window = new Window({
		url: pathToFileURL(filePath).href,
	})
	try {
		window.document.write(html)
		window.document.close()

		const script = window.document.querySelector('script[type="module"]:not([src])')
		const scriptText = script?.textContent
		if (scriptText === undefined || scriptText.trim().length === 0) {
			throw new Error(`${filePath} is missing its manifest-rendering script`)
		}

		const responses = retryResponse === undefined ? [response] : [response, retryResponse]
		let fetchCount = 0
		const requestedUrls: string[] = []
		const fetchManifest = async (input: string | URL) => {
			const requestedUrl = String(input)
			requestedUrls.push(requestedUrl)
			if (requestedUrl.endsWith('sepolia-deployment-addresses.json')) {
				return (
					sepoliaResponse ?? {
						json: async () => ({
							deploymentSteps: [
								{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
								{ id: 'weth', label: 'Wrapped Ether' },
							],
						}),
						ok: true,
						status: 200,
					}
				)
			}
			const selectedResponse = responses[Math.min(fetchCount, responses.length - 1)]
			fetchCount += 1
			return selectedResponse
		}
		const runScript = new Function('CustomEvent', 'document', 'fetch', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLOutputElement', 'HTMLTableCellElement', 'HTMLTableSectionElement', `return (async () => { ${scriptText} })()`)
		await runScript(window.CustomEvent, window.document, fetchManifest, window.HTMLButtonElement, window.HTMLDetailsElement, window.HTMLElement, window.HTMLInputElement, window.HTMLOutputElement, window.HTMLTableCellElement, window.HTMLTableSectionElement)

		const interactiveToolsSource = await readFile('docs/interactiveTools.js', 'utf8')
		const runInteractiveTools = new Function('window', 'document', 'CustomEvent', 'DOMException', 'Event', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'navigator', 'URL', interactiveToolsSource)
		runInteractiveTools(window, window.document, window.CustomEvent, window.DOMException, window.Event, window.HTMLDetailsElement, window.HTMLElement, window.HTMLInputElement, window.HTMLSelectElement, window.navigator, window.URL)

		const mappingBody = window.document.querySelector('#deployment-status-bit-mapping')
		if (!(mappingBody instanceof window.HTMLTableSectionElement)) {
			throw new Error(`${filePath} is missing its mapping tbody`)
		}
		const sepoliaMappingBody = window.document.querySelector('#sepolia-deployment-status-bit-mapping')
		if (!(sepoliaMappingBody instanceof window.HTMLTableSectionElement)) {
			throw new Error(`${filePath} is missing its Sepolia mapping tbody`)
		}
		assert.deepEqual(requestedUrls.slice(0, 2).sort(), ['./mainnet-deployment-addresses.json', './sepolia-deployment-addresses.json'], 'the deployment page must load both canonical network manifests')
		assert.equal(sepoliaMappingBody.getAttribute('aria-busy'), 'false', 'the Sepolia mapping must clear its busy state')
		if (sepoliaResponse === undefined) {
			assert.equal(sepoliaMappingBody.querySelectorAll(':scope > tr').length, 1, 'the Sepolia mapping must render its tracked steps')
			assert.equal(sepoliaMappingBody.textContent.replaceAll(/\s+/g, ' ').trim(), '0wethWrapped Ether', 'the Sepolia mapping must preserve canonical manifest order')
		} else {
			assert.equal(sepoliaMappingBody.querySelectorAll(':scope > tr').length, 1, 'a failed Sepolia load must replace loading with one failure row')
			assert.equal(sepoliaMappingBody.textContent.replaceAll(/\s+/g, ' ').trim(), 'Unable to load the deployment mapping. Open the canonical manifest.', 'a failed Sepolia load must show a visible recovery message')
			assert.equal(sepoliaMappingBody.querySelector('a')?.getAttribute('href'), './sepolia-deployment-addresses.json', 'a failed Sepolia load must link to its canonical manifest')
		}
		const decoderInput = window.document.querySelector('[data-tool-input="deploymentMask"]')
		const decoderSummary = window.document.querySelector('[data-deployment-mask-summary]')
		const decoderGuidance = window.document.querySelector('[data-deployment-mask-guidance]')
		if (!(decoderInput instanceof window.HTMLInputElement) || !(decoderSummary instanceof window.HTMLOutputElement) || !(decoderGuidance instanceof window.HTMLElement)) {
			throw new Error(`${filePath} is missing its deployment-mask decoder`)
		}
		const decoder = window.document.querySelector('#deployment-mask-decoder')
		const decoderToolbar = decoder?.querySelector('.interactive-tool-toolbar')
		const decoderScenario = decoderToolbar?.querySelector('select')
		const decoderToolbarStatus = decoderToolbar?.querySelector('.interactive-tool-status')
		const decoderReset = Array.from(decoderToolbar?.querySelectorAll('button') ?? []).find(button => button.textContent === 'Reset')
		const decoderRetry = decoder?.querySelector('[data-deployment-mask-retry]')
		if (
			!(decoder instanceof window.HTMLDetailsElement) ||
			!(decoderToolbar instanceof window.HTMLElement) ||
			!(decoderScenario instanceof window.HTMLSelectElement) ||
			!(decoderToolbarStatus instanceof window.HTMLElement) ||
			!(decoderReset instanceof window.HTMLButtonElement) ||
			!(decoderRetry instanceof window.HTMLButtonElement)
		) {
			throw new Error(`${filePath} is missing its integrated scenario toolbar`)
		}
		if (retryResponse !== undefined) {
			assert.equal(decoderInput.disabled, true, 'a failed initial deployment mapping load must disable decoding before retry')
			assert.equal(decoderRetry.hidden, false, 'a failed initial deployment mapping load must reveal its retry action')
			decoderInput.value = '0x5'
			decoderRetry.click()
			await new Promise(resolve => setTimeout(resolve, 0))
		}
		const decoderTransitions: DeploymentDecoderTransition[] = []
		if (!decoderInput.disabled) {
			if (retryResponse === undefined) {
				for (const input of ['0x1', 'invalid', String(1n << 256n), '3']) {
					decoderInput.value = input
					decoderInput.dispatchEvent(new window.Event('input', { bubbles: true }))
					const statusCell = mappingBody.querySelector('[data-deployment-bit-status="0"]')
					decoderTransitions.push({
						ariaInvalid: decoderInput.getAttribute('aria-invalid'),
						guidance: decoderGuidance.textContent.trim(),
						input,
						status: statusCell?.textContent ?? null,
						statusState: statusCell?.getAttribute('data-mask-state') ?? null,
						summary: decoderSummary.value,
					})
				}
			}
		} else {
			decoderScenario.value = '0'
			decoderScenario.dispatchEvent(new window.Event('change', { bubbles: true }))
			decoderReset.click()
		}
		return {
			busy: mappingBody.getAttribute('aria-busy'),
			decoderDisabled: decoderInput.disabled,
			decoderGuidance: decoderGuidance.textContent.trim(),
			decoderRetryDisabled: decoderRetry.disabled,
			decoderRetryHidden: decoderRetry.hidden,
			decoderTransitions,
			decoderSummary: decoderSummary.value,
			decoderStatus: mappingBody.querySelector('[data-deployment-bit-status="0"]')?.textContent ?? null,
			decoderToolbarResetDisabled: decoderReset.disabled,
			decoderToolbarScenarioDisabled: decoderScenario.disabled,
			decoderToolbarStatus: decoderToolbarStatus.textContent,
			decoderValue: decoderInput.value,
			fetchCount,
			link: mappingBody.querySelector('a')?.getAttribute('href') ?? null,
			rowCount: mappingBody.querySelectorAll(':scope > tr').length,
			text: mappingBody.textContent.replaceAll(/\s+/g, ' ').trim(),
		}
	} finally {
		window.close()
	}
}

async function checkDeploymentMappingStates(): Promise<void> {
	const success = await renderDeploymentMapping({
		json: async () => ({
			deploymentSteps: [
				{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
				{ id: 'proxyDeployer', label: 'Proxy Deployer' },
			],
		}),
		ok: true,
		status: 200,
	})
	assert.deepEqual(success, {
		busy: 'false',
		decoderDisabled: false,
		decoderGuidance: 'Additional untracked high bits are set (shifted value 1 hex). Verify the constructor event before interpreting them.',
		decoderRetryDisabled: false,
		decoderRetryHidden: true,
		decoderTransitions: [
			{
				ariaInvalid: null,
				guidance: 'No bits are set above the tracked manifest range.',
				input: '0x1',
				status: 'Set · code present',
				statusState: 'set',
				summary: '1 of 1 tracked steps have set bits: Proxy Deployer.',
			},
			{
				ariaInvalid: 'true',
				guidance: 'Examples: 5, 0x5, or 0xff.',
				input: 'invalid',
				status: 'Unavailable · invalid mask',
				statusState: null,
				summary: 'Enter a non-negative decimal or hexadecimal integer.',
			},
			{
				ariaInvalid: 'true',
				guidance: 'Use a value between 0 and 2²⁵⁶ − 1.',
				input: String(1n << 256n),
				status: 'Unavailable · invalid mask',
				statusState: null,
				summary: 'The value is larger than a uint256.',
			},
			{
				ariaInvalid: null,
				guidance: 'Additional untracked high bits are set (shifted value 1 hex). Verify the constructor event before interpreting them.',
				input: '3',
				status: 'Set · code present',
				statusState: 'set',
				summary: '1 of 1 tracked steps have set bits: Proxy Deployer.',
			},
		],
		decoderSummary: '1 of 1 tracked steps have set bits: Proxy Deployer.',
		decoderStatus: 'Set · code present',
		decoderToolbarResetDisabled: false,
		decoderToolbarScenarioDisabled: false,
		decoderToolbarStatus: '',
		decoderValue: '3',
		fetchCount: 1,
		link: null,
		rowCount: 1,
		text: '0proxyDeployerProxy DeployerSet · code present',
	})

	for (const [scenario, response] of [
		['HTTP failure', { json: async () => ({}), ok: false, status: 503 }],
		['malformed manifest', { json: async () => ({ deploymentSteps: 'invalid' }), ok: true, status: 200 }],
		['invalid manifest row', { json: async () => ({ deploymentSteps: [{ id: 7, label: 'Invalid' }] }), ok: true, status: 200 }],
		['missing status-oracle step', { json: async () => ({ deploymentSteps: [{ id: 'proxyDeployer', label: 'Proxy Deployer' }] }), ok: true, status: 200 }],
		['status-oracle-only manifest', { json: async () => ({ deploymentSteps: [{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' }] }), ok: true, status: 200 }],
		['empty manifest', { json: async () => ({ deploymentSteps: [] }), ok: true, status: 200 }],
		[
			'over-cap manifest',
			{
				json: async () => ({
					deploymentSteps: [{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' }, ...Array.from({ length: 257 }, (_, index) => ({ id: `step${index}`, label: `Step ${index}` }))],
				}),
				ok: true,
				status: 200,
			},
		],
		[
			'duplicate manifest step',
			{
				json: async () => ({
					deploymentSteps: [
						{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
						{ id: 'proxyDeployer', label: 'Proxy Deployer' },
						{ id: 'proxyDeployer', label: 'Duplicate Proxy Deployer' },
					],
				}),
				ok: true,
				status: 200,
			},
		],
	] as const) {
		const failure = await renderDeploymentMapping(response)
		assert.equal(failure.busy, 'false', `${scenario} must clear the busy state`)
		assert.equal(failure.rowCount, 1, `${scenario} must replace loading with one failure row`)
		assert.equal(failure.text, 'Unable to load the deployment mapping. Open the canonical manifest.', `${scenario} must show a visible recovery message`)
		assert.equal(failure.link, './mainnet-deployment-addresses.json', `${scenario} must link to the canonical manifest`)
		assert.equal(failure.decoderDisabled, true, `${scenario} must disable decoding without a canonical mapping`)
		assert.deepEqual(failure.decoderTransitions, [], `${scenario} must not decode values without a canonical mapping`)
		assert.equal(failure.decoderSummary, 'The canonical mapping is unavailable, so this mask cannot be decoded safely.', `${scenario} must explain why decoding is unavailable`)
		assert.equal(failure.decoderGuidance, 'Retry to restore bit decoding and high-bit reporting.', `${scenario} must replace stale high-bit guidance`)
		assert.equal(failure.decoderRetryHidden, false, `${scenario} must expose an in-context retry action`)
		assert.equal(failure.decoderRetryDisabled, false, `${scenario} must keep the retry action available`)
		assert.equal(failure.decoderStatus, null, `${scenario} must not invent a bit status`)
		assert.equal(failure.decoderToolbarScenarioDisabled, true, `${scenario} must disable deployment-mask presets`)
		assert.equal(failure.decoderToolbarResetDisabled, true, `${scenario} must disable deployment-mask Reset`)
		assert.equal(failure.decoderToolbarStatus, '', `${scenario} must not announce that unavailable decoder results were updated`)
		assert.equal(failure.fetchCount, 1, `${scenario} must make only the initial manifest request`)
	}

	const recovered = await renderDeploymentMapping(
		{ json: async () => ({}), ok: false, status: 503 },
		{
			json: async () => ({
				deploymentSteps: [
					{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
					{ id: 'proxyDeployer', label: 'Proxy Deployer' },
					{ id: 'openOracleFactory', label: 'Open Oracle Factory' },
					{ id: 'uniformPriceDualCapBatchAuctionFactory', label: 'UniformPriceDualCapBatchAuctionFactory' },
				],
			}),
			ok: true,
			status: 200,
		},
	)
	assert.deepEqual(
		recovered,
		{
			busy: 'false',
			decoderDisabled: false,
			decoderGuidance: 'No bits are set above the tracked manifest range.',
			decoderRetryDisabled: false,
			decoderRetryHidden: true,
			decoderTransitions: [],
			decoderSummary: '2 of 3 tracked steps have set bits: Proxy Deployer, UniformPriceDualCapBatchAuctionFactory.',
			decoderStatus: 'Set · code present',
			decoderToolbarResetDisabled: false,
			decoderToolbarScenarioDisabled: false,
			decoderToolbarStatus: '',
			decoderValue: '0x5',
			fetchCount: 2,
			link: null,
			rowCount: 3,
			text: '0proxyDeployerProxy DeployerSet · code present1openOracleFactoryOpen Oracle FactoryClear · no code2uniformPriceDualCapBatchAuctionFactoryUniformPriceDualCapBatchAuctionFactorySet · code present',
		},
		'a successful retry must preserve the mask, restore the canonical rows, recompute results, and re-enable decoder controls',
	)

	await renderDeploymentMapping(
		{
			json: async () => ({
				deploymentSteps: [
					{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
					{ id: 'proxyDeployer', label: 'Proxy Deployer' },
				],
			}),
			ok: true,
			status: 200,
		},
		undefined,
		{ json: async () => ({}), ok: false, status: 503 },
	)
}

async function checkDeploymentLinkedScenarioRace(): Promise<void> {
	const filePath = 'docs/deployment-status.html'
	const html = await readFile(filePath, 'utf8')
	const interactiveToolsSource = await readFile('docs/interactiveTools.js', 'utf8')
	const linkedState = JSON.stringify({ deploymentMask: '0x5' })
	const window = new Window({
		url: `https://docs.example/deployment-status.html?tool=deployment-mask-decoder&state=${encodeURIComponent(linkedState)}#deployment-mask-decoder`,
	})
	try {
		window.document.write(html)
		window.document.close()

		const script = window.document.querySelector('script[type="module"]:not([src])')
		const scriptText = script?.textContent
		if (scriptText === undefined || scriptText.trim().length === 0) {
			throw new Error(`${filePath} is missing its manifest-rendering script`)
		}

		let resolveManifest: ((response: DeploymentManifestResponse) => void) | undefined
		const manifestResponse = new Promise<DeploymentManifestResponse>(resolve => {
			resolveManifest = resolve
		})
		const fetchManifest = async (input: string | URL) => {
			if (String(input).endsWith('sepolia-deployment-addresses.json')) {
				return {
					json: async () => ({
						deploymentSteps: [
							{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
							{ id: 'weth', label: 'Wrapped Ether' },
						],
					}),
					ok: true,
					status: 200,
				}
			}
			return manifestResponse
		}
		const runManifestScript = new Function('CustomEvent', 'document', 'fetch', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLOutputElement', 'HTMLTableCellElement', 'HTMLTableSectionElement', `return (async () => { ${scriptText} })()`)
		const loaderPromise = runManifestScript(window.CustomEvent, window.document, fetchManifest, window.HTMLButtonElement, window.HTMLDetailsElement, window.HTMLElement, window.HTMLInputElement, window.HTMLOutputElement, window.HTMLTableCellElement, window.HTMLTableSectionElement)

		const runInteractiveTools = new Function('window', 'document', 'CustomEvent', 'DOMException', 'Event', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'navigator', 'URL', interactiveToolsSource)
		runInteractiveTools(window, window.document, window.CustomEvent, window.DOMException, window.Event, window.HTMLDetailsElement, window.HTMLElement, window.HTMLInputElement, window.HTMLSelectElement, window.navigator, window.URL)

		const decoder = window.document.querySelector('#deployment-mask-decoder')
		const decoderInput = decoder?.querySelector('[data-tool-input="deploymentMask"]')
		const decoderSummary = decoder?.querySelector('[data-deployment-mask-summary]')
		const decoderStatus = decoder?.querySelector('.interactive-tool-status')
		if (!(decoder instanceof window.HTMLDetailsElement) || !(decoderInput instanceof window.HTMLInputElement) || !(decoderSummary instanceof window.HTMLOutputElement) || !(decoderStatus instanceof window.HTMLElement)) {
			throw new Error('Deployment linked-scenario fixture is incomplete')
		}
		assert.equal(decoderInput.disabled, true, 'the decoder must remain unavailable while its canonical manifest is pending')

		if (resolveManifest === undefined) throw new Error('Deployment manifest resolver was not initialized')
		resolveManifest({
			json: async () => ({
				deploymentSteps: [
					{ id: 'deploymentStatusOracle', label: 'Deployment Status Oracle' },
					{ id: 'proxyDeployer', label: 'Proxy Deployer' },
					{ id: 'openOracle', label: 'Open Oracle' },
					{ id: 'uniformPriceDualCapBatchAuctionFactory', label: 'UniformPriceDualCapBatchAuctionFactory' },
				],
			}),
			ok: true,
			status: 200,
		})
		await loaderPromise

		assert.equal(decoderInput.value, '0x5', 'a linked decoder scenario must restore after the delayed manifest makes the tool available')
		assert.equal(decoderSummary.value, '2 of 3 tracked steps have set bits: Proxy Deployer, UniformPriceDualCapBatchAuctionFactory.', 'the restored linked decoder scenario must recompute against the loaded canonical mapping')
		assert.equal(decoderStatus.textContent, 'Shared scenario loaded; results updated.', 'delayed linked-state restoration must announce completion')

		decoderInput.value = '0x1'
		decoderInput.dispatchEvent(new window.Event('input', { bubbles: true }))
		decoder.dispatchEvent(new window.CustomEvent('docs:tool-availability'))
		assert.equal(decoderInput.value, '0x1', 'later availability events must not reapply linked state over user edits')
	} finally {
		window.close()
	}
}

async function checkMmrProofPlannerStates(): Promise<void> {
	const html = await readFile('docs/merkle-mountain-range.html', 'utf8')
	const source = await readFile('docs/mmrProofPlanner.js', 'utf8')
	const window = new Window({
		url: 'https://docs.example/merkle-mountain-range.html',
	})
	try {
		window.document.write(html)
		window.document.close()
		const runScript = new Function('document', 'HTMLDetailsElement', 'HTMLInputElement', 'HTMLOutputElement', 'HTMLSelectElement', source)
		runScript(window.document, window.HTMLDetailsElement, window.HTMLInputElement, window.HTMLOutputElement, window.HTMLSelectElement)

		const planner = window.document.querySelector('#mmr-proof-planner')
		const leafCount = planner?.querySelector('[data-tool-input="leafCount"]')
		const peakHeight = planner?.querySelector('[data-tool-input="peakHeight"]')
		const leafIndex = planner?.querySelector('[data-tool-input="leafIndex"]')
		if (!(planner instanceof window.HTMLDetailsElement) || !(leafCount instanceof window.HTMLInputElement) || !(peakHeight instanceof window.HTMLSelectElement) || !(leafIndex instanceof window.HTMLInputElement)) {
			throw new Error('MMR proof planner test controls are incomplete')
		}
		const output = (name: string) => {
			const element = planner.querySelector(`[data-mmr-output="${name}"]`)
			if (!(element instanceof window.HTMLOutputElement)) throw new Error(`Missing MMR planner output: ${name}`)
			return element.value
		}
		const setInput = (input: typeof leafCount | typeof leafIndex, value: string) => {
			input.value = value
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		}
		const selectPeak = (height: number) => {
			peakHeight.value = String(height)
			peakHeight.dispatchEvent(new window.Event('change', { bubbles: true }))
		}

		assert.deepEqual(
			{
				binary: output('binary'),
				capacity: output('capacity'),
				mmrSiblings: output('mmrSiblings'),
				nullifierSiblings: output('nullifierSiblings'),
				peaks: output('peaks'),
				selection: output('selection'),
			},
			{
				binary: '1101₂',
				capacity: '4 leaves; local indexes 0…3',
				mmrSiblings: '4',
				nullifierSiblings: '64',
				peaks: '0, 2, 3',
				selection: 'Valid peak-local index',
			},
			'MMR planner runtime defaults must match the static fallback',
		)

		setInput(leafCount, '1')
		setInput(leafIndex, '0')
		assert.deepEqual(
			{
				mmrSiblings: output('mmrSiblings'),
				options: Array.from(peakHeight.options, option => option.value),
				peaks: output('peaks'),
				selection: output('selection'),
			},
			{
				mmrSiblings: '0',
				options: ['0'],
				peaks: '0',
				selection: 'Valid peak-local index',
			},
			'a one-leaf MMR must have one height-zero peak and no sibling hashes',
		)
		setInput(leafIndex, '1')
		assert.equal(leafIndex.value, '1', 'MMR test harness must update the local leaf index')
		assert.equal(output('selection'), 'Index must be between 0 and 0', 'a local index equal to peak capacity must be rejected')

		setInput(leafCount, '21')
		selectPeak(4)
		setInput(leafIndex, '15')
		assert.deepEqual(
			{
				mmrSiblings: output('mmrSiblings'),
				options: Array.from(peakHeight.options, option => option.value),
				peaks: output('peaks'),
				selection: output('selection'),
			},
			{
				mmrSiblings: '6',
				options: ['0', '2', '4'],
				peaks: '0, 2, 4',
				selection: 'Valid peak-local index',
			},
			'a 21-leaf MMR must expose the height-four peak and six total MMR siblings',
		)
		setInput(leafIndex, '16')
		assert.equal(output('selection'), 'Index must be between 0 and 15', 'the height-four capacity equality boundary must be rejected')

		setInput(leafCount, String((1n << 64n) - 1n))
		selectPeak(63)
		setInput(leafIndex, String((1n << 63n) - 1n))
		assert.equal(peakHeight.options.length, 64, 'the maximum uint64 leaf count must occupy all 64 peaks')
		assert.equal(output('mmrSiblings'), '126', 'the maximum uint64 leaf count at height 63 must require 126 MMR siblings')
		assert.equal(output('selection'), 'Valid peak-local index', 'the maximum local index below a height-63 peak capacity must be valid')

		for (const invalidLeafCount of ['0', String(1n << 64n)]) {
			setInput(leafCount, invalidLeafCount)
			assert.equal(output('binary'), 'Enter an integer from 1 through 2⁶⁴ − 1', `${invalidLeafCount} must be outside the supported leaf-count domain`)
			assert.equal(output('selection'), 'Enter an integer from 1 through 2⁶⁴ − 1', `${invalidLeafCount} must clear the prior selection result`)
			assert.equal(output('nullifierSiblings'), '64', 'invalid MMR input must not change the protocol-fixed nullifier depth')
			assert.equal(leafCount.getAttribute('aria-invalid'), 'true', `${invalidLeafCount} must expose the invalid leaf-count state`)
			assert.equal(peakHeight.disabled, true, `${invalidLeafCount} must disable the occupied-peak selector`)
			assert.deepEqual(
				Array.from(peakHeight.options, option => ({ text: option.textContent, value: option.value })),
				[{ text: 'Enter a valid leaf count', value: '' }],
				`${invalidLeafCount} must replace stale occupied peaks with one invalid-state option`,
			)
		}
		setInput(leafCount, '13')
		assert.equal(leafCount.getAttribute('aria-invalid'), null, 'a valid leaf count must clear the invalid state')
		assert.equal(peakHeight.disabled, false, 'a valid leaf count must re-enable occupied-peak selection')
		assert.deepEqual(
			Array.from(peakHeight.options, option => option.value),
			['0', '2', '3'],
			'a valid leaf count must restore only its occupied peaks after invalid input',
		)
		setInput(leafIndex, '0')
		assert.equal(output('selection'), 'Valid peak-local index', 'MMR planning must recover after invalid leaf-count input')
	} finally {
		window.close()
	}
}

function checkDiagramControlStates(): void {
	const window = new Window()
	try {
		const button = window.document.createElement('button')
		const cue = window.document.createElement('span')
		button.setAttribute('aria-pressed', 'true')

		updateDiagramControl(button, cue, true)
		assert.equal(button.textContent, 'View full size', 'fit mode must name the action that reveals the full-size diagram')
		assert.equal(button.getAttribute('aria-pressed'), null, 'an action-labeled diagram control must not announce a contradictory pressed state')
		assert.equal(cue.textContent, 'Full size reveals detailed labels.', 'fit mode must explain the available detail')

		updateDiagramControl(button, cue, false)
		assert.equal(button.textContent, 'Fit to width', 'full-size mode must name the action that restores the fitted diagram')
		assert.equal(button.getAttribute('aria-pressed'), null, 'full-size mode must remain an action button rather than a stateful toggle')
		assert.equal(cue.textContent, 'Scroll horizontally to inspect labels.', 'full-size mode must explain horizontal inspection')
	} finally {
		window.close()
	}
}

async function checkInteractiveToolControls(): Promise<void> {
	const linkedState = JSON.stringify({ aliceEth: '9', ethRaiseCap: '24' })
	const window = new Window({
		url: `https://docs.example/truth-auction.html?tool=simple-auction-example&state=${encodeURIComponent(linkedState)}#simple-auction-example`,
	})
	try {
		window.document.write(`
			<details class="interactive-example" id="simple-auction-example">
				<summary>Try a simple auction clearing run</summary>
				<input data-example-input="aliceEth" value="1">
				<input data-example-input="bobEth" value="2">
				<input data-example-input="carolEth" value="3">
				<input data-example-input="ethRaiseCap" value="4">
				<input data-example-input="repInventory" value="5">
				<div class="example-output-grid"><output>Default output</output></div>
			</details>
		`)
		window.document.close()
		let inputEventCount = 0
		window.document.addEventListener('input', () => {
			inputEventCount += 1
		})
		let copiedUrl = ''
		Object.defineProperty(window.navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async (value: string) => {
					copiedUrl = value
				},
			},
		})
		const source = await readFile('docs/interactiveTools.js', 'utf8')
		const runScript = new Function('window', 'document', 'CustomEvent', 'DOMException', 'Event', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'navigator', 'URL', source)
		runScript(window, window.document, window.CustomEvent, window.DOMException, window.Event, window.HTMLDetailsElement, window.HTMLElement, window.HTMLInputElement, window.HTMLSelectElement, window.navigator, window.URL)

		const tool = window.document.querySelector('#simple-auction-example')
		if (!(tool instanceof window.HTMLDetailsElement)) throw new Error('Interactive tool test fixture is missing')
		const value = (name: string) => {
			const input = tool.querySelector(`[data-example-input="${name}"]`)
			if (!(input instanceof window.HTMLInputElement)) throw new Error(`Missing interactive tool input: ${name}`)
			return input.value
		}
		const toolbar = tool.querySelector('.interactive-tool-toolbar')
		const scenario = toolbar?.querySelector('select')
		const status = toolbar?.querySelector('.interactive-tool-status')
		const buttons = Array.from(toolbar?.querySelectorAll('button') ?? [])
		const reset = buttons.find(button => button.textContent === 'Reset')
		const copy = buttons.find(button => button.textContent === 'Copy scenario link')
		if (!(toolbar instanceof window.HTMLElement) || !(scenario instanceof window.HTMLSelectElement) || !(status instanceof window.HTMLElement) || !(reset instanceof window.HTMLButtonElement) || !(copy instanceof window.HTMLButtonElement)) {
			throw new Error('Interactive tool toolbar is incomplete')
		}

		assert.equal(tool.open, true, 'a shared scenario must open its calculator')
		assert.equal(value('aliceEth'), '9', 'a shared scenario must restore a linked input')
		assert.equal(value('ethRaiseCap'), '24', 'a shared scenario must restore every linked input')
		assert.equal(status.textContent, 'Shared scenario loaded; results updated.', 'shared-state restoration must announce completion')
		assert.equal(tool.querySelector('.example-output-grid')?.getAttribute('aria-live'), 'polite', 'calculator output must be a live region')
		assert(inputEventCount >= 2, 'shared-state restoration must notify the calculator runtime about changed inputs')

		scenario.value = '0'
		scenario.dispatchEvent(new window.Event('change', { bubbles: true }))
		assert.deepEqual(
			{
				aliceEth: value('aliceEth'),
				bobEth: value('bobEth'),
				carolEth: value('carolEth'),
				ethRaiseCap: value('ethRaiseCap'),
				repInventory: value('repInventory'),
			},
			{
				aliceEth: '3',
				bobEth: '4',
				carolEth: '6',
				ethRaiseCap: '24',
				repInventory: '8',
			},
			'a calculator preset must apply its complete input scenario',
		)
		assert.equal(status.textContent, 'Weak demand applied; results updated.', 'preset application must announce completion')

		reset.click()
		assert.deepEqual(
			{
				aliceEth: value('aliceEth'),
				bobEth: value('bobEth'),
				carolEth: value('carolEth'),
				ethRaiseCap: value('ethRaiseCap'),
				repInventory: value('repInventory'),
			},
			{
				aliceEth: '1',
				bobEth: '2',
				carolEth: '3',
				ethRaiseCap: '4',
				repInventory: '5',
			},
			'Reset must restore the calculator values that were present before linked state was applied',
		)
		assert.equal(status.textContent, 'Default values restored.', 'Reset must announce completion')

		copy.click()
		await Promise.resolve()
		const copied = new URL(copiedUrl)
		assert.equal(copied.searchParams.get('tool'), 'simple-auction-example', 'a copied scenario must identify its calculator')
		assert.deepEqual(JSON.parse(copied.searchParams.get('state') ?? ''), {
			aliceEth: '1',
			bobEth: '2',
			carolEth: '3',
			ethRaiseCap: '4',
			repInventory: '5',
		})
		assert.equal(copied.hash, '#simple-auction-example', 'a copied scenario must include the stable calculator fragment')
	} finally {
		window.close()
	}
}

async function checkInvariantExplorerStates(): Promise<void> {
	const html = await readFile('docs/invariants.html', 'utf8')
	const source = await readFile('docs/invariantExplorer.js', 'utf8')
	const window = new Window({
		url: 'https://docs.example/invariants.html#esc-10',
	})
	try {
		window.document.write(html)
		window.document.close()
		window.HTMLElement.prototype.scrollIntoView = () => undefined
		const runScript = new Function('window', 'document', 'DOMException', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'navigator', 'requestAnimationFrame', 'URIError', 'URL', source)
		runScript(
			window,
			window.document,
			window.DOMException,
			window.HTMLButtonElement,
			window.HTMLDetailsElement,
			window.HTMLElement,
			window.HTMLInputElement,
			window.HTMLSelectElement,
			window.navigator,
			(callback: FrameRequestCallback) => {
				callback(0)
				return 1
			},
			window.URIError,
			window.URL,
		)

		const explorer = window.document.querySelector('#invariant-explorer')
		const search = explorer?.querySelector('[data-invariant-search]')
		const type = explorer?.querySelector('[data-invariant-type]')
		const status = explorer?.querySelector('[data-invariant-status]')
		const subsystem = explorer?.querySelector('[data-invariant-subsystem]')
		const count = explorer?.querySelector('[data-invariant-count]')
		const reset = explorer?.querySelector('[data-invariant-reset]')
		const expand = explorer?.querySelector('[data-invariant-expand]')
		const collapse = explorer?.querySelector('[data-invariant-collapse]')
		if (
			!(search instanceof window.HTMLInputElement) ||
			!(type instanceof window.HTMLSelectElement) ||
			!(status instanceof window.HTMLSelectElement) ||
			!(subsystem instanceof window.HTMLSelectElement) ||
			!(count instanceof window.HTMLElement) ||
			!(reset instanceof window.HTMLButtonElement) ||
			!(expand instanceof window.HTMLButtonElement) ||
			!(collapse instanceof window.HTMLButtonElement)
		) {
			throw new Error('Invariant explorer test controls are incomplete')
		}
		const entries = Array.from(window.document.querySelectorAll('details.invariant-entry')).flatMap(entry => (entry instanceof window.HTMLDetailsElement ? [entry] : []))
		const visibleIds = () => entries.filter(entry => !entry.hidden).map(entry => entry.id)

		assert.equal(entries.length, 93, 'the invariant explorer must index the complete catalog')
		assert.equal(new Set(entries.map(entry => entry.id)).size, 93, 'every invariant explorer entry must have a unique stable id')
		assert.equal(count.textContent, '93 of 93 invariants', 'the invariant explorer must report the complete default catalog')
		assert.equal(window.document.querySelector('#esc-10')?.hasAttribute('open'), true, 'an invariant fragment must open its matching entry')
		assert.deepEqual({ status: status.options.length, subsystem: subsystem.options.length, type: type.options.length }, { status: 5, subsystem: 10, type: 5 }, 'invariant facets must be derived from all catalog metadata values plus their All options')
		assert.equal(window.document.querySelectorAll('.invariant-entry-actions').length, 93, 'every invariant must receive permalink actions')

		search.value = 'replay'
		search.dispatchEvent(new window.Event('input', { bubbles: true }))
		assert.deepEqual(visibleIds(), ['esc-05', 'esc-10', 'obs-01', 'ext-05'], 'replay search must match all and only the catalog entries whose full evidence text contains replay')
		assert.equal(count.textContent, '4 of 93 invariants', 'filtered invariant count must remain explicit')
		expand.click()
		assert(
			entries.filter(entry => !entry.hidden).every(entry => entry.open),
			'Expand visible must open only the filtered results',
		)
		collapse.click()
		assert(
			entries.every(entry => !entry.open),
			'Collapse all must close the complete catalog',
		)

		reset.click()
		assert.equal(search.value, '', 'Reset filters must clear the search query')
		assert.equal(count.textContent, '93 of 93 invariants', 'Reset filters must restore the complete result count')
		assert.equal(visibleIds().length, 93, 'Reset filters must restore every catalog entry')
	} finally {
		window.close()
	}
}

async function checkReaderRuntimeStates(): Promise<void> {
	const html = await readFile('docs/documentation.html', 'utf8')
	const generated = await readFile('docs/docsReaderMarkdown.js', 'utf8')
	const searchIndex = JSON.parse(await readFile('docs/docsReaderSearchIndex.json', 'utf8'))
	const source = await readFile('docs/docsReader.js', 'utf8')
	const fetchRequests: Array<{
		input: string
		resolve: (response: { ok: boolean; text: () => Promise<string> }) => void
	}> = []
	const window = new Window({
		url: 'https://docs.example/documentation.html#doc-truth-auction--simple-auction-example',
	})
	try {
		window.document.write(html)
		window.document.close()
		window.HTMLElement.prototype.scrollIntoView = () => undefined
		new Function('window', generated)(window)
		Reflect.set(window, 'docsReaderSearchIndex', searchIndex)
		const controlledFetch = (input: string) =>
			new Promise<{ ok: boolean; text: () => Promise<string> }>(resolve => {
				fetchRequests.push({ input, resolve })
			})
		const resolveFetch = async (index: number) => {
			const request = fetchRequests[index]
			if (request === undefined) throw new Error(`Reader fetch request ${index} is missing`)
			request.resolve({
				ok: true,
				text: async () => '<!doctype html><html><head><title>Reader test</title></head><body><details id="simple-auction-example"></details><section id="deployment-mask-decoder"></section><section id="callback-rejection-and-recovery"></section></body></html>',
			})
			for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve()
		}
		const runScript = new Function('window', 'document', 'CustomEvent', 'Element', 'fetch', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'ResizeObserver', 'URL', 'requestAnimationFrame', source)
		runScript(window, window.document, window.CustomEvent, window.Element, controlledFetch, window.HTMLAnchorElement, window.HTMLButtonElement, window.HTMLDetailsElement, window.HTMLElement, window.HTMLInputElement, window.HTMLTextAreaElement, undefined, window.URL, (callback: FrameRequestCallback) => {
			callback(0)
			return 1
		})

		const chapters = Array.from(window.document.querySelectorAll('.reader-chapter')).flatMap(chapter => (chapter instanceof window.HTMLElement ? [chapter] : []))
		const activeChapters = chapters.filter(chapter => !chapter.hidden)
		assert.equal(chapters.length, 14, 'reader runtime must create one lazy chapter shell per generated document')
		assert.deepEqual(
			activeChapters.map(chapter => chapter.getAttribute('data-document-path')),
			['truth-auction.html'],
			'a reader deep link must select only its target document',
		)
		assert.deepEqual(
			fetchRequests.map(request => request.input),
			['./truth-auction.html'],
			'reader startup must request only the selected document',
		)
		assert.equal(window.document.querySelectorAll('iframe[data-reader-source-ready="true"]').length, 0, 'non-selected reader frames must remain unsourced while the active request is pending')
		assert.equal(window.document.querySelectorAll('.reader-nav-tool-link').length > 0, true, 'reader navigation must expose generated interactive-tool links')
		const assertNavigationOrder = (documentPath: string, expectedFragments: string[]) => {
			const expectedSet = new Set(expectedFragments)
			const actualFragments = Array.from(window.document.querySelectorAll(`.reader-nav-document[data-navigation-document-path="${documentPath}"] a[data-document-fragment]`), link => link.getAttribute('data-document-fragment')).filter(fragment => fragment !== null && expectedSet.has(fragment))
			assert.deepEqual(actualFragments, expectedFragments, `${documentPath} reader tools must remain in source order with their owning sections`)
		}
		assertNavigationOrder('deployment-status.html', ['ordering', 'deployment-mask-decoder', 'limit'])
		assertNavigationOrder('merkle-mountain-range.html', ['proofs', 'mmr-proof-planner', 'snapshots'])
		assertNavigationOrder('open-oracle-integration.html', ['security-guarantee', 'initial-report-estimator-example', 'callback-rejection-and-recovery', 'attack-model', 'binary-censorship-example', 'parameters'])
		assertNavigationOrder('liquidation.html', ['sliders', 'liquidation-health-example', 'liquidation-path-example', 'incentives'])
		assertNavigationOrder('statoblast-whitepaper.html', ['escalation', 'escalation-deposit-example', 'resolution-edge-example', 'migration', 'collateral-repair-example', 'auction'])

		const search = window.document.querySelector('[data-doc-search]')
		if (!(search instanceof window.HTMLInputElement)) throw new Error('Reader search input is missing')
		search.value = 'MMR sibling hashes required'
		search.dispatchEvent(new window.Event('input', { bubbles: true }))
		const plannerResults = Array.from(window.document.querySelectorAll('[data-search-results] a[data-document-path]'))
		assert.equal(plannerResults.length, 1, 'tool-specific search text must have one canonical generated result')
		assert.equal(plannerResults[0]?.getAttribute('data-document-path'), 'merkle-mountain-range.html', 'tool-specific search must identify the MMR guide')
		assert.equal(plannerResults[0]?.getAttribute('data-document-fragment'), 'mmr-proof-planner', 'tool-specific search must route only to its dedicated tool entry')

		search.value = 'deployment mask'
		search.dispatchEvent(new window.Event('input', { bubbles: true }))
		const firstResult = window.document.querySelector('[data-search-results] a[data-document-path]')
		if (!(firstResult instanceof window.HTMLAnchorElement)) throw new Error('Reader search did not render a result')
		assert.equal(firstResult.dataset['documentPath'], 'deployment-status.html', 'reader search must rank the deployment document first for deployment mask')
		assert.equal(firstResult.dataset['documentFragment'], 'deployment-mask-decoder', 'reader search must route directly to the deployment decoder')
		assert.match(firstResult.textContent, /Decode a deployment mask/, 'reader search must label the matching interactive tool')
		assert.deepEqual(
			fetchRequests.map(request => request.input),
			['./truth-auction.html'],
			'searching the generated corpus must not fetch another document',
		)

		firstResult.click()
		assert.deepEqual(
			chapters.filter(chapter => !chapter.hidden).map(chapter => chapter.dataset['documentPath']),
			['deployment-status.html'],
			'reader navigation must switch to only the selected search result',
		)
		assert.deepEqual(
			fetchRequests.map(request => request.input),
			['./truth-auction.html', './deployment-status.html'],
			'reader navigation must request its newly selected document',
		)
		assert.equal(window.document.querySelectorAll('iframe[data-reader-source-ready="true"]').length, 0, 'navigating away must leave the stale and active pending frames unsourced')

		await resolveFetch(0)
		assert.equal(window.document.querySelectorAll('iframe[data-reader-source-ready="true"]').length, 0, 'a stale request completion must not source its inactive frame')

		await resolveFetch(1)
		const sourcedAfterActiveResponse = Array.from(window.document.querySelectorAll('iframe[data-reader-source-ready="true"]'))
		assert.equal(sourcedAfterActiveResponse.length, 1, 'only the active frame may receive a source after its request completes')
		assert.equal(sourcedAfterActiveResponse[0]?.getAttribute('data-document-frame'), 'deployment-status.html', 'the one sourced reader frame must belong to the active document')

		const markdownLink = window.document.querySelector('.reader-nav-document-link[data-document-path="operator-reference.md"]')
		if (!(markdownLink instanceof window.HTMLAnchorElement)) throw new Error('Reader Markdown navigation link is missing')
		markdownLink.click()
		const sourcedAfterMarkdownNavigation = Array.from(window.document.querySelectorAll('iframe[data-reader-source-ready="true"]'))
		assert.equal(sourcedAfterMarkdownNavigation.length, 1, 'sequential reader navigation must unload the previously sourced frame')
		assert.equal(sourcedAfterMarkdownNavigation[0]?.getAttribute('data-document-frame'), 'operator-reference.md', 'the selected Markdown document must be the only sourced frame')

		search.value = 'callback rejection'
		search.dispatchEvent(new window.Event('input', { bubbles: true }))
		const callbackResult = window.document.querySelector('[data-search-results] a[data-document-path]')
		if (!(callbackResult instanceof window.HTMLAnchorElement)) throw new Error('Reader callback search did not render a result')
		assert.equal(callbackResult.dataset['documentPath'], 'open-oracle-integration.html', 'callback search must identify the OpenOracle integration guide')
		assert.equal(callbackResult.dataset['documentFragment'], 'callback-rejection-and-recovery', 'callback search must use the real stable callback section fragment')
		callbackResult.click()
		assert.deepEqual(
			chapters.filter(chapter => !chapter.hidden).map(chapter => chapter.dataset['documentPath']),
			['open-oracle-integration.html'],
			'callback search navigation must select only the OpenOracle chapter',
		)
		await resolveFetch(2)
		const sourcedAfterCallbackNavigation = Array.from(window.document.querySelectorAll('iframe[data-reader-source-ready="true"]'))
		assert.equal(sourcedAfterCallbackNavigation.length, 1, 'callback navigation must retain only its active sourced frame')
		assert.equal(sourcedAfterCallbackNavigation[0]?.getAttribute('data-document-frame'), 'open-oracle-integration.html', 'callback navigation must source the OpenOracle frame')
		assert.equal(window.location.hash, '#doc-open-oracle-integration--callback-rejection-and-recovery', 'callback search navigation must preserve its section fragment in reader history')
	} finally {
		window.close()
	}

	const lazySearchRequests: Array<{
		input: string
		resolve: (response: { json?: () => Promise<unknown>; ok: boolean; status: number; text?: () => Promise<string> }) => void
	}> = []
	const lazySearchWindow = new Window({
		url: 'https://docs.example/documentation.html',
	})
	try {
		lazySearchWindow.document.write(html)
		lazySearchWindow.document.close()
		lazySearchWindow.HTMLElement.prototype.scrollIntoView = () => undefined
		new Function('window', generated)(lazySearchWindow)
		const controlledFetch = (input: string) =>
			new Promise<{ json?: () => Promise<unknown>; ok: boolean; status: number; text?: () => Promise<string> }>(resolve => {
				lazySearchRequests.push({ input, resolve })
			})
		const runScript = new Function('window', 'document', 'CustomEvent', 'Element', 'fetch', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'ResizeObserver', 'URL', 'requestAnimationFrame', source)
		runScript(
			lazySearchWindow,
			lazySearchWindow.document,
			lazySearchWindow.CustomEvent,
			lazySearchWindow.Element,
			controlledFetch,
			lazySearchWindow.HTMLAnchorElement,
			lazySearchWindow.HTMLButtonElement,
			lazySearchWindow.HTMLDetailsElement,
			lazySearchWindow.HTMLElement,
			lazySearchWindow.HTMLInputElement,
			lazySearchWindow.HTMLTextAreaElement,
			undefined,
			lazySearchWindow.URL,
			(callback: FrameRequestCallback) => {
				callback(0)
				return 1
			},
		)
		assert.deepEqual(
			lazySearchRequests.map(request => request.input),
			['./statoblast-whitepaper.html'],
			'reader startup must not request the full-text search index',
		)
		const lazySearchInput = lazySearchWindow.document.querySelector('[data-doc-search]')
		if (!(lazySearchInput instanceof lazySearchWindow.HTMLInputElement)) throw new Error('Lazy reader search input is missing')
		const lazySearchStatus = lazySearchWindow.document.querySelector('[data-search-status]')
		const lazyEmptyState = lazySearchWindow.document.querySelector('[data-reader-empty]')
		const lazyEmptyGuidance = lazySearchWindow.document.querySelector('[data-reader-empty-guidance]')
		const lazyRetry = lazySearchWindow.document.querySelector('[data-retry-search]')
		lazySearchInput.focus()
		assert.deepEqual(
			lazySearchRequests.map(request => request.input),
			['./statoblast-whitepaper.html', './docsReaderSearchIndex.json'],
			'focusing reader search must request the full-text index on demand',
		)
		assert.equal(lazySearchStatus?.textContent, 'Loading full-text search…', 'search focus must announce full-text index loading before a query is entered')
		const indexRequest = lazySearchRequests[1]
		if (indexRequest === undefined) throw new Error('Lazy reader search-index request is missing')
		indexRequest.resolve({ ok: false, status: 503 })
		for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve()
		assert.equal(lazySearchStatus?.textContent, 'Full-text search unavailable; titles and summaries remain searchable', 'a failed index request must announce its metadata-only fallback before a query is entered')
		lazySearchInput.value = 'MMR sibling hashes required'
		lazySearchInput.dispatchEvent(new lazySearchWindow.Event('input', { bubbles: true }))
		assert.equal(lazySearchStatus?.textContent, 'No title or summary matches; full-text search is unavailable', 'a failed index request must announce the remaining metadata-search scope')
		assert.equal(lazyEmptyState?.hasAttribute('hidden'), false, 'a failed full-text query must reveal the empty state')
		assert.match(lazyEmptyGuidance?.textContent ?? '', /Only document titles and summaries are searchable/, 'the failed-index empty state must not promise full-text results')
		assert.equal(lazyRetry?.hasAttribute('hidden'), false, 'a failed index request must expose a retry action')

		lazySearchInput.value = '256-step limit'
		lazySearchInput.dispatchEvent(new lazySearchWindow.Event('input', { bubbles: true }))
		const metadataResult = lazySearchWindow.document.querySelector('[data-search-results] a[data-document-path="deployment-status.html"]')
		assert.equal(metadataResult?.hasAttribute('data-document-fragment'), false, 'title and summary search must remain available without the full-text index')
		assert.equal(lazySearchWindow.document.querySelector('.reader-search-results-heading')?.textContent, 'Best matches', 'metadata-only fallback results must use a document-or-section-neutral heading')

		if (!(lazyRetry instanceof lazySearchWindow.HTMLButtonElement)) throw new Error('Lazy reader search retry is missing')
		lazyRetry.click()
		assert.equal(lazySearchStatus?.textContent, 'Loading full-text search…', 'retrying the index must announce renewed loading even when a query is present')
		assert.deepEqual(
			lazySearchRequests.map(request => request.input),
			['./statoblast-whitepaper.html', './docsReaderSearchIndex.json', './docsReaderSearchIndex.json'],
			'retrying full-text search must issue a new index request',
		)
		const retryIndexRequest = lazySearchRequests[2]
		if (retryIndexRequest === undefined) throw new Error('Retried reader search-index request is missing')
		retryIndexRequest.resolve({
			json: async () => {
				throw new TypeError('Response body could not be read')
			},
			ok: true,
			status: 200,
		})
		for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve()
		assert.equal(lazySearchStatus?.textContent, '1 document and 0 matching sections or tools; full-text search is unavailable', 'a rejected index response body must restore metadata-only search')
		assert.equal(lazyRetry.hasAttribute('hidden'), false, 'a rejected index response body must expose retry')

		lazyRetry.click()
		const malformedIndexRequest = lazySearchRequests[3]
		if (malformedIndexRequest === undefined) throw new Error('Malformed reader search-index request is missing')
		malformedIndexRequest.resolve({ json: async () => ({}), ok: true, status: 200 })
		for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve()
		assert.equal(lazySearchStatus?.textContent, '1 document and 0 matching sections or tools; full-text search is unavailable', 'an incomplete index payload must restore metadata-only search')
		assert.equal(lazyRetry.hasAttribute('hidden'), false, 'an incomplete index payload must expose retry')

		lazyRetry.click()
		const recoveredIndexRequest = lazySearchRequests[4]
		if (recoveredIndexRequest === undefined) throw new Error('Recovered reader search-index request is missing')
		recoveredIndexRequest.resolve({ json: async () => searchIndex, ok: true, status: 200 })
		for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve()
		assert.match(lazySearchStatus?.textContent ?? '', /^Full-text search restored;/, 'a successful retry must announce restored full-text search before the next query change')
		lazySearchInput.value = 'MMR sibling hashes required'
		lazySearchInput.dispatchEvent(new lazySearchWindow.Event('input', { bubbles: true }))
		const lazyResult = lazySearchWindow.document.querySelector('[data-search-results] a[data-document-path="merkle-mountain-range.html"]')
		assert.equal(lazyResult?.getAttribute('data-document-fragment'), 'mmr-proof-planner', 'a retried lazy index must restore full-text tool results')
	} finally {
		lazySearchWindow.close()
	}

	const historyFetchRequests: Array<{
		input: string
		resolve: (response: { ok: boolean; text: () => Promise<string> }) => void
	}> = []
	const historyWindow = new Window({
		url: 'https://docs.example/documentation.html',
	})
	try {
		historyWindow.document.write(html)
		historyWindow.document.close()
		let simulatedScrollY = 0
		historyWindow.HTMLElement.prototype.scrollIntoView = () => {
			simulatedScrollY = 0
		}
		Object.defineProperty(historyWindow, 'scrollY', {
			configurable: true,
			get: () => simulatedScrollY,
		})
		Object.defineProperty(historyWindow, 'scrollTo', {
			configurable: true,
			value: (optionsOrX: ScrollToOptions | number, y?: number) => {
				const nextScrollY = typeof optionsOrX === 'number' ? y : optionsOrX.top
				if (typeof nextScrollY === 'number') simulatedScrollY = nextScrollY
			},
		})
		new Function('window', generated)(historyWindow)
		const controlledFetch = (input: string) =>
			new Promise<{ ok: boolean; text: () => Promise<string> }>(resolve => {
				historyFetchRequests.push({ input, resolve })
			})
		const resolveFetch = async (index: number) => {
			const request = historyFetchRequests[index]
			if (request === undefined) throw new Error(`Reader history fetch request ${index} is missing`)
			request.resolve({
				ok: true,
				text: async () => '<!doctype html><html><head><title>Reader history test</title></head><body><main>Reader history test</main></body></html>',
			})
			for (let attempt = 0; attempt < 6; attempt += 1) await Promise.resolve()
		}
		const runScript = new Function('window', 'document', 'CustomEvent', 'Element', 'fetch', 'HTMLAnchorElement', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'ResizeObserver', 'URL', 'requestAnimationFrame', source)
		runScript(
			historyWindow,
			historyWindow.document,
			historyWindow.CustomEvent,
			historyWindow.Element,
			controlledFetch,
			historyWindow.HTMLAnchorElement,
			historyWindow.HTMLButtonElement,
			historyWindow.HTMLDetailsElement,
			historyWindow.HTMLElement,
			historyWindow.HTMLInputElement,
			historyWindow.HTMLTextAreaElement,
			undefined,
			historyWindow.URL,
			(callback: FrameRequestCallback) => {
				callback(0)
				return 1
			},
		)
		const historyChapters = Array.from(historyWindow.document.querySelectorAll('.reader-chapter')).flatMap(chapter => (chapter instanceof historyWindow.HTMLElement ? [chapter] : []))
		const activePaths = () => historyChapters.filter(chapter => !chapter.hidden).map(chapter => chapter.dataset['documentPath'])
		const historyHash = () => historyWindow.location.hash
		const settleScrollStabilization = () => new Promise(resolve => setTimeout(resolve, 700))

		assert.deepEqual(activePaths(), ['statoblast-whitepaper.html'], 'a hashless reader must start on the default first chapter')
		await resolveFetch(0)
		historyWindow.scrollTo({ top: 240 })
		const deploymentLink = historyWindow.document.querySelector('.reader-nav-document-link[data-document-path="deployment-status.html"]')
		if (!(deploymentLink instanceof historyWindow.HTMLAnchorElement)) throw new Error('Reader deployment navigation link is missing')
		deploymentLink.click()
		await resolveFetch(1)
		await settleScrollStabilization()
		assert.deepEqual(activePaths(), ['deployment-status.html'], 'forward reader navigation must select the requested chapter before Back')
		assert.equal(historyHash(), '#doc-deployment-status', 'forward reader navigation must create a chapter hash')
		historyWindow.scrollTo({ top: 740 })

		const oracleLink = historyWindow.document.querySelector('.reader-nav-document-link[data-document-path="open-oracle-integration.html"]')
		if (!(oracleLink instanceof historyWindow.HTMLAnchorElement)) throw new Error('Reader OpenOracle navigation link is missing')
		oracleLink.click()
		await resolveFetch(2)
		await settleScrollStabilization()
		assert.deepEqual(activePaths(), ['open-oracle-integration.html'], 'a second forward reader navigation must select its requested chapter')
		assert.equal(historyHash(), '#doc-open-oracle-integration', 'a second forward reader navigation must retain the prior chapter in history')

		historyWindow.history.back()
		for (let attempt = 0; attempt < 20 && historyHash() !== '#doc-deployment-status'; attempt += 1) {
			await new Promise(resolve => setTimeout(resolve, 0))
		}
		assert.equal(historyHash(), '#doc-deployment-status', 'the first browser Back must restore the prior reader chapter URL')
		assert.deepEqual(activePaths(), ['deployment-status.html'], 'the first browser Back must restore the prior reader chapter')
		await resolveFetch(3)
		await settleScrollStabilization()
		assert.equal(simulatedScrollY, 740, 'browser Back must retain the prior reader scroll position after the restored frame finishes loading')

		historyWindow.history.back()
		for (let attempt = 0; attempt < 20 && historyHash().length > 0; attempt += 1) {
			await new Promise(resolve => setTimeout(resolve, 0))
		}
		assert.equal(historyHash(), '', 'browser Back must restore the reader initial hashless URL')
		assert.deepEqual(activePaths(), ['statoblast-whitepaper.html'], 'browser Back to the hashless URL must restore the default first chapter')
		assert.deepEqual(
			historyFetchRequests.map(request => request.input),
			['./statoblast-whitepaper.html', './deployment-status.html', './open-oracle-integration.html', './deployment-status.html', './statoblast-whitepaper.html'],
			'sequential browser Back navigation must unload each later document and request the restored chapters in order',
		)
		await resolveFetch(4)
		await settleScrollStabilization()
		assert.equal(simulatedScrollY, 240, 'browser Back to the hashless reader URL must restore its saved scroll position')
		const sourcedAfterBack = Array.from(historyWindow.document.querySelectorAll('iframe[data-reader-source-ready="true"]'))
		assert.equal(sourcedAfterBack.length, 1, 'browser Back must leave exactly one sourced reader frame')
		assert.equal(sourcedAfterBack[0]?.getAttribute('data-document-frame'), 'statoblast-whitepaper.html', 'the default first chapter must be the sole source after Back')
	} finally {
		historyWindow.close()
	}
}

async function checkLiquidationMultiplierBoundaries(): Promise<void> {
	const filePath = 'docs/liquidation.html'
	const html = await readFile(filePath, 'utf8')
	const window = new Window({
		url: pathToFileURL(filePath).href,
	})
	try {
		window.document.write(html)
		window.document.close()

		const output = (name: string) => {
			const element = window.document.querySelector(`[data-liquidation-output="${name}"]`)
			if (!(element instanceof window.HTMLElement)) throw new Error(`Missing liquidation output: ${name}`)
			return element.textContent.trim()
		}
		const defaultFallback = {
			cap: output('cap'),
			postDebt: output('postDebt'),
			repMoved: output('repMoved'),
			required: output('required'),
			shortfall: output('shortfall'),
			status: output('status'),
		}

		const script = window.document.querySelector('script:not([src])')
		const scriptText = script?.textContent
		if (scriptText === undefined || scriptText.trim().length === 0) throw new Error(`${filePath} is missing its inline calculator script`)
		const runScript = new Function('document', scriptText)
		runScript(window.document)

		assert.deepEqual(
			{
				cap: output('cap'),
				postDebt: output('postDebt'),
				repMoved: output('repMoved'),
				required: output('required'),
				shortfall: output('shortfall'),
				status: output('status'),
			},
			defaultFallback,
			'liquidation calculator runtime defaults must match its static fallback',
		)

		const setInput = (name: string, value: string) => {
			const input = window.document.querySelector(`[data-liquidation-input="${name}"]`)
			if (!(input instanceof window.HTMLInputElement)) throw new Error(`Missing liquidation input: ${name}`)
			input.value = value
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		}
		setInput('rep', '110')
		setInput('debt', '25')
		setInput('price', '4')

		for (const [multiplier, expected] of [
			['1.0999', { required: '109.99 REP', shortfall: '0 REP', status: 'Safe' }],
			['1.1', { required: '110 REP', shortfall: '0 REP', status: 'Safe' }],
			['1.1001', { required: '110.01 REP', shortfall: '0.01 REP', status: 'Liquidatable' }],
		] as const) {
			setInput('multiplier', multiplier)
			assert.deepEqual(
				{
					required: output('required'),
					shortfall: output('shortfall'),
					status: output('status'),
				},
				expected,
				`liquidation calculator must preserve the exact ${multiplier}x BPS boundary`,
			)
		}
	} finally {
		window.close()
	}
}

async function loadAuctionExample({ filePath, exampleId }: AuctionExampleScenario): Promise<InteractiveExampleHarness> {
	return loadInteractiveExample(filePath, exampleId)
}

function assertEqual(actual: string, expected: string, message: string): void {
	assert.equal(actual, expected, `${message}: expected "${expected}", got "${actual}"`)
}

async function checkDefaultFundedClearing(scenario: AuctionExampleScenario): Promise<void> {
	const example = await loadAuctionExample(scenario)
	try {
		assertEqual(example.output('clearingMode'), 'uniform clearing near 3 ETH/REP', `${scenario.filePath} clearing mode`)
		assertEqual(example.output('bindingCondition'), scenario.defaultBindingCondition, `${scenario.filePath} default binding condition`)
		assertEqual(example.labelFor('ethRaised'), 'ETH retained', `${scenario.filePath} ETH retained label`)
		assertEqual(example.output('ethRaised'), '12 ETH', `${scenario.filePath} default retained ETH`)
		assertEqual(example.labelFor('thresholdInputEth'), 'Winning ETH kept', `${scenario.filePath} threshold input label`)
		assertEqual(example.output('thresholdInputEth'), 'not underfunded', `${scenario.filePath} default threshold input ETH`)
		assertEqual(example.output('aliceReceives'), scenario.defaultAliceReceives, `${scenario.filePath} Alice REP`)
		assertEqual(example.output('bobReceives'), scenario.defaultBobReceives, `${scenario.filePath} Bob REP`)
		assertEqual(example.output('carolReceives'), scenario.defaultCarolReceives, `${scenario.filePath} Carol REP`)
		assertEqual(example.output('totalRepAllocated'), '4 REP', `${scenario.filePath} default total REP allocation`)
		assertEqual(example.output('refunds'), '1 ETH', `${scenario.filePath} default refunds`)
	} finally {
		example.close()
	}
}

async function checkExplicitEthCapScenario(scenario: AuctionExampleScenario): Promise<void> {
	const example = await loadAuctionExample(scenario)
	try {
		example.setInput('ethRaiseCap', 6)
		example.setInput('repInventory', 10)
		example.setInput('aliceEth', 8)
		example.setInput('bobEth', 4)
		example.setInput('carolEth', 2)

		assertEqual(example.output('bindingCondition'), 'ETH cap', `${scenario.filePath} ETH-cap binding condition`)
		assertEqual(example.output('clearingMode'), 'uniform clearing near 5 ETH/REP', `${scenario.filePath} ETH-cap clearing mode`)
		assertEqual(example.output('ethRaised'), '6 ETH', `${scenario.filePath} ETH-cap retained ETH`)
		assertEqual(example.output('refunds'), '8 ETH', `${scenario.filePath} ETH-cap refunds`)
	} finally {
		example.close()
	}
}

async function checkUnderfundedPath(scenario: AuctionExampleScenario): Promise<void> {
	const example = await loadAuctionExample(scenario)
	try {
		example.setInput('ethRaiseCap', 20)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 16)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		assertEqual(example.output('clearingMode'), 'underfunded qualification clearing', `${scenario.filePath} underfunded clearing mode`)
		assertEqual(example.output('bindingCondition'), 'underfunded', `${scenario.filePath} underfunded binding condition`)
		assertEqual(example.labelFor('ethRaised'), 'ETH retained', `${scenario.filePath} underfunded ETH retained label`)
		assertEqual(example.output('ethRaised'), '16 ETH', `${scenario.filePath} underfunded retained ETH`)
		assertEqual(example.labelFor('thresholdInputEth'), 'Winning ETH kept', `${scenario.filePath} underfunded threshold label`)
		assertEqual(example.output('thresholdInputEth'), '16 ETH', `${scenario.filePath} underfunded threshold input ETH`)
		assertEqual(example.output('underfundedThreshold'), '5 ETH/REP', `${scenario.filePath} underfunded threshold`)
		assertEqual(example.output('aliceReceives'), scenario.underfundedAliceReceives, `${scenario.filePath} underfunded Alice REP`)
		assertEqual(example.output('bobReceives'), '0 REP', `${scenario.filePath} underfunded Bob REP`)
		assertEqual(example.output('carolReceives'), '0 REP', `${scenario.filePath} underfunded Carol REP`)
		assertEqual(example.output('totalRepAllocated'), '4 REP', `${scenario.filePath} underfunded total REP allocation`)
		assertEqual(example.output('refunds'), '0 ETH', `${scenario.filePath} underfunded refunds`)
	} finally {
		example.close()
	}
}

async function checkAllZeroBids(scenario: AuctionExampleScenario): Promise<void> {
	const example = await loadAuctionExample(scenario)
	try {
		example.setInput('ethRaiseCap', 30)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 0)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		assertEqual(example.output('clearingMode'), 'underfunded qualification clearing', `${scenario.filePath} zero-bid clearing mode`)
		assertEqual(example.output('bindingCondition'), 'underfunded', `${scenario.filePath} zero-bid binding condition`)
		assertEqual(example.output('ethRaised'), '0 ETH', `${scenario.filePath} zero-bid retained ETH`)
		assertEqual(example.output('thresholdInputEth'), '0 ETH', `${scenario.filePath} zero-bid threshold input ETH`)
		const expectedThreshold = scenario.filePath === 'docs/statoblast-whitepaper.html' ? '7.50 ETH/REP' : '7.5 ETH/REP'
		assertEqual(example.output('underfundedThreshold'), expectedThreshold, `${scenario.filePath} zero-bid threshold`)
		assertEqual(example.output('aliceReceives'), '0 REP', `${scenario.filePath} zero-bid Alice REP`)
		assertEqual(example.output('bobReceives'), '0 REP', `${scenario.filePath} zero-bid Bob REP`)
		assertEqual(example.output('carolReceives'), '0 REP', `${scenario.filePath} zero-bid Carol REP`)
		assertEqual(example.output('totalRepAllocated'), '0 REP', `${scenario.filePath} zero-bid total REP allocation`)
		assertEqual(example.output('refunds'), '0 ETH', `${scenario.filePath} zero-bid refunds`)
	} finally {
		example.close()
	}
}

async function checkSourceLabelsAndThresholdText(filePath: string, requiredSourceSnippets: string[]): Promise<void> {
	const html = await readFile(filePath, 'utf8')
	assert.match(html, /<span>ETH retained<\/span/, `${filePath} should label retained ETH explicitly`)
	assert.match(html, /<span>Winning ETH kept<\/span/, `${filePath} should label winning ETH kept explicitly`)
	assert.match(html, /qualification threshold as <code>clearingTick<\/code>[\s\S]*Only bids at or above/, `${filePath} should describe the underfunded winner boundary with clearingTick`)
	for (const snippet of requiredSourceSnippets) {
		assert.match(html, new RegExp(escapeRegExp(snippet)), `${filePath} is missing expected source snippet: ${snippet}`)
	}
}

async function checkCollateralRepairExample(): Promise<void> {
	const html = await readFile('docs/statoblast-whitepaper.html', 'utf8')
	const window = new Window({
		url: pathToFileURL('docs/statoblast-whitepaper.html').href,
	})
	window.document.write(html)
	window.document.close()

	try {
		const script = window.document.querySelector('script:not([src])')
		const scriptText = script?.textContent
		if (scriptText === undefined || scriptText.trim().length === 0) {
			throw new Error('docs/statoblast-whitepaper.html is missing an inline collateral repair script')
		}

		const runScript = new Function('window', 'document', scriptText)
		runScript(window, window.document)

		const example = window.document.getElementById('collateral-repair-example')
		if (example === null) {
			throw new Error('docs/statoblast-whitepaper.html is missing #collateral-repair-example')
		}

		const output = (name: string) => {
			const element = example.querySelector(`[data-example-output="${name}"]`)
			if (!(element instanceof window.HTMLOutputElement)) {
				throw new Error(`Missing collateral repair output: ${name}`)
			}
			return element.value
		}

		assertEqual(output('routedCollateral'), '47.50 ETH', 'collateral repair default routed collateral')
		assertEqual(output('initialShortfall'), '2.50 ETH', 'collateral repair default initial shortfall')
		assertEqual(output('remainingShortfall'), '0 ETH', 'collateral repair default remaining shortfall')
		assertEqual(output('repairStatus'), 'full target raised; activates', 'collateral repair default activation behavior')

		const auctionRaisedInput = example.querySelector('[data-example-input="auctionRaised"]')
		if (!(auctionRaisedInput instanceof window.HTMLInputElement)) {
			throw new Error('Missing collateral repair auction-raised input')
		}
		auctionRaisedInput.value = '1'
		auctionRaisedInput.dispatchEvent(new window.Event('input', { bubbles: true }))

		assertEqual(output('remainingShortfall'), '1.50 ETH', 'collateral repair unfilled target')
		assertEqual(output('repairStatus'), 'partial target raised; activates without donation', 'collateral repair weak-demand activation behavior')
	} finally {
		window.close()
	}

	assert.match(html, /actually received 47\.5 ETH through routed,[\s\S]*capped migration transfers/, 'collateral repair prose should match actual routed collateral')
	assert.match(html, />50 ETH<\/span/, 'collateral repair parent collateral default should remain 50 ETH')
	assert.match(html, />47\.5 ETH<\/span/, 'collateral repair routed-collateral default should remain 47.5 ETH')
	assert.match(html, />2\.5 ETH<\/span/, 'collateral repair auction-raised default should remain 2.5 ETH')
	assert.match(html, /activates with the collateral actually migrated and raised[\s\S]*finalizer contribution ETH is rejected/i, 'collateral repair prose should explain value-free activation')
	const plotSpecs = await readFile('docs/charts/diagramSpecs.json', 'utf8')
	assert.match(plotSpecs, /"data-example-text": "repairTarget"[\s\S]{0,500}target 50 ETH/, 'collateral repair Plot mark should retain its live target label')
}

async function checkResolutionEdgeExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/statoblast-whitepaper.html', 'resolution-edge-example')

	try {
		assertEqual(example.output('resolutionResult'), 'None', 'resolution edge example default result')
		assertEqual(example.output('resolutionReason'), 'two or more outcomes still contest the cost', 'resolution edge example default reason')

		example.setInput('invalidBalance', 0)
		example.setInput('yesBalance', 0)
		example.setInput('noBalance', 0)
		example.setInput('runningCost', 1)

		assertEqual(example.output('resolutionResult'), 'Invalid', 'resolution edge example all-zero fallback result')
		assertEqual(example.output('resolutionReason'), 'empty game after cost is non-zero', 'resolution edge example all-zero fallback reason')

		example.setInput('invalidBalance', 4)
		example.setInput('yesBalance', 5)
		example.setInput('noBalance', 5)
		example.setInput('runningCost', 6)

		assertEqual(example.output('resolutionResult'), 'None', 'resolution edge example tied leader below cost result')
		assertEqual(example.output('resolutionReason'), 'synthetic tied leader; valid deposits and preserved non-zero snapshots reject this state', 'resolution edge example tied leader below cost reason')

		example.setInput('invalidBalance', 4)
		example.setInput('yesBalance', 5)
		example.setInput('noBalance', 6)
		example.setInput('runningCost', 7)

		assertEqual(example.output('resolutionResult'), 'No', 'resolution edge example strict No result')
		assertEqual(example.output('resolutionReason'), 'No has a strict lead', 'resolution edge example strict No reason')
	} finally {
		example.close()
	}
}

async function checkEscalationDepositExample(): Promise<void> {
	const filePath = 'docs/statoblast-whitepaper.html'
	const html = await readFile(filePath, 'utf8')
	const staticWindow = new Window({
		url: pathToFileURL(filePath).href,
	})
	try {
		staticWindow.document.write(html)
		staticWindow.document.close()
		const staticExample = staticWindow.document.getElementById('escalation-deposit-example')
		assert.ok(staticExample, 'escalation deposit static fallback must exist')
		const staticInputValue = (name: string) => staticExample.querySelector(`[data-example-input="${name}"]`)?.getAttribute('value')
		const staticOutput = (name: string) => staticExample.querySelector(`[data-example-output="${name}"]`)?.textContent.trim()
		const staticPlotMount = staticExample.querySelector('[data-plot-chart="plot-statoblast-whitepaper-7"]')
		assert.ok(staticPlotMount, 'escalation static fallback should retain its Plot mount')
		assert.equal(staticPlotMount.getAttribute('role'), 'img', 'escalation static fallback Plot mount should identify itself as an image')
		assert.equal(staticPlotMount.getAttribute('aria-label'), 'Escalation deposit accepted amount', 'escalation static fallback Plot mount should retain its accessible label')
		assert.equal(staticPlotMount.querySelector('.plot-chart-fallback')?.textContent.trim(), 'Escalation deposit accepted amount', 'escalation static fallback Plot mount should retain readable no-JavaScript content')
		assert.equal(staticInputValue('depositLifecycle'), '0', 'escalation static fallback should begin in first-deposit mode')
		for (const balanceName of ['invalidBalance', 'yesBalance', 'noBalance']) {
			assert.equal(staticInputValue(balanceName), '0', `escalation static fallback ${balanceName} should begin at zero`)
		}
		assert.equal(staticOutput('remainingRoom'), '10 REP', 'escalation static fallback remaining room')
		assert.equal(staticOutput('effectiveStartBond'), '2 REP', 'escalation static fallback effective bond')
		assert.equal(staticOutput('acceptedAmount'), '5 REP', 'escalation static fallback accepted amount')
		assert.equal(staticOutput('depositAdjustment'), 'accepted as proposed', 'escalation static fallback adjustment')
		assert.equal(staticOutput('depositCondition'), 'No ends at 5 REP', 'escalation static fallback condition')
	} finally {
		staticWindow.close()
	}

	const example = await loadInteractiveExample(filePath, 'escalation-deposit-example')

	try {
		example.setInput('depositLifecycle', 1)
		example.setInput('invalidBalance', 4)
		example.setInput('depositLifecycle', 0)
		assert.equal(example.valueFor('depositLifecycle'), 'First deposit (factory creates game)', 'first-deposit lifecycle value')
		assert.equal(example.textFor('startBondLabel'), 'Configured start bond', 'first-deposit bond label')
		assert.equal(example.textFor('thresholdInputLabel'), 'Live non-decision threshold', 'first-deposit threshold label')
		assert.equal(example.labelFor('effectiveStartBond'), 'Effective start bond', 'first-deposit output label')
		for (const balanceName of ['invalidBalance', 'yesBalance', 'noBalance']) {
			assert.deepEqual(example.inputState(balanceName), { disabled: true, value: '0' }, `first-deposit ${balanceName} should be disabled and reset`)
		}
		example.setInput('proposedDeposit', 10)
		example.setInput('startBond', 10)
		example.setInput('nonDecisionThreshold', 10)

		assertEqual(example.output('effectiveStartBond'), '9.999999999999999999 REP', 'equal configured bond should normalize by one atomic REP unit')
		assertEqual(example.output('acceptedAmount'), '10 REP', 'equal configured bond should leave a threshold-reaching deposit valid')
		assertEqual(example.output('depositCondition'), 'No reaches threshold', 'equal configured bond should not make setup revert')

		example.setInput('proposedDeposit', 5)
		example.setInput('nonDecisionThreshold', 5)

		assertEqual(example.output('effectiveStartBond'), '4.999999999999999999 REP', 'above-threshold configured bond should normalize by one atomic REP unit')
		assertEqual(example.output('acceptedAmount'), '5 REP', 'above-threshold configured bond should use the normalized live bond')
		assertEqual(example.output('depositCondition'), 'No reaches threshold', 'above-threshold configured bond should not make setup revert')

		example.setInput('depositLifecycle', 1)
		assert.equal(example.valueFor('depositLifecycle'), 'Repeat deposit (existing game)', 'repeat-deposit lifecycle value')
		assert.equal(example.textFor('startBondLabel'), 'Stored game start bond', 'repeat-deposit bond label')
		assert.equal(example.textFor('thresholdInputLabel'), 'Stored game non-decision threshold', 'repeat-deposit threshold label')
		assert.equal(example.labelFor('effectiveStartBond'), 'Stored start bond used', 'repeat-deposit output label')
		example.setInput('startBond', 2)
		example.setInput('nonDecisionThreshold', 10)
		example.setInput('proposedDeposit', 2)

		assertEqual(example.output('effectiveStartBond'), '2 REP', 'repeat deposit should preserve the stored game bond')
		assertEqual(example.output('acceptedAmount'), '2 REP', 'repeat deposit should preview against stored game parameters')
		assertEqual(example.output('depositCondition'), 'No ends at 2 REP', 'repeat deposit should retain an unresolved stored game')

		example.setInput('startBond', 10)
		assertEqual(example.output('acceptedAmount'), 'preview reverts', 'invalid stored game parameters should reject preview')
		assertEqual(example.output('depositAdjustment'), 'Not evaluated', 'invalid stored game parameters should not be described as a deposit adjustment')
		assertEqual(example.output('depositCondition'), 'operation reverts: existing game parameters are invalid', 'invalid stored parameters should not display an accepted deposit')

		example.setInput('startBond', 2)
		example.setInput('invalidBalance', 10)
		example.setInput('yesBalance', 10)

		assertEqual(example.output('acceptedAmount'), 'preview reverts', 'an already reached non-decision state should reject preview')
		assertEqual(example.output('depositAdjustment'), 'Not evaluated', 'a non-decision lock should not be described as a deposit adjustment')
		assertEqual(example.output('depositCondition'), 'operation reverts: non-decision already reached', 'non-decision state should not display an accepted deposit')
	} finally {
		example.close()
	}

	assert.doesNotMatch(html, /game setup reverts: Threshold too low/, 'escalation example should not retain the pre-normalization setup failure')
}

async function checkDynamicWethReportExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/open-oracle-integration.html', 'initial-report-estimator-example')

	try {
		assertEqual(example.output('initialReportEscalationHalt'), '32.307692307692307700 WETH', 'dynamic report default initial-derived escalation halt')
		assertEqual(example.output('openInterestEscalationHalt'), '1.000000000000000000 WETH', 'dynamic report default open-interest escalation halt floor')
		assertEqual(example.output('estimatedMinimumWethReport'), '3.230769230769230770 WETH', 'dynamic report default minimum WETH')
		assertEqual(example.output('selectedInitialWethReport'), '3.230769230769230770 WETH', 'dynamic report default selected WETH')
		assertEqual(example.output('selectedEscalationHalt'), '32.307692307692307700 WETH', 'dynamic report default escalation halt')
		assertEqual(example.output('disputeGasCost'), '0.012000 ETH', 'dynamic report default dispute gas cost')
		assertEqual(example.output('bufferedGasCost'), '0.120000 ETH', 'dynamic report default buffered gas cost')
		assertEqual(example.output('correctionProfitFraction'), '3.7143%', 'dynamic report default correction profit fraction')
		assertEqual(example.output('estimatorSafetyState'), 'fees below target error', 'dynamic report default safety state')

		example.setInput('initialReportPriorityFeeGwei', 1)
		assertEqual(example.output('estimatedMinimumWethReport'), '2.503846153846153847 WETH', 'lower priority assumption should reduce only the additive priority report')
		assertEqual(example.output('selectedEscalationHalt'), '25.038461538461538470 WETH', 'lower priority assumption should reduce the initial-derived escalation halt')

		example.setInput('initialReportPriorityFeeGwei', 100)
		assertEqual(example.output('estimatedMinimumWethReport'), '10.500000000000000001 WETH', 'higher priority assumption should increase the additive priority report')
		assertEqual(example.output('selectedEscalationHalt'), '105.000000000000000010 WETH', 'higher priority assumption should increase the initial-derived escalation halt')

		example.setInput('initialReportPriorityFeeGwei', 10)
		example.setInput('blockBaseFeeGwei', 60)
		assertEqual(example.output('estimatedMinimumWethReport'), '5.653846153846153847 WETH', 'dynamic report minimum should add priority security to the base-fee report')

		example.setInput('requestedInitialWeth', 6)
		assertEqual(example.output('estimatedMinimumWethReport'), '5.653846153846153847 WETH', 'caller-selected WETH should not change the computed minimum')
		assertEqual(example.output('selectedInitialWethReport'), '6.000000000000000000 WETH', 'caller can select WETH above the computed minimum')
		assertEqual(example.output('selectedEscalationHalt'), '60.000000000000000000 WETH', 'escalation halt should scale from selected initial WETH')

		example.setInput('blockBaseFeeGwei', 0)
		example.setInput('openInterestWeth', 0)
		example.setInput('requestedInitialWeth', 0)
		assertEqual(example.output('estimatedMinimumWethReport'), '0.807692307692307693 WETH', 'zero base fee should retain the configured priority security')

		example.setInput('blockBaseFeeGwei', 30)
		example.setInput('openInterestWeth', 10000)
		assertEqual(example.output('openInterestEscalationHalt'), '100.000000000000000000 WETH', 'one percent of open interest should set the open-interest halt floor')
		assertEqual(example.output('estimatedMinimumWethReport'), '100.807692307692307693 WETH', 'initial report should add priority security to the larger open-interest component')
		assertEqual(example.output('selectedEscalationHalt'), '1008.076923076923076930 WETH', 'priority plus open-interest initial report should determine the larger escalation halt')

		example.setInput('openOracleProtocolFee', 5)
		example.setInput('openOracleReporterFee', 2)
		assertEqual(example.output('estimatedMinimumWethReport'), 'unsafe: fees meet or exceed target error', 'fees at or above the target error should be rejected')
		assertEqual(example.output('selectedInitialWethReport'), 'unsafe: fees meet or exceed target error', 'unsafe fees should prevent selecting an initial report')
		assertEqual(example.output('estimatorSafetyState'), 'unsafe: fees meet or exceed target error', 'unsafe fee configuration should be explicit')
	} finally {
		example.close()
	}
}

function checkExactRepCapEquality(): void {
	const precision = 10n ** 18n
	const ethAtTick = 1n * precision
	const priceAtTick = precision / 10n
	const repDemand = (ethAtTick * precision) / priceAtTick
	const maxRepBeingSold = 10n * precision
	assert.ok(repDemand >= maxRepBeingSold, 'demand exactly equal to the REP cap should select funded clearing')
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function blockWithId(html: string, id: string): string {
	const start = html.indexOf(`id="${id}"`)
	assert.notEqual(start, -1, `Missing documentation block #${id}`)
	const end = html.indexOf('</div>', start)
	assert.notEqual(end, -1, `Documentation block #${id} has no closing div`)
	return html.slice(start, end)
}

const scenarios: AuctionExampleScenario[] = [
	{
		defaultBindingCondition: 'both caps',
		defaultAliceReceives: '1 REP',
		defaultBobReceives: '1.33 REP',
		defaultCarolReceives: '1.67 REP',
		filePath: 'docs/truth-auction.html',
		exampleId: 'simple-auction-example',
		underfundedAliceReceives: '4 REP',
	},
]

for (const scenario of scenarios) {
	await checkDefaultFundedClearing(scenario)
	await checkExplicitEthCapScenario(scenario)
	await checkUnderfundedPath(scenario)
	await checkAllZeroBids(scenario)
}

await checkSourceLabelsAndThresholdText('docs/truth-auction.html', [
	'write("clearingMode", "underfunded qualification clearing")',
	'write("bindingCondition", "underfunded")',
	'write("thresholdInputEth", formatEth(winningEth))',
	'const threshold = ethRaiseCap / repInventory',
	'bid.price >= threshold',
	'repResults[bid.key] = (bid.eth * repInventory) / winningEth',
	'accumulatedEth = winningEth',
])

await checkCollateralRepairExample()
await checkEscalationDepositExample()
await checkResolutionEdgeExample()
await checkDynamicWethReportExample()
await checkDeploymentMappingStates()
await checkDeploymentLinkedScenarioRace()
await checkMmrProofPlannerStates()
checkDiagramControlStates()
await checkInteractiveToolControls()
await checkInvariantExplorerStates()
await checkReaderRuntimeStates()
await checkLiquidationMultiplierBoundaries()
checkExactRepCapEquality()

const openOracleHtml = await readFile('docs/open-oracle-integration.html', 'utf8')
assert.doesNotMatch(blockWithId(openOracleHtml, 'eq-openoracle-initial-report-size'), /<mi>(?:R|P|e|E|Q|N|D|T|H|m|u|F)<\/mi>/, 'dynamic report equation should use descriptive domain names instead of one-letter identifiers')
assert.doesNotMatch(openOracleHtml, /259\.332023575638507216 REP/, 'OpenOracle integration should not retain the removed fixed REP report')
assert.match(openOracleHtml, /WETH as <code>token1<\/code> and\s+REP as <code>token2<\/code>/, 'OpenOracle integration should document WETH as the exact token-one side')

const auctionDesignHtml = await readFile('docs/truth-auction.html', 'utf8')
assert.doesNotMatch(auctionDesignHtml, /buy only the REP they demanded/i, 'auction design should not describe underfunded fills as per-tick demand')
assert.match(auctionDesignHtml, /complete REP sale cap[\s\S]*one effective price/i, 'auction design should explain complete weak-demand REP allocation')
assert.match(auctionDesignHtml, /only bids at or above\s+the cap-implied qualification threshold/i, 'auction design should make threshold qualification explicit')
assert.doesNotMatch(auctionDesignHtml, /max-uint sentinel/i, 'auction design should not describe the removed no-bid threshold sentinel')
assert.match(auctionDesignHtml, /every bid refunds/i, 'auction design should document the no-qualifying-bid refund branch')
assert.match(auctionDesignHtml, /stores the lowest tick whose price reaches that\s+qualification threshold as <code>clearingTick<\/code>/i, 'canonical clearing copy should describe rounding the cap-implied threshold to a tick')
assert.match(auctionDesignHtml, /assigns the REP cap by\s+differencing cumulative floor allocations at fixed bid positions/i, 'canonical clearing copy should describe deterministic cumulative floor allocation')
assert.doesNotMatch(auctionDesignHtml, /carries\s+remainders during paged withdrawals/i, 'auction design should not describe removed withdrawal-order remainder carry')
assert.doesNotMatch(auctionDesignHtml, /carries division dust|carries division remainders/i, 'auction design should not describe deterministic cumulative allocation as mutable division carry')
assert.doesNotMatch(auctionDesignHtml, /underfundedThreshold = ceil\(underfundedWinningEth \* PRICE_PRECISION \/ maxRepBeingSold\)/i, 'auction design should not derive the reserve from winning ETH')
assert.match(auctionDesignHtml, /data-source="underfundedThreshold = ceil\(ethRaiseCap \* PRICE_PRECISION \/ maxRepBeingSold\)"/i, 'auction design should derive the underfunded qualification threshold from both caps')
assert.match(auctionDesignHtml, /activates with legitimate migration collateral plus retained bid[\s\S]*rejects caller contribution ETH/i, 'auction design should document value-free weak-demand activation')
assert.match(auctionDesignHtml, /forced ETH remains unaccounted surplus/i, 'auction design should exclude forced ETH from child collateral')
assert.match(auctionDesignHtml, /Qualifying bidders collectively purchase[\s\S]*maxRepBeingSold/i, 'auction design should assign the complete REP cap when demand qualifies')
assert.match(auctionDesignHtml, /common effective price[\s\S]*threshold is not an execution-price floor/i, 'auction design should distinguish the reserve boundary from the weak-demand execution price')
assert.doesNotMatch(auctionDesignHtml, /actual execution price|purchased REP by retained ETH at the reserve tick/i, 'auction design should not describe the underfunded eligibility boundary as an execution price')
assert.doesNotMatch(auctionDesignHtml, /Qualifying ETH buys REP at the ceiling tick|tick rounds up[\s\S]*exact integer fills can be slightly lower/i, 'auction worked examples should not attribute proportional REP allocation to the reserve tick price')
assert.match(auctionDesignHtml, /examples below use[\s\S]*formula above gives[\s\S]*floors per-bid allocations in atomic units/i, 'auction worked examples should inherit the canonical branch formula and disclose integer rounding')
assert.match(auctionDesignHtml, /complete\s+unmigrated allowance[\s\S]*Finalization rejects explicit repair contributions/i, 'auction design should document allowance allocation and rejected donations')
assert.match(auctionDesignHtml, /1 \/ 0\.11 ≈ 9\.09 REP[\s\S]*below the <code>10 REP<\/code> cap/i, 'auction design tiny-demand example should remain strictly below the REP cap')

const operatorReferenceMarkdown = await readFile('docs/operator-reference.md', 'utf8')
assert.match(operatorReferenceMarkdown, /parent vault is checkpointed before its allowance is cleared[\s\S]*earned fees remain redeemable[\s\S]*`totalAccruedFees\(\)`/i, 'operator reference should preserve parent fee solvency guardrails during vault migration')
assert.match(operatorReferenceMarkdown, /statoblast-whitepaper\.html#eq-statoblast-fork-migration-proportion[\s\S]*statoblast-whitepaper\.html#eq-statoblast-fork-collateral-ceiling/i, 'operator reference should delegate migration checkpoint and repair derivations to the whitepaper')
assert.doesNotMatch(operatorReferenceMarkdown, /activateForkMode[\s\S]*fork-time checkpoint[\s\S]*collateralAtFork/i, 'operator reference should not duplicate the canonical own-fork checkpoint derivation')
assert.match(operatorReferenceMarkdown, /once every eligible vault checkpoints[\s\S]*no vault can individually claim returns to collateral/i, 'operator reference should document final aggregate-only fee reserve release')
assert.match(operatorReferenceMarkdown, /each claimed auction allowance joins incrementally[\s\S]*delayed claim adds to the pool’s live eligible total/i, 'operator reference should document live incremental fee eligibility for delayed auction claims')
assert.match(operatorReferenceMarkdown, /## Security Pool Guardrails[\s\S]*totalFeesOwedToVaults[\s\S]*totalAccruedFees\(\)[\s\S]*## Share Migration/i, 'operator reference security-pool guardrails should define assigned and aggregate fee accounting')

const contractInteractionReferenceMarkdown = await readFile('docs/contract-interaction-reference.md', 'utf8')
const updateCollateralAmountRow = contractInteractionReferenceMarkdown.split('\n').find(line => line.startsWith('| `updateCollateralAmount()` |'))
if (updateCollateralAmountRow === undefined) {
	throw new Error('contract interaction reference should document updateCollateralAmount()')
}
assert.match(updateCollateralAmountRow, /question end while this pool's universe remains unforked[\s\S]*fork timestamp replaces question end as this pool epoch's cutoff/i, 'contract interaction reference should document the conditional per-pool fee cutoff')
assert.match(updateCollateralAmountRow, /activated child starts a separate fee epoch/i, 'contract interaction reference should distinguish a child fee epoch from its parent cutoff')
assert.doesNotMatch(updateCollateralAmountRow, /earlier question-end or universe-fork clamp/i, 'contract interaction reference should not describe the conditional fee cutoff as a minimum')

const redeemRepRow = contractInteractionReferenceMarkdown.split('\n').find(line => line.startsWith('| `redeemRep(vault)` |'))
if (redeemRepRow === undefined) {
	throw new Error('contract interaction reference should document redeemRep(vault)')
}
assert.match(redeemRepRow, /specified `vault` has no escalation escrow and has redeemable REP/i, 'contract interaction reference should scope the redemption escrow precondition to the specified vault')
assert.doesNotMatch(redeemRepRow, /no escalation escrow remains/i, 'contract interaction reference should not imply that redeemRep requires global escrow clearance')

const statoblastHtml = await readFile('docs/statoblast-whitepaper.html', 'utf8')
for (const bindMatch of statoblastHtml.matchAll(/bindExample\("([^"]+)"/g)) {
	const exampleId = bindMatch[1]
	if (exampleId === undefined) {
		throw new Error('whitepaper bindExample target should be defined')
	}
	assert.ok(statoblastHtml.includes(`id="${exampleId}"`), `whitepaper bindExample target should exist: ${exampleId}`)
}
const chartRuntimeSource = await readFile('docs/charts/chartRuntime.ts', 'utf8')
const diagramSpecsSource = await readFile('docs/charts/diagramSpecs.json', 'utf8')
assert.match(chartRuntimeSource, /Array\.from\(\{ length: 61 \}/, 'whitepaper escalation Plot should sample the normalized curve densely')
const escalationCurve = Array.from({ length: 61 }, (_, index) => {
	const elapsed = index / 60
	return normalizedEscalationCost(elapsed)
})
assert.equal(escalationCurve[0], Math.exp(-2.4), 'whitepaper escalation Plot should start at the normalized starting bond')
assert.equal(escalationCurve[escalationCurve.length - 1], 1, 'whitepaper escalation Plot should end at the normalized non-decision threshold')
assert.match(diagramSpecsSource, /normalizedCost\(t\) = exp\(2\.4 \* \(t - 1\)\)/, 'whitepaper escalation chart specification should declare the same normalized exponential formula as the runtime model')
assert.doesNotMatch(chartRuntimeSource, /percent:\s*true/, 'normalized escalation coordinates should use percent tick labels without rescaling the curve data')
assert.match(chartRuntimeSource, /tickFormat: \(value: number\) => `\$\{Math\.round\(value \* 100\)\}%`/, 'whitepaper escalation Plot should format normalized coordinates as percentages')
for (let index = 1; index < escalationCurve.length; index += 1) {
	const previous = escalationCurve[index - 1]
	const current = escalationCurve[index]
	if (previous === undefined || current === undefined) {
		throw new Error('whitepaper escalation Plot samples should be defined')
	}
	assert.ok(current > previous, 'whitepaper escalation Plot should rise monotonically')
}
assert.match(chartRuntimeSource, /barX\(balances/, 'quantitative escalation examples should use native Plot bars')
assert.match(chartRuntimeSource, /plot-statoblast-whitepaper-7[\s\S]*escalationDepositChart/, 'escalation deposit chart should use its native Plot renderer')
assert.match(chartRuntimeSource, /plot-statoblast-whitepaper-8[\s\S]*resolutionChart/, 'resolution chart should use its native Plot renderer')
assert.match(chartRuntimeSource, /plot-statoblast-whitepaper-19[\s\S]*collateralRepairChart/, 'collateral repair chart should use its native Plot renderer')
assert.match(chartRuntimeSource, /x1: model\.received, x2: model\.received \+ model\.repairEth/, 'collateral repair Plot should append auction repair after migration-routed collateral')
assert.match(chartRuntimeSource, /■ Migration-routed[\s\S]*■ Auction repair/, 'collateral repair Plot should visibly map both segment colors')
const zeroUtilizationFee = calculateAnnualizedRetentionFeePercent(0)
const dipUtilizationFee = calculateAnnualizedRetentionFeePercent(80)
assert.ok(zeroUtilizationFee > 9 && zeroUtilizationFee < 11, 'retention Plot should annualize the maximum retention rate to roughly ten percent fees')
assert.ok(dipUtilizationFee > 49 && dipUtilizationFee < 51, 'retention Plot should annualize the minimum retention rate to roughly fifty percent fees')
assert.equal(calculateAnnualizedRetentionFeePercent(100), dipUtilizationFee, 'retention Plot should stay at its minimum retention rate above the eighty-percent dip')
assert.match(chartRuntimeSource, /fig-statoblast-retention-utilization[\s\S]*retentionUtilizationChart/, 'retention chart should use its native Plot renderer')
const forkThresholdSeries = calculateForkThresholdSeries(21)
assert.equal(forkThresholdSeries.length, 21, 'fork-threshold Plot should include genesis plus twenty descendants')
assert.deepEqual(forkThresholdSeries[0], { forkThreshold: 5, generation: 0, theoreticalSupply: 100 }, 'fork-threshold Plot should begin from the genesis theoretical supply and five-percent threshold')
assert.ok((forkThresholdSeries[20]?.theoreticalSupply ?? 0) < (forkThresholdSeries[19]?.theoreticalSupply ?? 0), 'fork-threshold Plot should decay monotonically by generation')
assert.equal(forkThresholdSeries[20]?.forkThreshold, (forkThresholdSeries[20]?.theoreticalSupply ?? 0) / 20, 'fork-threshold Plot should keep the threshold at five percent of theoretical supply')
assert.deepEqual(calculateLiquidationHealth(1000n, 75n, 20_000n, 4n), { currentRequiredRep: 600, currentRequiredRepDisplay: '600', state: 'safe', thresholdPrice: 1000 / 150 }, 'liquidation Plot should identify a safely backed vault')
assert.deepEqual(calculateLiquidationHealth(1000n, 50n, 20_000n, 10n), { currentRequiredRep: 1000, currentRequiredRepDisplay: '1000', state: 'safe', thresholdPrice: 10 }, 'liquidation Plot should keep exact threshold equality safe')
assert.equal(calculateLiquidationHealth(1000n, 50n, 20_000n, 11n).state, 'liquidatable', 'liquidation Plot should become liquidatable immediately above the threshold')
for (const [multiplierInput, expectedState, expectedRequiredRep] of [
	['1.0999', 'safe', '109.99'],
	['1.1000', 'safe', '110'],
	['1.1001', 'liquidatable', '110.01'],
] as const) {
	const multiplierBps = parseLiquidationMultiplierBps(multiplierInput)
	assert.notEqual(multiplierBps, undefined, `liquidation Plot should parse ${multiplierInput}x as BPS`)
	if (multiplierBps === undefined) throw new Error(`Missing parsed multiplier for ${multiplierInput}`)
	const model = calculateLiquidationHealth(110n, 25n, multiplierBps, 4n)
	assert.equal(model.state, expectedState, `liquidation Plot should classify the ${multiplierInput}x fractional boundary exactly`)
	assert.equal(model.currentRequiredRepDisplay, expectedRequiredRep, `liquidation Plot should preserve the ${multiplierInput}x required REP precision`)
	assert.match(describeLiquidationHealth('Liquidation threshold curve.', 110n, model), new RegExp(`required backing is ${expectedRequiredRep.replace('.', '\\.')} REP against 110 unlocked REP, so the vault is ${expectedState}`), `liquidation Plot accessible description should preserve the ${multiplierInput}x boundary`)
}
assert.deepEqual(calculateLiquidationHealth(1000n, 75n, 20_000n, 10n), { currentRequiredRep: 1500, currentRequiredRepDisplay: '1500', state: 'liquidatable', thresholdPrice: 1000 / 150 }, 'liquidation Plot should identify a vault above its price threshold')
assert.equal(calculateLiquidationHealth(1000n, 0n, 20_000n, 10n).thresholdPrice, Number.POSITIVE_INFINITY, 'liquidation Plot should have no finite threshold without allowance')

const defaultAuction = calculateAuctionModel(12, 4, [
	{ eth: 3, key: 'alice', name: 'Alice', price: 5 },
	{ eth: 4, key: 'bob', name: 'Bob', price: 4 },
	{ eth: 6, key: 'carol', name: 'Carol', price: 3 },
])
assert.deepEqual(
	defaultAuction.demandPoints,
	[
		{ cumulativeRep: 0.6, price: 5 },
		{ cumulativeRep: 1.75, price: 4 },
		{ cumulativeRep: 4, price: 3 },
	],
	'auction Plot demand points should reprice cumulative accepted ETH at every candidate tick and clip at the ETH cap',
)

const belowQualificationAuction = calculateAuctionModel(20, 5, [
	{ eth: 0, key: 'alice', name: 'Alice', price: 5 },
	{ eth: 0, key: 'bob', name: 'Bob', price: 4 },
	{ eth: 20, key: 'carol', name: 'Carol', price: 3 },
])
assert.equal(belowQualificationAuction.mode, 'underfunded', 'below-qualification demand must not establish uniform clearing')
assert.equal(belowQualificationAuction.ethRaised, 0, 'below-qualification demand should be fully refunded')
assert.equal(belowQualificationAuction.clearingPrice, 4, 'no-winner underfunded chart should retain the cap-implied qualification boundary')
assert.equal(belowQualificationAuction.effectivePrice, 0, 'no-winner underfunded chart should not claim an allocation price')
assert.ok(
	belowQualificationAuction.bids.every(bid => bid.status === 'Rejected'),
	'below-qualification bids should be rejected',
)

const qualifyingWeakDemandAuction = calculateAuctionModel(20, 5, [
	{ eth: 5, key: 'alice', name: 'Alice', price: 5 },
	{ eth: 0, key: 'bob', name: 'Bob', price: 4 },
	{ eth: 0, key: 'carol', name: 'Carol', price: 3 },
])
assert.equal(qualifyingWeakDemandAuction.clearingPrice, 4, 'qualifying weak demand should still plot the cap-implied qualification boundary')
assert.equal(qualifyingWeakDemandAuction.effectivePrice, 1, 'qualifying weak demand should expose its separate proportional-allocation price')

const maximumQualificationAuction = calculateAuctionModel(30, 1, [
	{ eth: 5, key: 'alice', name: 'Alice', price: 5 },
	{ eth: 4, key: 'bob', name: 'Bob', price: 4 },
	{ eth: 5, key: 'carol', name: 'Carol', price: 3 },
])
assert.equal(maximumQualificationAuction.clearingPrice, 30, 'maximum controls should retain the visible qualification boundary')
assert.match(chartRuntimeSource, /const yMax = Math\.max\(5\.8, clearingPrice \* 1\.16/, 'auction Plot y domain should expand to include reachable qualification boundaries')

const sameTickAuction = calculateAuctionModel(8, 2, [
	{ eth: 6, key: 'alice', name: 'Alice', price: 4 },
	{ eth: 6, key: 'bob', name: 'Bob', price: 4 },
	{ eth: 0, key: 'carol', name: 'Carol', price: 3 },
])
assert.equal(sameTickAuction.bids[0]?.rep, 1.5, 'the first bid at a partially filled clearing tick should settle FIFO')
assert.equal(sameTickAuction.bids[1]?.rep, 0.5, 'the second bid at a partially filled clearing tick should receive the FIFO remainder')

assert.deepEqual(calculateCollateralRepairModel(50, 47.5, 1), {
	initialShortfall: 2.5,
	received: 47.5,
	remainingShortfall: 1.5,
	repairEth: 1,
})
assert.deepEqual(calculateCollateralRepairModel(50, 47.5, 10), {
	initialShortfall: 2.5,
	received: 47.5,
	remainingShortfall: 0,
	repairEth: 2.5,
})

const executableOracle = calculateOracleSecurityModel({
	censorshipDuration: 24,
	externalPayoff: 1000,
	honestDisputeBarrierFraction: 0.01,
	honestPrice: 100,
	liquidationThresholdPrice: 101,
	manipulatedPrice: 113,
	minLiquidationPriceDistanceBps: 1000,
	oracleReportLiquidity: 4000,
	targetGriefRatio: 1,
})
assert.equal(executableOracle.liquidationExecutable, true, 'default oracle chart scenario should be executable')
assert.equal(executableOracle.attackerProfit, 1000, 'executable oracle attack should retain the external payoff')
assert.equal(executableOracle.griefTarget, 2000, 'oracle chart should include payoff plus target grief cost')
const nonExecutableOracle = calculateOracleSecurityModel({
	censorshipDuration: 0,
	externalPayoff: 1000,
	honestDisputeBarrierFraction: 0.01,
	honestPrice: 100,
	liquidationThresholdPrice: 120,
	manipulatedPrice: 100,
	minLiquidationPriceDistanceBps: 1000,
	oracleReportLiquidity: 4000,
	targetGriefRatio: 1,
})
assert.equal(nonExecutableOracle.liquidationExecutable, false, 'equal honest and manipulated prices should not execute liquidation')
assert.equal(nonExecutableOracle.attackerProfit, 0, 'non-executable liquidation should expose zero attacker payoff')
assert.equal(nonExecutableOracle.censorshipCost, 0, 'zero-duration censorship should cost zero')
assert.doesNotMatch(chartRuntimeSource, /value: model\.(?:attackerProfit|griefTarget) \+ maxCost/, 'oracle rule labels should use the exact rule value')

const clippedDeposit = calculateEscalationDepositModel({
	invalidBalance: 1,
	noBalance: 7,
	nonDecisionThreshold: 10,
	proposedDeposit: 5,
	repeatDeposit: true,
	startBond: 2,
	yesBalance: 9,
})
assert.equal(clippedDeposit.accepted, 3, 'deposit chart should clip accepted REP to remaining threshold room')
const tieAdjustedDeposit = calculateEscalationDepositModel({
	invalidBalance: 1,
	noBalance: 7,
	nonDecisionThreshold: 20,
	proposedDeposit: 2,
	repeatDeposit: true,
	startBond: 1,
	yesBalance: 9,
})
assert.equal(tieAdjustedDeposit.acceptedAtomic, 1_999_999_999_999_999_999n, 'deposit chart should preserve the one-wei tie adjustment')
assert.equal(tieAdjustedDeposit.noAfterAtomic, 8_999_999_999_999_999_999n, 'deposit chart should preserve the tie-adjusted post-deposit balance')
const normalizedFirstDeposit = calculateEscalationDepositModel({
	invalidBalance: 0,
	noBalance: 0,
	nonDecisionThreshold: 5,
	proposedDeposit: 5,
	repeatDeposit: false,
	startBond: 10,
	yesBalance: 0,
})
assert.equal(normalizedFirstDeposit.effectiveStartBondAtomic, 4_999_999_999_999_999_999n, 'first-deposit Plot should normalize an over-threshold configured bond down by one atomic REP')
assert.equal(normalizedFirstDeposit.acceptedAtomic, 5_000_000_000_000_000_000n, 'first-deposit Plot should accept a threshold-reaching deposit after bond normalization')
assert.equal(normalizedFirstDeposit.previewReverts, false, 'first-deposit Plot should not apply invalid stored-game parameter rules')
assert.equal(
	calculateEscalationDepositModel({
		invalidBalance: 10,
		noBalance: 0,
		nonDecisionThreshold: 10,
		proposedDeposit: 2,
		repeatDeposit: true,
		startBond: 2,
		yesBalance: 10,
	}).previewReverts,
	true,
	'repeat-deposit Plot should reject a game whose non-decision state was already reached',
)
assert.match(chartRuntimeSource, /const repeatDeposit = readInput\(example, 'depositLifecycle'[\s\S]*const invalidBalance = repeatDeposit/, 'escalation Plot should reset displayed balances in first-deposit mode')
assert.deepEqual(calculateResolutionModel({ invalidBalance: 4, noBalance: 7, runningCost: 5, yesBalance: 6 }), { atCost: 2, result: 'None' }, 'resolution chart should keep two outcomes at cost unresolved')
assert.deepEqual(calculateResolutionModel({ invalidBalance: 0, noBalance: 0, runningCost: 5, yesBalance: 0 }), { atCost: 0, result: 'Invalid' }, 'resolution chart should resolve an empty timed-out game to Invalid')
assert.match(statoblastHtml, /activateForkMode[\s\S]*fork-time checkpoint[\s\S]*collateralAtFork/i, 'whitepaper should own the ordered own-fork collateral checkpoint lifecycle')
assert.match(statoblastHtml, /Truth-auction repair subtracts the child's actual cumulative routed[\s\S]*collateral from that snapshot/i, 'whitepaper should own snapshot-based collateral repair')
const invariantsHtml = await readFile('docs/invariants.html', 'utf8')
const feeVectorPrecision = 10n ** 18n
const feeVectorDecayCandidate = 7n
const feeVectorEligibleAllowance = 3n
const feeVectorIndexNumerator = feeVectorDecayCandidate * feeVectorPrecision + 1n
const feeVectorIndexDelta = feeVectorIndexNumerator / feeVectorEligibleAllowance
const feeVectorIndexRemainderOut = feeVectorIndexNumerator % feeVectorEligibleAllowance
const feeVectorReserveNumerator = feeVectorIndexDelta * feeVectorEligibleAllowance + 5n
const feeVectorReserveCredit = feeVectorReserveNumerator / feeVectorPrecision
const feeVectorGlobalRemainderOut = feeVectorReserveNumerator % feeVectorPrecision
assert.deepEqual(
	{
		collateralOut: 100n - feeVectorReserveCredit,
		feeVectorGlobalRemainderOut,
		feeVectorIndexRemainderOut,
		feeVectorReserveCredit,
	},
	{
		collateralOut: 93n,
		feeVectorGlobalRemainderOut: 4n,
		feeVectorIndexRemainderOut: 2n,
		feeVectorReserveCredit: 7n,
	},
	'fee accrual documentation vector should preserve nonzero index and global remainders while subtracting only whole-wei reserve credit',
)
assert.doesNotMatch(statoblastHtml, /carried remainder across paged withdrawals/i, 'whitepaper auction examples should not describe removed withdrawal-order remainder carry')
assert.doesNotMatch(statoblastHtml, /paged withdrawals carr(?:y|ies) division dust/i, 'whitepaper should describe fixed cumulative-position allocation rather than mutable division carry')
assert.doesNotMatch(statoblastHtml, /(?:collateralDecay|decayCandidate)[^\"]*totalSecurityBondAllowance/i, 'whitepaper fee-index formula should not use total capacity as the accrual denominator')
assert.match(statoblastHtml, /feeEligibleSecurityBondAllowance/i, 'whitepaper fee-index formula should use assigned fee-eligible allowance')
assert.match(statoblastHtml, /feeEligibleSecurityBondAllowance == 0[\s\S]*feeIndexDelta[\s\S]*reserveCredit[\s\S]*advances the accumulator[\s\S]*prevents unclaimed auction allowance from earning retroactive fees/i, 'whitepaper fee-index section should document the zero-eligible-allowance no-accrual branch')
assert.match(statoblastHtml, /Fee accrual is lazy[\s\S]*global fee index[\s\S]*vault operations checkpoint each vault[\s\S]*explicit remainders/i, 'whitepaper should explain lazy global and per-vault fee checkpointing')
assert.match(statoblastHtml, /Per-vault fractional remainders survive public\s+checkpoints/i, 'whitepaper should document per-vault fractional carry')
assert.match(statoblastHtml, /actualCollateralDelta = min\(requestedCollateralDelta, parentCompleteSetCollateral\)/i, 'whitepaper own-fork collateral formula should reserve accrued parent fees')
assert.match(statoblastHtml, /activateForkMode[\s\S]*universe fork[\s\S]*fork-time checkpoint[\s\S]*collateralAtFork/i, 'whitepaper should document the ordered own-fork collateral checkpoint lifecycle')
assert.match(statoblastHtml, /Both external and[\s\S]*one fixed, fee-exclusive fork[\s\S]*cumulative\s+ceiling accounting[\s\S]*Truth-auction repair subtracts the child's actual cumulative routed\s+collateral/i, 'whitepaper should document exact fixed-snapshot collateral repair')
assert.match(
	statoblastHtml,
	/data-source="migrationRepDenominatorAtFork = ownFork \? vaultRepAtFork : auctionableRepAtFork; provisionalMigratedRepDelta = floor\(parentPoolOwnership \\cdot migrationRepDenominatorAtFork \/ parentPoolOwnershipDenominator\); migratedRepDelta = resultingMigratedPoolOwnership == parentPoolOwnershipDenominator \? migrationRepDenominatorAtFork - priorMigratedRep : provisionalMigratedRepDelta"/i,
	'whitepaper should document the fork-specific migrated REP denominator, provisional Solidity floor, and final full-ownership reconciliation',
)
assert.match(
	statoblastHtml,
	/id="eq-statoblast-fork-migration-proportion"[\s\S]*<mi>provisionalMigratedRepDelta<\/mi>[\s\S]*Unlocked vault migration normally floors[\s\S]*completes the parent ownership denominator[\s\S]*exact remaining REP delta[\s\S]*tracks cumulative migrated parent ownership independently\s+for every child/i,
	'whitepaper visible migration equation, caption, and prose should distinguish provisional per-vault floors from child-specific final REP reconciliation',
)
assert.match(
	statoblastHtml,
	/id="fig-statoblast-proportional-migration"[\s\S]*normally determines a floored migrated REP[\s\S]*completes a child's ownership receives[\s\S]*cumulative routed REP determines child[\s\S]*normally floors each ownership-based REP delta[\s\S]*reconciles every remaining REP unit/i,
	'whitepaper migration figure fallback and caption should distinguish provisional floors from final full-ownership reconciliation',
)
assert.match(
	statoblastHtml,
	/id="eq-statoblast-fork-migration-proportion"[\s\S]*<mi>migratedRepDelta<\/mi>[\s\S]*<mi>migrationRepDenominatorAtFork<\/mi>[\s\S]*<mi>priorMigratedRep<\/mi>[\s\S]*<mi>resultingMigratedPoolOwnership<\/mi>[\s\S]*<mi>parentPoolOwnershipDenominator<\/mi>[\s\S]*<mi>provisionalMigratedRepDelta<\/mi>[\s\S]*<mtext>otherwise<\/mtext>/i,
	'whitepaper visible migration equation should render the final full-ownership reconciliation branch',
)
assert.match(diagramSpecsSource, /"fig-statoblast-proportional-migration"[\s\S]*floor, or final remainder[\s\S]*cumulative routed REP target[\s\S]*cumulative ceiling target/i, 'proportional migration diagram should show provisional REP flooring, final reconciliation, and cumulative collateral routing')
assert.match(statoblastHtml, /data-source="ethCollateralToBuy = max\(0, parentCollateralAtFork - forkCollateralReceived\)"/i, 'whitepaper should derive the auction repair target from actual routed collateral')
assert.match(statoblastHtml, /cumulative-ceiling transfers[\s\S]*available-collateral cap[\s\S]*nominal migrated REP/i, 'whitepaper should explain exact and capped collateral-repair accounting')
assert.match(
	statoblastHtml,
	/data-source="migrationRepDenominatorAtFork = ownFork \? vaultRepAtFork : auctionableRepAtFork; cumulativeCollateralTargetAfterMigration = ceil\(parentCollateralAtFork \\cdot cumulativeRepTransferredAfterMigration \/ migrationRepDenominatorAtFork\)/i,
	'whitepaper should use the fork-specific denominator in cumulative collateral migration',
)
assert.doesNotMatch(statoblastHtml, /data-source="cumulativeCollateralTargetAfterMigration = ceil\(parentCollateralAtFork \\cdot cumulativeRepTransferredAfterMigration \/ vaultRepAtFork\)/i, 'whitepaper should not present the own-fork denominator as the generalized collateral migration formula')
assert.match(statoblastHtml, /fork-neutral snapshot shared by both paths[\s\S]*ETH raise target[\s\S]*depends on auction demand/i, 'whitepaper should explain shared snapshot accounting and demand-dependent auction repair')
assert.match(statoblastHtml, /After every eligible vault syncs[\s\S]*individually sub-wei vault remainders[\s\S]*returns to complete-set collateral/i, 'whitepaper should document final aggregate-only fee reserve release')
assert.match(statoblastHtml, /Each delayed claim adds only its newly assigned amount[\s\S]*does not reconstruct that total from[\s\S]*allowance changes and[\s\S]*liquidations remain intact/i, 'whitepaper should document incremental live fee eligibility for delayed auction claims')
assert.match(statoblastHtml, /truth-auction\.html#clearing/i, 'whitepaper should route clearing mechanics to the canonical auction design')
assert.doesNotMatch(statoblastHtml, /id="auction-clearing-example"|id="underfunded-auction-example"/i, 'whitepaper should not duplicate canonical auction examples')
assert.doesNotMatch(statoblastHtml, /data-source="[^\"]*underfundedThreshold/i, 'whitepaper should not duplicate the canonical underfunded clearing formula')
assert.doesNotMatch(statoblastHtml, /totalRepPurchased = underfundedWinningEth/i, 'whitepaper should not duplicate canonical underfunded allocation math')
assert.match(statoblastHtml, /value-free finalization activates the child[\s\S]*Nonzero\s+finalizer ETH is rejected/i, 'whitepaper should document bounded value-free settlement')
assert.match(statoblastHtml, /forced[\s\S]*ETH remains unaccounted surplus/i, 'whitepaper should exclude forced ETH from child collateral')
assert.doesNotMatch(statoblastHtml, /retained ETH at the reserve tick/i, 'whitepaper should not describe the eligibility tick as the execution price')
assert.match(invariantsHtml, /AUC-09[\s\S]*Bounded bid settlement[\s\S]*finalizeTruthAuctionRepair/i, 'invariant evidence should point bounded settlement to the delegate guard')
