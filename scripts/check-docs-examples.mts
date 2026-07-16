import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'

type InteractiveExampleHarness = {
	close: () => void
	labelFor: (name: string) => string
	output: (name: string) => string
	setInput: (name: string, value: number) => void
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

	return {
		close: () => window.close(),
		labelFor,
		output,
		setInput,
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

		assertEqual(example.output('clearingMode'), 'underfunded reserve clearing', `${scenario.filePath} underfunded clearing mode`)
		assertEqual(example.output('bindingCondition'), 'underfunded', `${scenario.filePath} underfunded binding condition`)
		assertEqual(example.labelFor('ethRaised'), 'ETH retained', `${scenario.filePath} underfunded ETH retained label`)
		assertEqual(example.output('ethRaised'), '16 ETH', `${scenario.filePath} underfunded retained ETH`)
		assertEqual(example.labelFor('thresholdInputEth'), 'Winning ETH kept', `${scenario.filePath} underfunded threshold label`)
		assertEqual(example.output('thresholdInputEth'), '16 ETH', `${scenario.filePath} underfunded threshold input ETH`)
		assertEqual(example.output('underfundedThreshold'), '5 ETH/REP', `${scenario.filePath} underfunded threshold`)
		assertEqual(example.output('aliceReceives'), scenario.underfundedAliceReceives, `${scenario.filePath} underfunded Alice REP`)
		assertEqual(example.output('bobReceives'), '0 REP', `${scenario.filePath} underfunded Bob REP`)
		assertEqual(example.output('carolReceives'), '0 REP', `${scenario.filePath} underfunded Carol REP`)
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

		assertEqual(example.output('clearingMode'), 'underfunded reserve clearing', `${scenario.filePath} zero-bid clearing mode`)
		assertEqual(example.output('bindingCondition'), 'underfunded', `${scenario.filePath} zero-bid binding condition`)
		assertEqual(example.output('ethRaised'), '0 ETH', `${scenario.filePath} zero-bid retained ETH`)
		assertEqual(example.output('thresholdInputEth'), '0 ETH', `${scenario.filePath} zero-bid threshold input ETH`)
		const expectedThreshold = scenario.filePath === 'docs/placeholder-whitepaper.html' ? '7.50 ETH/REP' : '7.5 ETH/REP'
		assertEqual(example.output('underfundedThreshold'), expectedThreshold, `${scenario.filePath} zero-bid threshold`)
		assertEqual(example.output('aliceReceives'), '0 REP', `${scenario.filePath} zero-bid Alice REP`)
		assertEqual(example.output('bobReceives'), '0 REP', `${scenario.filePath} zero-bid Bob REP`)
		assertEqual(example.output('carolReceives'), '0 REP', `${scenario.filePath} zero-bid Carol REP`)
		assertEqual(example.output('refunds'), '0 ETH', `${scenario.filePath} zero-bid refunds`)
	} finally {
		example.close()
	}
}

async function checkSourceLabelsAndThresholdText(filePath: string, requiredSourceSnippets: string[]): Promise<void> {
	const html = await readFile(filePath, 'utf8')
	assert.match(html, /<span>ETH retained<\/span/, `${filePath} should label retained ETH explicitly`)
	assert.match(html, /<span>Winning ETH kept<\/span/, `${filePath} should label winning ETH kept explicitly`)
	assert.match(html, /<code>&gt;= clearingTick<\/code>/, `${filePath} should describe the underfunded winner boundary with clearingTick`)
	for (const snippet of requiredSourceSnippets) {
		assert.match(html, new RegExp(escapeRegExp(snippet)), `${filePath} is missing expected source snippet: ${snippet}`)
	}
}

async function checkCollateralRepairExample(): Promise<void> {
	const html = await readFile('docs/placeholder-whitepaper.html', 'utf8')
	const window = new Window({
		url: pathToFileURL('docs/placeholder-whitepaper.html').href,
	})
	window.document.write(html)
	window.document.close()

	try {
		const script = window.document.querySelector('script:not([src])')
		const scriptText = script?.textContent
		if (scriptText === undefined || scriptText.trim().length === 0) {
			throw new Error('docs/placeholder-whitepaper.html is missing an inline collateral repair script')
		}

		const runScript = new Function('window', 'document', scriptText)
		runScript(window, window.document)

		const example = window.document.getElementById('collateral-repair-example')
		if (example === null) {
			throw new Error('docs/placeholder-whitepaper.html is missing #collateral-repair-example')
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
		assertEqual(output('repairStatus'), 'no contribution required', 'collateral repair default finalization requirement')
		assertEqual(targetText.textContent?.trim() ?? '', 'target 50 ETH', 'collateral repair default target text')

		const auctionRaisedInput = example.querySelector('[data-example-input="auctionRaised"]')
		if (!(auctionRaisedInput instanceof window.HTMLInputElement)) {
			throw new Error('Missing collateral repair auction-raised input')
		}
		auctionRaisedInput.value = '1'
		auctionRaisedInput.dispatchEvent(new window.Event('input', { bubbles: true }))

		assertEqual(output('remainingShortfall'), '1.50 ETH', 'collateral repair exact finalizer contribution')
		assertEqual(output('repairStatus'), 'exact contribution required', 'collateral repair underfunded finalization requirement')
	} finally {
		window.close()
	}

	assert.match(html, /actually received 47\.5 ETH through routed,[\s\S]*capped migration transfers/, 'collateral repair prose should match actual routed collateral')
	assert.match(html, />50 ETH<\/span/, 'collateral repair parent collateral default should remain 50 ETH')
	assert.match(html, />47\.5 ETH<\/span/, 'collateral repair routed-collateral default should remain 47.5 ETH')
	assert.match(html, />2\.5 ETH<\/span/, 'collateral repair auction-raised default should remain 2.5 ETH')
	assert.match(html, /underpayment or\s+overpayment reverts the entire finalization/i, 'collateral repair prose should explain exact-contribution rollback')
}

async function checkUnderfundedPrefixExample(): Promise<void> {
	const html = await readFile('docs/placeholder-whitepaper.html', 'utf8')
	assert.match(html, /human-unit real-number approximation:[\s\S]*exact\s+wei allocation also depends on <code>ethBefore<\/code>/i, 'underfunded prefix example should distinguish its approximate human-unit output from exact cumulative wei allocation')
	assert.match(html, /Approximate bidder REP fill \(human units\):/, 'underfunded prefix example should label its bidder output as approximate')
	const example = await loadInteractiveExample('docs/placeholder-whitepaper.html', 'underfunded-auction-example')

	try {
		assertEqual(example.output('tickStatus'), 'tick meets the cap-implied reserve', 'underfunded reserve example default status')
		assertEqual(example.output('underfundedThreshold'), '0.2000 ETH/REP', 'underfunded reserve example default threshold')
		assertEqual(example.output('underfundedRepShare'), '20.0000 REP', 'underfunded reserve example default REP share')
		assertEqual(example.output('repAssignedElsewhere'), '30.0000 REP', 'underfunded reserve example default remainder allocation')

		example.setInput('maxRepBeingSold', 4)
		example.setInput('underfundedWinningEth', 8)
		example.setInput('tickPrice', 1)
		example.setInput('bidEth', 3)

		assertEqual(example.output('tickStatus'), 'tick is below the cap-implied reserve', 'underfunded reserve example inconsistent status')
		assertEqual(example.output('underfundedThreshold'), '5.0000 ETH/REP', 'underfunded reserve example inconsistent threshold')
		assertEqual(example.output('underfundedRepShare'), 'not applicable', 'underfunded prefix example inconsistent REP share')
		assertEqual(example.output('repAssignedElsewhere'), 'not applicable', 'underfunded prefix example inconsistent remainder allocation')
	} finally {
		example.close()
	}
}

async function checkResolutionEdgeExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/placeholder-whitepaper.html', 'resolution-edge-example')

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
	const example = await loadInteractiveExample('docs/placeholder-whitepaper.html', 'payout-region-example')

	try {
		assertEqual(example.output('payoutState'), 'reachable ordinary winner state', 'payout region example default state')
		assertEqual(example.output('scaledWithdrawal'), '7 REP', 'payout region example default scaled withdrawal')

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
		assertEqual(example.output('estimatedMinimumWethReport'), '2.423076923076923077 WETH', 'dynamic report default minimum WETH')
		assertEqual(example.output('selectedInitialWethReport'), '2.423076923076923077 WETH', 'dynamic report default selected WETH')
		assertEqual(example.output('selectedEscalationHalt'), '24.230769230769230770 WETH', 'dynamic report default escalation halt')
		assertEqual(example.output('disputeGasCost'), '0.009000 ETH', 'dynamic report default dispute gas cost')
		assertEqual(example.output('bufferedGasCost'), '0.090000 ETH', 'dynamic report default buffered gas cost')
		assertEqual(example.output('correctionProfitFraction'), '3.7143%', 'dynamic report default correction profit fraction')
		assertEqual(example.output('estimatorSafetyState'), 'fees below target error', 'dynamic report default safety state')

		example.setInput('blockBaseFeeGwei', 60)
		assertEqual(example.output('estimatedMinimumWethReport'), '4.846153846153846154 WETH', 'dynamic report minimum should scale linearly with base fee')

		example.setInput('requestedInitialWeth', 6)
		assertEqual(example.output('estimatedMinimumWethReport'), '4.846153846153846154 WETH', 'caller-selected WETH should not change the computed minimum')
		assertEqual(example.output('selectedInitialWethReport'), '6.000000000000000000 WETH', 'caller can select WETH above the computed minimum')
		assertEqual(example.output('selectedEscalationHalt'), '60.000000000000000000 WETH', 'escalation halt should scale from selected initial WETH')

		example.setInput('blockBaseFeeGwei', 0)
		example.setInput('requestedInitialWeth', 0)
		assertEqual(example.output('estimatedMinimumWethReport'), '0.000000000000000001 WETH', 'zero base fee should retain the OpenOracle one-wei minimum')

		example.setInput('blockBaseFeeGwei', 30)
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
		underfundedAliceReceives: '3.2 REP',
	},
	{
		defaultBindingCondition: 'both caps',
		defaultAliceReceives: '1 REP',
		defaultBobReceives: '1.33 REP',
		defaultCarolReceives: '1.67 REP',
		filePath: 'docs/placeholder-whitepaper.html',
		exampleId: 'auction-clearing-example',
		underfundedAliceReceives: '3.20 REP',
	},
]

for (const scenario of scenarios) {
	await checkDefaultFundedClearing(scenario)
	await checkExplicitEthCapScenario(scenario)
	await checkUnderfundedPath(scenario)
	await checkAllZeroBids(scenario)
}

await checkSourceLabelsAndThresholdText('docs/auction-design.html', [
	'write("clearingMode", "underfunded reserve clearing")',
	'write("bindingCondition", "underfunded")',
	'write("thresholdInputEth", formatEth(winningEth))',
	'const threshold = ethRaiseCap / repInventory',
	'bid.price >= threshold',
	'repResults[bid.key] = bid.eth / threshold',
	'accumulatedEth = winningEth',
])

await checkSourceLabelsAndThresholdText('docs/placeholder-whitepaper.html', [
	'const submittedBids = bids.filter((bid) => bid.eth > 0)',
	'(bid) => bid.price >= underfundedThreshold',
	'context.write("clearingMode", "underfunded reserve clearing")',
	'context.write("bindingCondition", "underfunded")',
	'context.write("thresholdInputEth", formatEth(winningEth))',
	'const underfundedThreshold = ethRaiseCap / repInventory',
	'bid.price >= underfundedThreshold',
	'repResults[bid.name] = bid.eth / underfundedThreshold',
])

await checkCollateralRepairExample()
await checkUnderfundedPrefixExample()
await checkResolutionEdgeExample()
await checkPayoutRegionExample()
await checkDynamicWethReportExample()
checkExactRepCapEquality()

const openOracleHtml = await readFile('docs/open-oracle-integration.html', 'utf8')
assert.doesNotMatch(blockWithId(openOracleHtml, 'eq-openoracle-initial-report-size'), /<mi>(?:R|P|e|E|Q|N|D|T|H|m|u|F)<\/mi>/, 'dynamic report equation should use descriptive domain names instead of one-letter identifiers')
assert.doesNotMatch(openOracleHtml, /259\.332023575638507216 REP/, 'OpenOracle integration should not retain the removed fixed REP report')
assert.match(openOracleHtml, /WETH as <code>token1<\/code> and\s+REP as <code>token2<\/code>/, 'OpenOracle integration should document WETH as the exact token-one side')

const auctionDesignHtml = await readFile('docs/auction-design.html', 'utf8')
assert.doesNotMatch(auctionDesignHtml, /buy only the REP they demanded/i, 'auction design should not describe underfunded fills as per-tick demand')
assert.match(auctionDesignHtml, /inventory remains unsold|leaves inventory unsold/i, 'auction design should explain that weak demand leaves REP inventory unsold')
assert.match(auctionDesignHtml, /only bids at or above the cap-implied reserve/i, 'auction design should make reserve qualification explicit')
assert.doesNotMatch(auctionDesignHtml, /max-uint sentinel/i, 'auction design should not describe the removed no-bid threshold sentinel')
assert.match(auctionDesignHtml, /every bid refunds/i, 'auction design should document the no-qualifying-bid refund branch')
assert.match(auctionDesignHtml, /ceilings the underfunded reserve to a tick/i, 'auction design calculator copy should describe rounding the cap-implied reserve to a tick')
assert.match(auctionDesignHtml, /computes each allocation by\s+differencing cumulative floors at the bid's fixed\s+descending-tick\/submission position/i, 'auction design calculator copy should describe deterministic cumulative floor allocation')
assert.doesNotMatch(auctionDesignHtml, /carries\s+remainders during paged withdrawals/i, 'auction design should not describe removed withdrawal-order remainder carry')
assert.doesNotMatch(auctionDesignHtml, /carries division dust|carries division remainders/i, 'auction design should not describe deterministic cumulative allocation as mutable division carry')
assert.doesNotMatch(auctionDesignHtml, /underfundedThreshold = ceil\(underfundedWinningEth \* PRICE_PRECISION \/ maxRepBeingSold\)/i, 'auction design should not derive the reserve from winning ETH')
assert.match(auctionDesignHtml, /data-source="underfundedThreshold = ceil\(ethRaiseCap \* PRICE_PRECISION \/ maxRepBeingSold\)"/i, 'auction design should derive the underfunded reserve from both caps')
assert.match(auctionDesignHtml, /under-repaired attempt\s+reverts with the child still inactive in <code>ForkTruthAuction<\/code>/i, 'auction design should document exact-repair rollback')
assert.match(auctionDesignHtml, /Forced ETH does not count/i, 'auction design should exclude forced ETH from the child activation ratio')
assert.match(auctionDesignHtml, /floor\(maxRepBeingSold \* underfundedWinningEth \/ ethRaiseCap\)/i, 'auction design should derive proportional REP from the two caps and retained ETH')
assert.match(auctionDesignHtml, /acts only as the bid-eligibility boundary[\s\S]*Aggregate purchased REP is determined independently/i, 'auction design should distinguish the reserve boundary from proportional REP calculation')
assert.doesNotMatch(auctionDesignHtml, /actual execution price|purchased REP by retained ETH at the reserve tick/i, 'auction design should not describe the underfunded eligibility boundary as an execution price')
assert.doesNotMatch(auctionDesignHtml, /Qualifying ETH buys REP at the ceiling tick|tick rounds up[\s\S]*exact integer fills can be slightly lower/i, 'auction worked examples should not attribute proportional REP allocation to the reserve tick price')
assert.match(auctionDesignHtml, /ceiling tick[\s\S]*only the\s+eligibility boundary[\s\S]*cap-ratio REP allocation[\s\S]*floors aggregate and per-bid\s+allocations/i, 'auction worked examples should distinguish bid eligibility from integer cap-ratio allocation')
assert.match(auctionDesignHtml, /auction ETH divided by <code>ethRaiseCap<\/code>[\s\S]*explicit repair[\s\S]*neither allowance nor ownership/i, 'auction design should exclude explicit repair contributions from bidder rights')
assert.match(auctionDesignHtml, /1 \/ 0\.11 ≈ 9\.09 REP[\s\S]*below the <code>10 REP<\/code> cap/i, 'auction design tiny-demand example should remain strictly below the REP cap')

const operatorReferenceMarkdown = await readFile('docs/operator-reference.md', 'utf8')
assert.match(operatorReferenceMarkdown, /checkpoints the parent vault before clearing its allowance[\s\S]*balance above `totalAccruedFees\(\)`/i, 'operator reference should preserve parent fee solvency during vault migration')
assert.match(operatorReferenceMarkdown, /activateForkMode[\s\S]*universe fork[\s\S]*fork-time checkpoint[\s\S]*collateralAtFork/i, 'operator reference should document the ordered own-fork collateral checkpoint lifecycle')
assert.match(operatorReferenceMarkdown, /external and own forks record one fixed[\s\S]*cumulative REP position[\s\S]*Truth-auction repair uses the fixed snapshot minus the child’s actual cumulative routed collateral/i, 'operator reference should document exact snapshot-based collateral repair')
assert.match(operatorReferenceMarkdown, /once every eligible vault checkpoints[\s\S]*no vault can individually claim returns to collateral/i, 'operator reference should document final aggregate-only fee reserve release')
assert.match(operatorReferenceMarkdown, /each claimed auction allowance joins incrementally[\s\S]*delayed claim adds to the pool’s live eligible total/i, 'operator reference should document live incremental fee eligibility for delayed auction claims')
assert.match(operatorReferenceMarkdown, /## Security Pool Guardrails[\s\S]*totalFeesOwedToVaults[\s\S]*totalAccruedFees\(\)[\s\S]*## Share Migration/i, 'operator reference security-pool guardrails should define assigned and aggregate fee accounting')
assert.match(
	operatorReferenceMarkdown,
	/derive each bid's REP from the difference between rounded cumulative allocations[\s\S]*no bid meets the cap-implied reserve, or qualifying ETH produces a zero proportional REP aggregate,[\s\S]*every bid refunds\./i,
	'operator reference should document deterministic auction rounding and both zero-allocation refund branches',
)

const placeholderHtml = await readFile('docs/placeholder-whitepaper.html', 'utf8')
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
assert.doesNotMatch(placeholderHtml, /carried remainder across paged withdrawals/i, 'whitepaper auction examples should not describe removed withdrawal-order remainder carry')
assert.doesNotMatch(placeholderHtml, /paged withdrawals carr(?:y|ies) division dust/i, 'whitepaper should describe fixed cumulative-position allocation rather than mutable division carry')
assert.doesNotMatch(placeholderHtml, /(?:collateralDecay|decayCandidate)[^\"]*totalSecurityBondAllowance/i, 'whitepaper fee-index formula should not use total capacity as the accrual denominator')
assert.match(placeholderHtml, /feeEligibleSecurityBondAllowance/i, 'whitepaper fee-index formula should use assigned fee-eligible allowance')
assert.match(placeholderHtml, /data-source="decayCandidate = collateralIn - floor\(collateralIn \\cdot rpow\(retentionRate, elapsedTime, pricePrecision\) \/ pricePrecision\)"/i, 'whitepaper should distinguish the fixed-point decay candidate from credited whole-wei fees')
assert.match(placeholderHtml, /collateralOut = collateralIn - reserveCredit/i, 'whitepaper should define stored collateral as input collateral minus whole-wei reserve credit')
assert.match(placeholderHtml, /feeEligibleSecurityBondAllowance == 0[\s\S]*feeIndexDelta[\s\S]*reserveCredit[\s\S]*advances the accumulator[\s\S]*prevents unclaimed auction allowance from earning retroactive fees/i, 'whitepaper fee-index section should document the zero-eligible-allowance no-accrual branch')
assert.match(placeholderHtml, /Unallocated Reserve[\s\S]*Assigned Vault Debt[\s\S]*Vault Payout/i, 'whitepaper fee-flow diagram should show reserve, checkpointed debt, and redemption stages')
assert.match(placeholderHtml, /vaultFeeRemainderOut/i, 'whitepaper fee-index formula should document per-vault fractional carry')
assert.match(placeholderHtml, /actualCollateralDelta = min\(requestedCollateralDelta, parentCompleteSetCollateral\)/i, 'whitepaper own-fork collateral formula should reserve accrued parent fees')
assert.match(placeholderHtml, /activateForkMode[\s\S]*universe fork[\s\S]*fork-time checkpoint[\s\S]*collateralAtFork/i, 'whitepaper should document the ordered own-fork collateral checkpoint lifecycle')
assert.match(placeholderHtml, /Both external and[\s\S]*one fixed, fee-exclusive fork[\s\S]*cumulative\s+ceiling accounting[\s\S]*Truth-auction repair subtracts the child's actual cumulative routed\s+collateral/i, 'whitepaper should document exact fixed-snapshot collateral repair')
assert.match(
	placeholderHtml,
	/data-source="migrationRepDenominatorAtFork = ownFork \? vaultRepAtFork : auctionableRepAtFork; migratedRep = floor\(parentPoolOwnership \\cdot migrationRepDenominatorAtFork \/ parentPoolOwnershipDenominator\)"/i,
	'whitepaper should document the fork-specific migrated REP denominator and Solidity floor',
)
assert.match(placeholderHtml, /data-source="ethCollateralToBuy = max\(0, parentCollateralAtFork - forkCollateralReceived\)"/i, 'whitepaper should derive the auction repair target from actual routed collateral')
assert.match(placeholderHtml, /cumulative-ceiling transfers[\s\S]*available-collateral cap[\s\S]*nominal migrated REP/i, 'whitepaper should explain exact and capped collateral-repair accounting')
assert.match(
	placeholderHtml,
	/data-source="migrationRepDenominatorAtFork = ownFork \? vaultRepAtFork : auctionableRepAtFork; cumulativeCollateralTargetAfterMigration = ceil\(parentCollateralAtFork \\cdot cumulativeRepTransferredAfterMigration \/ migrationRepDenominatorAtFork\)/i,
	'whitepaper should use the fork-specific denominator in cumulative collateral migration',
)
assert.doesNotMatch(placeholderHtml, /data-source="cumulativeCollateralTargetAfterMigration = ceil\(parentCollateralAtFork \\cdot cumulativeRepTransferredAfterMigration \/ vaultRepAtFork\)/i, 'whitepaper should not present the own-fork denominator as the generalized collateral migration formula')
assert.match(placeholderHtml, /fork-neutral snapshot shared by both paths[\s\S]*ETH raise target[\s\S]*depends on auction demand/i, 'whitepaper should explain shared snapshot accounting and demand-dependent auction repair')
assert.match(placeholderHtml, /After every eligible vault syncs[\s\S]*individually sub-wei vault remainders[\s\S]*returns to complete-set collateral/i, 'whitepaper should document final aggregate-only fee reserve release')
assert.match(placeholderHtml, /Each delayed claim adds only its newly assigned amount[\s\S]*does not reconstruct that total from[\s\S]*allowance changes and[\s\S]*liquidations remain intact/i, 'whitepaper should document incremental live fee eligibility for delayed auction claims')
assert.match(placeholderHtml, /cap-implied reserve/i, 'whitepaper underfunded explanations should identify the reserve derived from both caps')
assert.match(placeholderHtml, /lower bids refund/i, 'whitepaper truth-auction description should explain reserve-filtered refunds')
assert.doesNotMatch(placeholderHtml, /underfundedThreshold = ceil\(underfundedWinningEth \\cdot (?:PRICE_PRECISION|pricePrecision) \/ maxRepBeingSold\)/i, 'whitepaper should not derive the reserve from winning ETH')
assert.match(placeholderHtml, /underfundedThreshold = ceil\(ethRaiseCap \\cdot pricePrecision \/ maxRepBeingSold\)/i, 'whitepaper fill math should derive the reserve from both caps')
assert.doesNotMatch(placeholderHtml, /max-uint sentinel/i, 'whitepaper should not describe the removed no-bid threshold sentinel')
assert.match(placeholderHtml, /every bid refunds/i, 'whitepaper underfunded prose should document the no-winning-prefix refund branch')
assert.match(placeholderHtml, /proportional aggregate REP[\s\S]*floors to zero[\s\S]*refunds every bid/i, 'whitepaper underfunded prose should document the zero-proportional-REP refund branch')
assert.match(placeholderHtml, /under-repaired finalization attempt reverts[\s\S]*remains inactive in <code>ForkTruthAuction<\/code>/i, 'whitepaper should document exact-repair rollback')
assert.match(placeholderHtml, /Forced ETH[\s\S]*does\s+not\s+satisfy\s+that\s+condition/i, 'whitepaper should exclude forced ETH from child activation')
assert.match(
	placeholderHtml,
	/data-source="fundedRepShare = floor\(\(ethBefore \+ ethUsed\) \\cdot pricePrecision \/ clearingPrice\) - floor\(ethBefore \\cdot pricePrecision \/ clearingPrice\); underfundedThreshold = ceil\(ethRaiseCap \\cdot pricePrecision \/ maxRepBeingSold\); totalRepPurchased = floor\(maxRepBeingSold \\cdot underfundedWinningEth \/ ethRaiseCap\); underfundedRepShare = floor\(\(ethBefore \+ bidEth\) \\cdot totalRepPurchased \/ underfundedWinningEth\) - floor\(ethBefore \\cdot totalRepPurchased \/ underfundedWinningEth\)"/i,
	'whitepaper fill-math data-source should connect the cap-implied reserve, retained ETH, and proportional REP allocation',
)
assert.match(placeholderHtml, /data-source="auctionedSecurityBondAllowance = floor\(unmigratedSecurityBondAllowance \\cdot auctionEthReceived \/ ethRaiseCap\)/i, 'whitepaper should scale auction allowance by auction ETH only')
assert.match(
	placeholderHtml,
	/data-source="auctionedSecurityBondAllowance = floor\(unmigratedSecurityBondAllowance \\cdot auctionEthReceived \/ ethRaiseCap\); poolOwnershipAmount = purchasedRepAmount \\cdot auctionPoolOwnershipPerRep; newSecurityBondAllowance = finalClaim \? auctionedSecurityBondAllowance - claimedAuctionedSecurityBondAllowance : floor\(auctionedSecurityBondAllowance \\cdot purchasedRepAmount \/ totalRepPurchased\)"/i,
	'whitepaper settlement equation should floor both auction-wide and non-final per-claim allowance scaling',
)
assert.match(placeholderHtml, /Explicit repair contributions issue no\s+allowance or ownership/i, 'whitepaper should exclude explicit repair contributions from bidder rights')
assert.match(placeholderHtml, /withdrawals cannot redirect rounding\s+units between bidders/i, 'whitepaper fill-math caption should explain deterministic rounding')
assert.match(placeholderHtml, /weak and no caller supplies the exact\s+remaining shortfall[\s\S]*finalization reverts[\s\S]*ForkTruthAuction/i, 'whitepaper failure modes should preserve exact-repair rollback')
assert.doesNotMatch(placeholderHtml, /resume with only\s+partial collateral repair|underfunded repair|retained ETH at the reserve tick/i, 'whitepaper should not retain obsolete partial-repair or tick-price execution claims')
assert.match(invariantsHtml, /AUC-09[\s\S]*SecurityPoolForkerVaultMigrationDelegate\.sol[\s\S]*finalizeTruthAuctionRepair/i, 'invariant evidence should point exact repair to the delegate guard')
