import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'
import {
	calculateAnnualizedRetentionFeePercent,
	calculateAuctionModel,
	computeCanonicalEscalationBindingCapital,
	computeCanonicalEscalationDeadlineDays,
	calculateCollateralRepairModel,
	calculateEscalationDepositModel,
	calculateForkThresholdSeries,
	calculateResolutionModel,
	ESCALATION_TIME_LENGTH_SECONDS,
} from '../docs/charts/chartModels'
import { getWinningEscalationDepositClaimAmount } from '../shared/ts/escalationMath'
import { centeredDiagramScrollLeft, updateDiagramControl } from '../docs/charts/diagramControl'
import { htmlToDocumentationText } from './docs-html-text.mts'

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
	const filePath = 'docs/reference/deployment-status.html'
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

		const interactiveToolsSource = await readFile('docs/assets/js/interactiveTools.js', 'utf8')
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
		assert.deepEqual(requestedUrls.slice(0, 2).sort(), ['../mainnet-deployment-addresses.json', '../sepolia-deployment-addresses.json'], 'the deployment page must load both canonical network manifests')
		assert.equal(sepoliaMappingBody.getAttribute('aria-busy'), 'false', 'the Sepolia mapping must clear its busy state')
		if (sepoliaResponse === undefined) {
			assert.equal(sepoliaMappingBody.querySelectorAll(':scope > tr').length, 1, 'the Sepolia mapping must render its tracked steps')
			assert.equal(sepoliaMappingBody.textContent.replaceAll(/\s+/g, ' ').trim(), '0wethWrapped Ether', 'the Sepolia mapping must preserve canonical manifest order')
		} else {
			assert.equal(sepoliaMappingBody.querySelectorAll(':scope > tr').length, 1, 'a failed Sepolia load must replace loading with one failure row')
			assert.equal(sepoliaMappingBody.textContent.replaceAll(/\s+/g, ' ').trim(), 'Unable to load the deployment mapping. Open the canonical manifest.', 'a failed Sepolia load must show a visible recovery message')
			assert.equal(sepoliaMappingBody.querySelector('a')?.getAttribute('href'), '../sepolia-deployment-addresses.json', 'a failed Sepolia load must link to its canonical manifest')
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

void renderDeploymentMapping

async function checkMmrProofPlannerStates(): Promise<void> {
	const html = await readFile('docs/reference/merkle-mountain-range.html', 'utf8')
	const source = await readFile('docs/assets/js/mmrProofPlanner.js', 'utf8')
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
		assert.equal(centeredDiagramScrollLeft(330, 1120), 395, 'wide diagrams must open at their horizontal center')
		assert.equal(centeredDiagramScrollLeft(1120, 1120), 0, 'fitted diagrams must keep their initial horizontal position')
		assert.equal(centeredDiagramScrollLeft(1120, 900), 0, 'narrow diagrams must not produce a negative scroll position')
		const button = window.document.createElement('button')
		const cue = window.document.createElement('span')
		button.setAttribute('aria-pressed', 'true')

		updateDiagramControl(button, cue, true)
		assert.equal(button.textContent, 'Exit full screen', 'expanded mode must name the action that returns to the document')
		assert.equal(button.getAttribute('aria-pressed'), null, 'an action-labeled diagram control must not announce a contradictory pressed state')
		assert.equal(button.getAttribute('aria-expanded'), 'true', 'expanded mode must expose its relationship to the full-screen diagram')
		assert.equal(button.getAttribute('aria-label'), 'Exit full-screen diagram', 'expanded mode must expose a complete accessible action name')
		assert.equal(button.getAttribute('title'), 'Exit full-screen diagram', 'expanded mode must expose its action on hover')
		assert.equal(cue.textContent, 'Scroll to inspect detailed labels. Press Escape to close.', 'expanded mode must explain diagram inspection and keyboard exit')

		updateDiagramControl(button, cue, false)
		assert.equal(button.textContent, 'Full screen', 'document mode must keep the visible action concise')
		assert.equal(button.getAttribute('aria-pressed'), null, 'document mode must remain an action button rather than a stateful toggle')
		assert.equal(button.getAttribute('aria-expanded'), 'false', 'document mode must expose that the full-screen diagram is closed')
		assert.equal(button.getAttribute('aria-label'), 'View diagram full screen', 'document mode must expose a complete accessible action name')
		assert.equal(button.getAttribute('title'), 'View diagram full screen', 'document mode must expose its action on hover')
		assert.equal(cue.textContent, 'Use full screen to inspect detailed labels.', 'document mode must explain the available detail control')
	} finally {
		window.close()
	}
}

async function checkInteractiveToolControls(): Promise<void> {
	const linkedState = JSON.stringify({ aliceEth: '9', ethRaiseCap: '23' })
	const window = new Window({
		url: `https://docs.example/truth-auctions.html?tool=simple-auction-example&state=${encodeURIComponent(linkedState)}#simple-auction-example`,
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
			<details class="interactive-example" id="collateral-repair-example">
				<summary>Repair</summary>
				<input data-example-input="auctionRaised" value="1">
				<input data-example-input="forkSettlementCollateralReceived" value="2">
				<input data-example-input="parentSettlementCollateral" value="3">
				<div class="example-output-grid"><output>Default output</output></div>
			</details>
			<details class="interactive-example" id="initial-report-estimator-example">
				<summary>Initial report</summary>
				<input data-example-input="openInterestWeth" value="1">
				<input data-example-input="requestedInitialWeth" value="2">
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
		const source = await readFile('docs/assets/js/interactiveTools.js', 'utf8')
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
		assert.equal(value('ethRaiseCap'), '23', 'a shared scenario must restore every linked input')
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

		for (const presetCase of [
			{ expected: '47.5', input: 'forkSettlementCollateralReceived', presetIndex: '0', toolId: 'collateral-repair-example' },
			{ expected: '50', input: 'parentSettlementCollateral', presetIndex: '0', toolId: 'collateral-repair-example' },
			{ expected: '25', input: 'requestedInitialWeth', presetIndex: '1', toolId: 'initial-report-estimator-example' },
		] as const) {
			const presetTool = window.document.getElementById(presetCase.toolId)
			if (!(presetTool instanceof window.HTMLDetailsElement)) throw new Error(`Missing preset tool: ${presetCase.toolId}`)
			const presetSelect = presetTool.querySelector('.interactive-tool-toolbar select')
			const presetInput = presetTool.querySelector(`[data-example-input="${presetCase.input}"]`)
			if (!(presetSelect instanceof window.HTMLSelectElement) || !(presetInput instanceof window.HTMLInputElement)) throw new Error(`Incomplete preset fixture: ${presetCase.toolId}`)
			presetInput.value = '999'
			assert.notEqual(presetInput.value, presetCase.expected, `${presetCase.input} must begin away from its preset value`)
			presetSelect.value = presetCase.presetIndex
			presetSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
			assert.equal(presetInput.value, presetCase.expected, `${presetCase.input} preset must update its human-unit control`)
		}

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
		const expectedThreshold = scenario.filePath === 'docs/explanation/statoblast.html' ? '7.50 ETH/REP' : '7.5 ETH/REP'
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

async function checkDynamicWethReportExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/explanation/open-oracle.html', 'initial-report-estimator-example')

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
	const maxAttoRepBeingSold = 10n * precision
	assert.ok(repDemand >= maxAttoRepBeingSold, 'demand exactly equal to the REP cap should select funded clearing')
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
		filePath: 'docs/explanation/truth-auctions.html',
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

await checkSourceLabelsAndThresholdText('docs/explanation/truth-auctions.html', [
	'write("clearingMode", "underfunded qualification clearing")',
	'write("bindingCondition", "underfunded")',
	'write("thresholdInputEth", formatEth(winningEthAmount))',
	'const threshold = ethRaiseCap / repInventory',
	'bid.price >= threshold',
	'repResults[bid.key] = (bid.eth * repInventory) / winningEthAmount',
	'accumulatedBidEth = winningEthAmount',
])

await checkDynamicWethReportExample()
await checkMmrProofPlannerStates()
checkDiagramControlStates()
await checkInteractiveToolControls()
checkExactRepCapEquality()

const openOracleHtml = await readFile('docs/explanation/open-oracle.html', 'utf8')
assert.doesNotMatch(blockWithId(openOracleHtml, 'eq-openoracle-initial-report-size'), /<mi>(?:R|P|e|E|Q|N|D|T|H|m|u|F)<\/mi>/, 'dynamic report equation should use descriptive domain names instead of one-letter identifiers')
assert.doesNotMatch(openOracleHtml, /259\.332023575638507216 REP/, 'OpenOracle integration should not retain the removed fixed REP report')
assert.match(openOracleHtml, /WETH as <code>token1<\/code> and\s+REP as <code>token2<\/code>/, 'OpenOracle integration should document WETH as the exact token-one side')

const auctionDesignHtml = await readFile('docs/explanation/truth-auctions.html', 'utf8')
assert.doesNotMatch(auctionDesignHtml, /buy only the REP they demanded/i, 'auction design should not describe underfunded fills as per-tick demand')
assert.match(auctionDesignHtml, /complete REP sale cap[\s\S]*one effective price/i, 'auction design should explain complete weak-demand REP allocation')
assert.match(auctionDesignHtml, /only bids at or above\s+the cap-implied qualification threshold/i, 'auction design should make threshold qualification explicit')
assert.doesNotMatch(auctionDesignHtml, /max-uint sentinel/i, 'auction design should not describe the removed no-bid threshold sentinel')
assert.match(auctionDesignHtml, /every bid refunds/i, 'auction design should document the no-qualifying-bid refund branch')
assert.match(auctionDesignHtml, /stores the lowest tick whose price reaches that\s+qualification threshold as <code>clearingTick<\/code>/i, 'canonical clearing copy should describe rounding the cap-implied threshold to a tick')
assert.match(auctionDesignHtml, /Sold REP is allocated between them proportionally with integer floors/i, 'canonical clearing copy should describe deterministic floor allocation')
assert.match(auctionDesignHtml, /dispute-staked bucket receives <code>⌊repPurchased \* disputeStakedRepBefore \/ combinedRepBefore⌋<\/code>[\s\S]*pool-held bucket receives the complementary remainder/i, 'canonical clearing copy should identify the dispute-staked floor and pool-held remainder')
assert.doesNotMatch(auctionDesignHtml, /carries\s+remainders during paged withdrawals/i, 'auction design should not describe removed withdrawal-order remainder carry')
assert.doesNotMatch(auctionDesignHtml, /carries division dust|carries division remainders/i, 'auction design should not describe deterministic cumulative allocation as mutable division carry')
assert.doesNotMatch(auctionDesignHtml, /underfundedThreshold = ceil\(underfundedWinningAttoEth \* PRICE_PRECISION \/ maxAttoRepBeingSold\)/i, 'auction design should not derive the reserve from winning ETH')
assert.match(auctionDesignHtml, /data-source="underfundedThreshold = ⌈attoEthRaiseCap \* PRICE_PRECISION \/ maxAttoRepBeingSold⌉"/i, 'auction design should derive the underfunded qualification threshold from both caps')
assert.match(auctionDesignHtml, /activates with legitimate migration settlement collateral plus retained bid/i, 'auction design should document value-free weak-demand activation')
assert.match(auctionDesignHtml, /rejects contribution-only ETH/i, 'auction design should reject unaccounted contribution ETH')
assert.match(auctionDesignHtml, /ETH forced into the child does not count toward the repair target/i, 'auction design should exclude forced ETH from child collateral')
assert.match(auctionDesignHtml, /Qualifying bidders collectively purchase[\s\S]*maxAttoRepBeingSold/i, 'auction design should assign the complete REP cap when demand qualifies')
assert.match(auctionDesignHtml, /common effective price[\s\S]*threshold is not an execution-price floor/i, 'auction design should distinguish the reserve boundary from the weak-demand execution price')
assert.doesNotMatch(auctionDesignHtml, /actual execution price|purchased REP by retained ETH at the reserve tick/i, 'auction design should not describe the underfunded eligibility boundary as an execution price')
assert.doesNotMatch(auctionDesignHtml, /Qualifying ETH buys REP at the ceiling tick|tick rounds up[\s\S]*exact integer fills can be slightly lower/i, 'auction worked examples should not attribute proportional REP allocation to the reserve tick price')

const operatorReferenceText = htmlToDocumentationText(await readFile('docs/reference/operator-guardrails.html', 'utf8'))
assert.match(operatorReferenceText, /parent vault is checkpointed before its capacity ownership is cleared[\s\S]*earned fees remain redeemable[\s\S]*`totalAccruedFeesAttoEth\(\)`/i, 'operator reference should preserve parent fee solvency guardrails during vault migration')
assert.match(operatorReferenceText, /statoblast\.html#migration/i, 'operator reference should delegate migration derivations to the whitepaper')
assert.doesNotMatch(operatorReferenceText, /activateForkMode[\s\S]*fork-time checkpoint[\s\S]*settlementCollateralAtForkAttoEth/i, 'operator reference should not duplicate the canonical own-fork checkpoint derivation')
assert.match(operatorReferenceText, /once every eligible vault checkpoints[\s\S]*no vault can individually claim returns to settlement collateral/i, 'operator reference should document final aggregate-only fee reserve release')
assert.match(operatorReferenceText, /each claimed auction capacity ownership joins incrementally[\s\S]*delayed claim adds to the pool’s live eligible total/i, 'operator reference should document live incremental fee eligibility for delayed auction claims')
assert.match(operatorReferenceText, /Security Pool Guardrails[\s\S]*totalClaimableVaultFeesAttoEth[\s\S]*totalAccruedFeesAttoEth\(\)[\s\S]*Share Migration/i, 'operator reference security-pool guardrails should define assigned and aggregate fee accounting')

const contractInteractionReferenceText = htmlToDocumentationText(await readFile('docs/reference/contracts.html', 'utf8'))
const updateSettlementCollateralRow = contractInteractionReferenceText.split('\n').find(line => line.startsWith('`updateSettlementCollateral()`\t'))
if (updateSettlementCollateralRow === undefined) {
	throw new Error('contract interaction reference should document updateSettlementCollateral()')
}
assert.match(updateSettlementCollateralRow, /question end while this pool's universe remains unforked[\s\S]*fork timestamp replaces question end as this pool epoch's cutoff/i, 'contract interaction reference should document the conditional per-pool fee cutoff')
assert.match(updateSettlementCollateralRow, /activated child starts a separate fee epoch/i, 'contract interaction reference should distinguish a child fee epoch from its parent cutoff')
assert.doesNotMatch(updateSettlementCollateralRow, /earlier question-end or universe-fork clamp/i, 'contract interaction reference should not describe the conditional fee cutoff as a minimum')

const redeemRepFromVaultRow = contractInteractionReferenceText.split('\n').find(line => line.startsWith('`redeemRepFromVault(vault)`\t'))
if (redeemRepFromVaultRow === undefined) {
	throw new Error('contract interaction reference should document redeemRepFromVault(vault)')
}
assert.match(redeemRepFromVaultRow, /specified `vault` has no escalation escrow and has redeemable REP/i, 'contract interaction reference should scope the redemption escrow precondition to the specified vault')
assert.doesNotMatch(redeemRepFromVaultRow, /no escalation escrow remains/i, 'contract interaction reference should not imply that redeemRepFromVault requires global escrow clearance')

const statoblastHtml = await readFile('docs/explanation/statoblast.html', 'utf8')
const escalationHtml = await readFile('docs/explanation/escalation-game.html', 'utf8')
assert.match(statoblastHtml, /<details class="interactive-example technical-details" id="collateral-repair-example">[\s\S]*data-plot-chart="plot-statoblast-whitepaper-19"/i, 'collateral repair controls and chart must share the interactive example container')
assert.match(escalationHtml, /configured start bond|fixed-point attrition curve/i, 'escalation explanation should name the configured bond and canonical curve')
assert.match(escalationHtml, /cumulative binding-capital threshold/i, 'escalation explanation should distinguish the cumulative threshold from the deposit minimum')
assert.match(escalationHtml, /deadline moves only when the deposit raises the median outcome balance/i, 'escalation explanation should tie deadline changes to median balance increases')
assert.doesNotMatch(escalationHtml, /requiredEscalationCost|Exponential escalation bond curve/i, 'escalation explanation should not label the cumulative threshold as an individual deposit cost')
for (const bindMatch of statoblastHtml.matchAll(/bindExample\("([^"]+)"/g)) {
	const exampleId = bindMatch[1]
	if (exampleId === undefined) {
		throw new Error('whitepaper bindExample target should be defined')
	}
	assert.ok(statoblastHtml.includes(`id="${exampleId}"`), `whitepaper bindExample target should exist: ${exampleId}`)
}
const chartRuntimeSource = await readFile('docs/charts/chartRuntime.ts', 'utf8')
assert.doesNotMatch(chartRuntimeSource, /normalizedEscalationCost|escalationCostChart|requiredRepFraction/i, 'escalation chart runtime should use cumulative binding-capital terminology')
assert.match(chartRuntimeSource, /ESCALATION_ACTIVATION_DELAY_DAYS \+ ESCALATION_TIME_LENGTH_DAYS \+ 1/, 'escalation Plot should sample every day from game start through day 52')
assert.match(chartRuntimeSource, /ticks: compact \? \[0, 52\] : \[0, 3, 52\]/, 'whitepaper escalation Plot should preserve all milestone ticks on wide screens without colliding day 0 and day 3 on narrow screens')
assert.match(chartRuntimeSource, /label: '● won'[\s\S]*label: '● partial'[\s\S]*label: '● refund'/, 'narrow truth-auction charts should keep a readable non-color status key')
assert.equal(computeCanonicalEscalationBindingCapital(1, 10, 3), 1, 'canonical escalation fixture should start at the configured start bond on activation')
assert.equal(computeCanonicalEscalationBindingCapital(1, 10, 52), 10, 'canonical escalation fixture should end at the configured threshold after seven weeks')
const oneThirdPowerOfTwoTimeDays = Number.parseInt((ESCALATION_TIME_LENGTH_SECONDS / 3n).toString(), 10) / 86_400
assert.equal(computeCanonicalEscalationBindingCapital(1, 8, 3 + oneThirdPowerOfTwoTimeDays), 2, 'canonical escalation fixture should match the contract one-third-time power-of-two ratio')
assert.equal(computeCanonicalEscalationDeadlineDays(1, 8, 2), 3 + oneThirdPowerOfTwoTimeDays, 'canonical deadline fixture should match the contract inverse calculation')
const payoutFixture = 10n ** 18n
assert.equal(
	getWinningEscalationDepositClaimAmount({
		bindingCapitalAttoRep: 10n * payoutFixture,
		cumulativeAmountAttoRep: 15n * payoutFixture,
		depositAmountAttoRep: 5n * payoutFixture,
		forkThresholdAttoRep: 10n * payoutFixture,
		nonDecisionThresholdAttoRep: 10n * payoutFixture,
		winningOutcomeBalanceAttoRep: 15n * payoutFixture,
	}),
	7n * payoutFixture,
	'published payout example should match the shared contract fixture for principal plus bonus',
)
assert.equal(
	getWinningEscalationDepositClaimAmount({
		bindingCapitalAttoRep: 10n * payoutFixture,
		cumulativeAmountAttoRep: 20n * payoutFixture,
		depositAmountAttoRep: 5n * payoutFixture,
		forkThresholdAttoRep: 8n * payoutFixture,
		nonDecisionThresholdAttoRep: 10n * payoutFixture,
		winningOutcomeBalanceAttoRep: 20n * payoutFixture,
	}),
	4n * payoutFixture,
	'fork scaling should reduce even an above-cap principal-only withdrawal',
)
assert.match(escalationHtml, /Principal returned: <code>5 REP<\/code>[\s\S]*Bonus: <code>5 × 6 \/ 15 = 2 REP<\/code>[\s\S]*Winning payout: <code>5 \+ 2 = 7 REP<\/code>/i, 'published payout example should show principal, bonus, and total formulas')
assert.match(chartRuntimeSource, /plot-statoblast-whitepaper-19[\s\S]*collateralRepairChart/, 'collateral repair chart should use its native Plot renderer')
assert.match(chartRuntimeSource, /x1: model\.received, x2: model\.received \+ model\.repairEth/, 'collateral repair Plot should append auction repair after migration-routed collateral')
assert.match(chartRuntimeSource, /domain: \['Migration-routed', 'Auction repair'\]/, 'collateral repair Plot should preserve distinct migration and repair segment colors')
const zeroUtilizationFee = calculateAnnualizedRetentionFeePercent(0)
const dipUtilizationFee = calculateAnnualizedRetentionFeePercent(80)
assert.ok(zeroUtilizationFee > 9 && zeroUtilizationFee < 11, 'retention Plot should annualize the maximum retention rate to roughly ten percent fees')
assert.ok(dipUtilizationFee > 49 && dipUtilizationFee < 51, 'retention Plot should annualize the minimum retention rate to roughly fifty percent fees')
assert.equal(calculateAnnualizedRetentionFeePercent(100), dipUtilizationFee, 'retention Plot should stay at its minimum retention rate above the eighty-percent dip')
assert.match(chartRuntimeSource, /fig-statoblast-retention-utilization[\s\S]*retentionUtilizationChart/, 'retention chart should use its native Plot renderer')
const forkThresholdSeries = calculateForkThresholdSeries(21)
assert.equal(forkThresholdSeries.length, 21, 'fork-threshold Plot should include genesis plus twenty descendants')
assert.deepEqual(forkThresholdSeries[0], { forkThresholdRep: 5, generation: 0, theoreticalSupply: 100 }, 'fork-threshold Plot should begin from the genesis theoretical supply and five-percent threshold')
assert.ok((forkThresholdSeries[20]?.theoreticalSupply ?? 0) < (forkThresholdSeries[19]?.theoreticalSupply ?? 0), 'fork-threshold Plot should decay monotonically by generation')
assert.equal(forkThresholdSeries[20]?.forkThresholdRep, (forkThresholdSeries[20]?.theoreticalSupply ?? 0) / 20, 'fork-threshold Plot should keep the threshold at five percent of theoretical supply')
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
assert.equal(tieAdjustedDeposit.acceptedAttoRep, 1_999_999_999_999_999_999n, 'deposit chart should preserve the one-attoREP tie adjustment')
assert.equal(tieAdjustedDeposit.noAfterAttoRep, 8_999_999_999_999_999_999n, 'deposit chart should preserve the tie-adjusted post-deposit balance')
const normalizedFirstDeposit = calculateEscalationDepositModel({
	invalidBalance: 0,
	noBalance: 0,
	nonDecisionThreshold: 5,
	proposedDeposit: 5,
	repeatDeposit: false,
	startBond: 10,
	yesBalance: 0,
})
assert.equal(normalizedFirstDeposit.effectiveStartBondAttoRep, 4_999_999_999_999_999_999n, 'first-deposit Plot should normalize an over-threshold configured bond down by one attoREP')
assert.equal(normalizedFirstDeposit.acceptedAttoRep, 5_000_000_000_000_000_000n, 'first-deposit Plot should accept a threshold-reaching deposit after bond normalization')
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
assert.deepEqual(calculateResolutionModel({ invalidBalance: 4, noBalance: 7, runningCost: 5, yesBalance: 6 }), { atCost: 2, result: 'None' }, 'resolution chart should keep two outcomes at cost unresolved')
assert.deepEqual(calculateResolutionModel({ invalidBalance: 0, noBalance: 0, runningCost: 5, yesBalance: 0 }), { atCost: 0, result: 'Invalid' }, 'resolution chart should resolve an empty timed-out game to Invalid')
const invariantsHtml = await readFile('docs/reference/invariants.html', 'utf8')
const feeVectorPrecision = 10n ** 18n
const feeVectorDecayCandidate = 7n
const feeVectorEligibleCoverageCommitmentAttoEth = 3n
const feeVectorIndexNumerator = feeVectorDecayCandidate * feeVectorPrecision + 1n
const feeVectorIndexDelta = feeVectorIndexNumerator / feeVectorEligibleCoverageCommitmentAttoEth
const feeVectorIndexRemainderOut = feeVectorIndexNumerator % feeVectorEligibleCoverageCommitmentAttoEth
const feeVectorReserveNumerator = feeVectorIndexDelta * feeVectorEligibleCoverageCommitmentAttoEth + 5n
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
	'fee accrual documentation vector should preserve nonzero index and global remainders while subtracting only whole-attoETH reserve credit',
)
assert.doesNotMatch(statoblastHtml, /carried remainder across paged withdrawals/i, 'whitepaper auction examples should not describe removed withdrawal-order remainder carry')
assert.doesNotMatch(statoblastHtml, /paged withdrawals carr(?:y|ies) division dust/i, 'whitepaper should describe fixed cumulative-position allocation rather than mutable division carry')
assert.doesNotMatch(statoblastHtml, /(?:collateralDecay|decayCandidate)[^\"]*totalCoverageCommitmentAttoEth/i, 'whitepaper fee-index formula should not use total capacity as the accrual denominator')
assert.match(invariantsHtml, /AUC-09[\s\S]*Bounded bid settlement[\s\S]*finalizeTruthAuctionRepair/i, 'invariant evidence should point bounded settlement to the delegate guard')
