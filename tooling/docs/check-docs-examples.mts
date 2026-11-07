import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { checkMmrConformanceVector } from './check-docs-worked-examples.mts'

import { Window } from 'happy-dom'
import { computeCanonicalEscalationBindingCapital, computeCanonicalEscalationDeadlineDays, calculateEscalationDepositModel, calculateForkThresholdSeries, calculateResolutionModel, ESCALATION_TIME_LENGTH_SECONDS } from '../../docs/charts/chartModels'
import { getWinningEscalationDepositClaimAmount } from '../../shared/statoblast/ts/escalationGame/escalationMath'
import { centeredDiagramScrollLeft, updateDiagramControl } from '../../docs/charts/diagramControl'

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

	const runtimeName = 'openOracleTools'
	const runtimeSource = await readFile(`docs/assets/js/${runtimeName}.js`, 'utf8')
	const runScript = new Function('document', 'HTMLElement', 'HTMLInputElement', 'HTMLOutputElement', runtimeSource)
	runScript(window.document, window.HTMLElement, window.HTMLInputElement, window.HTMLOutputElement)

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

		const runtimeSource = await readFile('docs/assets/js/deploymentMaskDecoder.js', 'utf8')

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
								{ id: 'reputationToken', label: 'Genesis Reputation Token' },
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
		const runScript = new Function('CustomEvent', 'document', 'fetch', 'HTMLButtonElement', 'HTMLDetailsElement', 'HTMLElement', 'HTMLInputElement', 'HTMLOutputElement', 'HTMLTableCellElement', 'HTMLTableSectionElement', `${runtimeSource}\nreturn deploymentMaskDecoderReady`)
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
		const meter = (name: string) => {
			const card = planner.querySelector(`[data-mmr-output="${name}"]`)?.parentElement
			if (!(card instanceof window.HTMLElement)) throw new Error(`Missing MMR planner meter: ${name}`)
			return card
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
				capacity: '4 leaves; leafIndex 8…11',
				mmrSiblings: '4',
				nullifierSiblings: '64',
				peaks: '0, 2, 3',
				selection: 'Valid in-peak offset',
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
				selection: 'Valid in-peak offset',
			},
			'a one-leaf MMR must have one height-zero peak and no sibling hashes',
		)
		setInput(leafIndex, '1')
		assert.equal(leafIndex.value, '1', 'MMR test harness must update the local leaf index')
		assert.equal(output('selection'), 'Offset must be between 0 and 0', 'a local index equal to peak capacity must be rejected')

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
				selection: 'Valid in-peak offset',
			},
			'a 21-leaf MMR must expose the height-four peak and six total MMR siblings',
		)
		setInput(leafIndex, '16')
		assert.equal(output('selection'), 'Offset must be between 0 and 15', 'the height-four capacity equality boundary must be rejected')

		setInput(leafCount, String((1n << 64n) - 1n))
		selectPeak(63)
		setInput(leafIndex, String((1n << 63n) - 1n))
		assert.equal(peakHeight.options.length, 64, 'the maximum uint64 leaf count must occupy all 64 peaks')
		assert.equal(output('mmrSiblings'), '126', 'the maximum uint64 leaf count at height 63 must require 126 MMR siblings')
		assert.equal(output('peaks'), '0–63', 'consecutive occupied peak heights must stay compact at the uint64 maximum')
		assert.equal(output('selection'), 'Valid in-peak offset', 'the maximum local index below a height-63 peak capacity must be valid')
		assert.equal(peakHeight.classList.contains('visually-hidden-control'), false, 'large occupied-peak sets must use the compact native select')
		assert.equal(peakHeight.tabIndex, 0, 'the large occupied-peak select must remain keyboard accessible')
		assert.equal(window.document.querySelectorAll('.peak-choice-control button').length, 0, 'large occupied-peak sets must not render a button for every height')
		assert.equal(meter('mmrSiblings').style.getPropertyValue('--widget-meter'), '100%', 'the longer 126-sibling MMR proof must fill its comparison meter')
		assert.ok(Math.abs(Number.parseFloat(meter('nullifierSiblings').style.getPropertyValue('--widget-meter')) - (64 / 126) * 100) < 1e-9, 'the fixed 64-sibling nullifier proof must stay proportional to a longer MMR proof')

		for (const invalidLeafCount of ['0', String(1n << 64n)]) {
			setInput(leafCount, invalidLeafCount)
			assert.equal(output('binary'), '—', `${invalidLeafCount} must mark calculated output unavailable without repeating the validation message`)
			assert.equal(output('selection'), '—', `${invalidLeafCount} must clear the prior selection result`)
			assert.equal(output('nullifierSiblings'), '64', 'invalid MMR input must not change the protocol-fixed nullifier depth')
			assert.equal(meter('mmrSiblings').style.getPropertyValue('--widget-meter'), '', `${invalidLeafCount} must clear the stale MMR proof meter`)
			assert.equal(meter('nullifierSiblings').style.getPropertyValue('--widget-meter'), '', `${invalidLeafCount} must clear the comparison meter when the MMR proof is unavailable`)
			assert.equal(leafCount.getAttribute('aria-invalid'), 'true', `${invalidLeafCount} must expose the invalid leaf-count state`)
			assert.equal(peakHeight.disabled, true, `${invalidLeafCount} must disable the occupied-peak selector`)
			assert.equal(peakHeight.options.length, 64, `${invalidLeafCount} must retain the dependent peak choices for layout stability`)
			assert.equal(
				Array.from(window.document.querySelectorAll('.peak-choice-control button')).every(button => button instanceof window.HTMLButtonElement && button.disabled),
				true,
				`${invalidLeafCount} must visibly disable every dependent peak choice`,
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
		assert.equal(output('selection'), 'Valid in-peak offset', 'MMR planning must recover after invalid leaf-count input')
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

function assertEqual(actual: string, expected: string, message: string): void {
	assert.equal(actual, expected, message)
}

async function checkDynamicWethReportExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/reference/open-oracle.html', 'initial-report-estimator-example')

	try {
		assertEqual(example.output('initialReportEscalationHalt'), '32.307692307692307700 WETH', 'dynamic report default initial-derived escalation halt')
		assertEqual(example.output('openInterestEscalationHalt'), '1.000000000000000000 WETH', 'dynamic report default open-interest escalation halt floor')
		assertEqual(example.output('estimatedMinimumWethReport'), '3.230769230769230770 WETH', 'dynamic report default minimum WETH')
		assertEqual(example.output('selectedInitialWethReport'), '3.2308 WETH', 'dynamic report default selected WETH headline')
		assertEqual(example.output('selectedEscalationHalt'), '32.307692307692307700 WETH', 'dynamic report default escalation halt')
		assertEqual(example.output('disputeGasCost'), '0.012000 ETH', 'dynamic report default dispute gas cost')
		assertEqual(example.output('bufferedGasCost'), '0.120000 ETH', 'dynamic report default buffered gas cost')
		assertEqual(example.output('correctionProfitFraction'), '3.7143%', 'dynamic report default correction profit fraction')
		assertEqual(example.output('estimatorSafetyState'), 'fees below target error', 'dynamic report default safety state')

		example.setInput('initialReportPriorityFeeNanoEth', 1)
		assertEqual(example.output('estimatedMinimumWethReport'), '2.503846153846153847 WETH', 'lower priority assumption should reduce only the additive priority report')
		assertEqual(example.output('selectedEscalationHalt'), '25.038461538461538470 WETH', 'lower priority assumption should reduce the initial-derived escalation halt')

		example.setInput('initialReportPriorityFeeNanoEth', 100)
		assertEqual(example.output('estimatedMinimumWethReport'), '10.500000000000000001 WETH', 'higher priority assumption should increase the additive priority report')
		assertEqual(example.output('selectedEscalationHalt'), '105.000000000000000010 WETH', 'higher priority assumption should increase the initial-derived escalation halt')

		example.setInput('initialReportPriorityFeeNanoEth', 10)
		example.setInput('blockBaseFeeNanoEth', 60)
		assertEqual(example.output('estimatedMinimumWethReport'), '5.653846153846153847 WETH', 'dynamic report minimum should add priority security to the base-fee report')

		example.setInput('requestedInitialWeth', 6)
		assertEqual(example.output('estimatedMinimumWethReport'), '5.653846153846153847 WETH', 'caller-selected WETH should not change the computed minimum')
		assertEqual(example.output('selectedInitialWethReport'), '6 WETH', 'caller-selected WETH headline stays compact')
		assertEqual(example.output('selectedEscalationHalt'), '60.000000000000000000 WETH', 'escalation halt should scale from selected initial WETH')

		example.setInput('blockBaseFeeNanoEth', 0)
		example.setInput('aggregateExposureEth', 0)
		example.setInput('requestedInitialWeth', 0)
		assertEqual(example.output('estimatedMinimumWethReport'), '0.807692307692307693 WETH', 'zero base fee should retain the configured priority security')

		example.setInput('blockBaseFeeNanoEth', 30)
		example.setInput('aggregateExposureEth', 10000)
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

function blockWithId(html: string, id: string): string {
	const start = html.indexOf(`id="${id}"`)
	assert.notEqual(start, -1, `Missing documentation block #${id}`)
	const end = html.indexOf('</div>', start)
	assert.notEqual(end, -1, `Documentation block #${id} has no closing div`)
	return html.slice(start, end)
}

await checkDynamicWethReportExample()
await checkMmrProofPlannerStates()
await checkMmrConformanceVector()
checkDiagramControlStates()

const openOracleHtml = await readFile('docs/reference/open-oracle.html', 'utf8')
assert.doesNotMatch(blockWithId(openOracleHtml, 'eq-openoracle-initial-report-size'), /<mi>(?:R|P|e|E|Q|N|D|T|H|m|u|F)<\/mi>/, 'dynamic report equation should use descriptive domain names instead of one-letter identifiers')

const statoblastHtml = await readFile('docs/explanation/statoblast.html', 'utf8')
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
assert.match(chartRuntimeSource, /ticks: spec\.width < 720 \? \[0, 52\] : \[0, 3, 52\]/, 'whitepaper escalation Plot should preserve all milestone ticks on wide screens without colliding day 0 and day 3 on narrow screens')
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
const forkThresholdSeries = calculateForkThresholdSeries(21)
assert.equal(forkThresholdSeries.length, 21, 'fork-threshold Plot should include genesis plus twenty descendants')
assert.deepEqual(forkThresholdSeries[0], { forkThresholdRep: 5, generation: 0, theoreticalSupply: 100 }, 'fork-threshold Plot should begin from the genesis theoretical supply and five-percent threshold')
assert.ok((forkThresholdSeries[20]?.theoreticalSupply ?? 0) < (forkThresholdSeries[19]?.theoreticalSupply ?? 0), 'fork-threshold Plot should decay monotonically by generation')
assert.equal(forkThresholdSeries[20]?.forkThresholdRep, (forkThresholdSeries[20]?.theoreticalSupply ?? 0) / 20, 'fork-threshold Plot should keep the threshold at five percent of theoretical supply')
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
