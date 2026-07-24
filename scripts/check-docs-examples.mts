import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'

type InteractiveExampleHarness = {
	close: () => void
	labelFor: (name: string) => string
	output: (name: string) => string
	setInput: (name: string, value: number) => void
	textPosition: (name: string) => { x: number; y: number }
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

	return {
		close: () => window.close(),
		labelFor,
		output,
		setInput,
		textPosition,
	}
}

async function renderDeploymentMapping(response: DeploymentManifestResponse): Promise<{ busy: string | null; link: string | null; rowCount: number; text: string }> {
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

		const runScript = new Function('document', 'fetch', 'HTMLTableSectionElement', `return (async () => { ${scriptText} })()`)
		await runScript(window.document, async () => response, window.HTMLTableSectionElement)

		const mappingBody = window.document.querySelector('#deployment-status-bit-mapping')
		if (!(mappingBody instanceof window.HTMLTableSectionElement)) {
			throw new Error(`${filePath} is missing its mapping tbody`)
		}
		return {
			busy: mappingBody.getAttribute('aria-busy'),
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
		link: null,
		rowCount: 1,
		text: '0proxyDeployerProxy Deployer',
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

		const targetText = example.querySelector('[data-example-text="repairTarget"]')
		if (!(targetText instanceof window.SVGTextElement)) {
			throw new Error('Missing collateral repair target text')
		}

		assertEqual(output('routedCollateral'), '47.50 ETH', 'collateral repair default routed collateral')
		assertEqual(output('initialShortfall'), '2.50 ETH', 'collateral repair default initial shortfall')
		assertEqual(output('remainingShortfall'), '0 ETH', 'collateral repair default remaining shortfall')
		assertEqual(output('repairStatus'), 'full target raised; activates', 'collateral repair default activation behavior')
		assertEqual(targetText.textContent?.trim() ?? '', 'target 50 ETH', 'collateral repair default target text')

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

async function checkPayoutRegionExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/statoblast-whitepaper.html', 'payout-region-example')

	try {
		assertEqual(example.output('payoutState'), 'reachable ordinary winner state', 'payout region example default state')
		assertEqual(example.output('scaledWithdrawal'), '7 REP', 'payout region example default scaled withdrawal')
		const defaultBindingMarker = example.textPosition('bindingMarker')
		assert.equal(defaultBindingMarker.y, 145)
		assert.ok(Math.abs(defaultBindingMarker.x - (80 + (10 * 600) / 18)) < 1e-9)
		assert.deepEqual(example.textPosition('capMarker'), { x: 580, y: 162 })
		assert.deepEqual(example.textPosition('winningMarker'), { x: 680, y: 179 })

		example.setInput('bindingCapital', 10)
		example.setInput('winningPrincipal', 15)
		assert.deepEqual(example.textPosition('capMarker'), { x: 680, y: 162 })
		assert.deepEqual(example.textPosition('winningMarker'), { x: 680, y: 179 })

		example.setInput('bindingCapital', 20)
		example.setInput('winningPrincipal', 15)
		example.setInput('depositAmount', 5)
		example.setInput('depositStart', 10)
		example.setInput('actualForkThresholdPercent', 100)

		assertEqual(example.output('payoutState'), "not a valid final winner state: binding capital cannot exceed a strict winner's balance", 'payout region example invalid winner state')
		assertEqual(example.output('scaledWithdrawal'), '9 REP', 'payout region example unreachable state still reports computed withdrawal')
	} finally {
		example.close()
	}
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
		filePath: 'docs/auction-design.html',
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

await checkSourceLabelsAndThresholdText('docs/auction-design.html', [
	'write("clearingMode", "underfunded qualification clearing")',
	'write("bindingCondition", "underfunded")',
	'write("thresholdInputEth", formatEth(winningEth))',
	'const threshold = ethRaiseCap / repInventory',
	'bid.price >= threshold',
	'repResults[bid.key] = (bid.eth * repInventory) / winningEth',
	'accumulatedEth = winningEth',
])

await checkCollateralRepairExample()
await checkResolutionEdgeExample()
await checkPayoutRegionExample()
await checkDynamicWethReportExample()
await checkDeploymentMappingStates()
checkExactRepCapEquality()

const openOracleHtml = await readFile('docs/open-oracle-integration.html', 'utf8')
assert.doesNotMatch(blockWithId(openOracleHtml, 'eq-openoracle-initial-report-size'), /<mi>(?:R|P|e|E|Q|N|D|T|H|m|u|F)<\/mi>/, 'dynamic report equation should use descriptive domain names instead of one-letter identifiers')
assert.doesNotMatch(openOracleHtml, /259\.332023575638507216 REP/, 'OpenOracle integration should not retain the removed fixed REP report')
assert.match(openOracleHtml, /WETH as <code>token1<\/code> and\s+REP as <code>token2<\/code>/, 'OpenOracle integration should document WETH as the exact token-one side')

const auctionDesignHtml = await readFile('docs/auction-design.html', 'utf8')
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

const statoblastHtml = await readFile('docs/statoblast-whitepaper.html', 'utf8')
const escalationCurvePath = statoblastHtml.match(/data-source="normalizedCost\(t\) = \(exp\(2\.4 \* t\) - 1\) \/ \(exp\(2\.4\) - 1\)"\s+d="([^"]+)"/)
const escalationCurvePathData = escalationCurvePath?.[1]
if (escalationCurvePathData === undefined) {
	throw new Error('whitepaper escalation chart should expose its normalized exponential sample')
}
const escalationCurveY = [...escalationCurvePathData.matchAll(/[ML] \d+ (\d+)/g)].map(match => Number(match[1]))
assert.ok(escalationCurveY.length >= 5, 'whitepaper escalation chart should contain enough samples to show curvature')
const escalationCurveRises: number[] = []
for (let index = 1; index < escalationCurveY.length; index += 1) {
	const previous = escalationCurveY[index - 1]
	const current = escalationCurveY[index]
	if (previous === undefined || current === undefined) {
		throw new Error('whitepaper escalation chart samples should be defined')
	}
	escalationCurveRises.push(previous - current)
}
for (let index = 1; index < escalationCurveRises.length; index += 1) {
	const previous = escalationCurveRises[index - 1]
	const current = escalationCurveRises[index]
	if (previous === undefined || current === undefined) {
		throw new Error('whitepaper escalation chart rises should be defined')
	}
	assert.ok(current >= previous, 'whitepaper escalation chart should steepen monotonically toward the non-decision threshold')
}
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
assert.match(statoblastHtml, /data-source="decayCandidate = collateralIn - floor\(collateralIn \\cdot rpow\(retentionRate, elapsedTime, pricePrecision\) \/ pricePrecision\)"/i, 'whitepaper should distinguish the fixed-point decay candidate from credited whole-wei fees')
assert.match(statoblastHtml, /collateralOut = collateralIn - reserveCredit/i, 'whitepaper should define stored collateral as input collateral minus whole-wei reserve credit')
assert.match(statoblastHtml, /feeEligibleSecurityBondAllowance == 0[\s\S]*feeIndexDelta[\s\S]*reserveCredit[\s\S]*advances the accumulator[\s\S]*prevents unclaimed auction allowance from earning retroactive fees/i, 'whitepaper fee-index section should document the zero-eligible-allowance no-accrual branch')
assert.match(statoblastHtml, /Unallocated Reserve[\s\S]*Assigned Vault Debt[\s\S]*Vault Payout/i, 'whitepaper fee-flow diagram should show reserve, checkpointed debt, and redemption stages')
assert.match(statoblastHtml, /vaultFeeRemainderOut/i, 'whitepaper fee-index formula should document per-vault fractional carry')
assert.match(statoblastHtml, /actualCollateralDelta = min\(requestedCollateralDelta, parentCompleteSetCollateral\)/i, 'whitepaper own-fork collateral formula should reserve accrued parent fees')
assert.match(statoblastHtml, /activateForkMode[\s\S]*universe fork[\s\S]*fork-time checkpoint[\s\S]*collateralAtFork/i, 'whitepaper should document the ordered own-fork collateral checkpoint lifecycle')
assert.match(statoblastHtml, /Both external and[\s\S]*one fixed, fee-exclusive fork[\s\S]*cumulative\s+ceiling accounting[\s\S]*Truth-auction repair subtracts the child's actual cumulative routed\s+collateral/i, 'whitepaper should document exact fixed-snapshot collateral repair')
assert.match(
	statoblastHtml,
	/data-source="migrationRepDenominatorAtFork = ownFork \? vaultRepAtFork : auctionableRepAtFork; migratedRep = floor\(parentPoolOwnership \\cdot migrationRepDenominatorAtFork \/ parentPoolOwnershipDenominator\)"/i,
	'whitepaper should document the fork-specific migrated REP denominator and Solidity floor',
)
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
assert.match(statoblastHtml, /auction-design\.html#clearing/i, 'whitepaper should route clearing mechanics to the canonical auction design')
assert.doesNotMatch(statoblastHtml, /id="auction-clearing-example"|id="underfunded-auction-example"/i, 'whitepaper should not duplicate canonical auction examples')
assert.doesNotMatch(statoblastHtml, /data-source="[^\"]*underfundedThreshold/i, 'whitepaper should not duplicate the canonical underfunded clearing formula')
assert.doesNotMatch(statoblastHtml, /totalRepPurchased = underfundedWinningEth/i, 'whitepaper should not duplicate canonical underfunded allocation math')
assert.match(statoblastHtml, /value-free finalization activates the child[\s\S]*Nonzero\s+finalizer ETH is rejected/i, 'whitepaper should document bounded value-free settlement')
assert.match(statoblastHtml, /forced[\s\S]*ETH remains unaccounted surplus/i, 'whitepaper should exclude forced ETH from child collateral')
assert.doesNotMatch(statoblastHtml, /retained ETH at the reserve tick/i, 'whitepaper should not describe the eligibility tick as the execution price')
assert.match(invariantsHtml, /AUC-09[\s\S]*Bounded bid settlement[\s\S]*finalizeTruthAuctionRepair/i, 'invariant evidence should point bounded settlement to the delegate guard')
