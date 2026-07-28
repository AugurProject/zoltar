import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'
import { calculateAnnualizedRetentionFeePercent, calculateAuctionModel, calculateCollateralRepairModel, calculateEscalationDepositModel, calculateForkThresholdSeries, calculateLiquidationHealth, calculateOracleSecurityModel, calculateResolutionModel, normalizedEscalationCost } from '../docs/charts/chartModels'

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
assert.deepEqual(calculateLiquidationHealth(1000, 75, 2, 4), { currentRequiredRep: 600, state: 'safe', thresholdPrice: 1000 / 150 }, 'liquidation Plot should identify a safely backed vault')
assert.deepEqual(calculateLiquidationHealth(1000, 50, 2, 10), { currentRequiredRep: 1000, state: 'safe', thresholdPrice: 10 }, 'liquidation Plot should keep exact threshold equality safe')
assert.equal(calculateLiquidationHealth(1000, 50, 2, 10.01).state, 'liquidatable', 'liquidation Plot should become liquidatable immediately above the threshold')
assert.deepEqual(calculateLiquidationHealth(1000, 75, 2, 10), { currentRequiredRep: 1500, state: 'liquidatable', thresholdPrice: 1000 / 150 }, 'liquidation Plot should identify a vault above its price threshold')
assert.equal(calculateLiquidationHealth(1000, 0, 2, 10).thresholdPrice, Number.POSITIVE_INFINITY, 'liquidation Plot should have no finite threshold without allowance')

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
assert.match(statoblastHtml, /truth-auction\.html#clearing/i, 'whitepaper should route clearing mechanics to the canonical auction design')
assert.doesNotMatch(statoblastHtml, /id="auction-clearing-example"|id="underfunded-auction-example"/i, 'whitepaper should not duplicate canonical auction examples')
assert.doesNotMatch(statoblastHtml, /data-source="[^\"]*underfundedThreshold/i, 'whitepaper should not duplicate the canonical underfunded clearing formula')
assert.doesNotMatch(statoblastHtml, /totalRepPurchased = underfundedWinningEth/i, 'whitepaper should not duplicate canonical underfunded allocation math')
assert.match(statoblastHtml, /value-free finalization activates the child[\s\S]*Nonzero\s+finalizer ETH is rejected/i, 'whitepaper should document bounded value-free settlement')
assert.match(statoblastHtml, /forced[\s\S]*ETH remains unaccounted surplus/i, 'whitepaper should exclude forced ETH from child collateral')
assert.doesNotMatch(statoblastHtml, /retained ETH at the reserve tick/i, 'whitepaper should not describe the eligibility tick as the execution price')
assert.match(invariantsHtml, /AUC-09[\s\S]*Bounded bid settlement[\s\S]*finalizeTruthAuctionRepair/i, 'invariant evidence should point bounded settlement to the delegate guard')
