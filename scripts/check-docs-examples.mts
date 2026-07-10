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

	const runScript = new Function('window', 'document', scriptText)
	runScript(window, window.document)

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
		example.setInput('ethRaiseCap', 30)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 16)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		assertEqual(example.output('clearingMode'), 'underfunded synthetic uniform', `${scenario.filePath} underfunded clearing mode`)
		assertEqual(example.output('bindingCondition'), 'underfunded', `${scenario.filePath} underfunded binding condition`)
		assertEqual(example.labelFor('ethRaised'), 'ETH retained', `${scenario.filePath} underfunded ETH retained label`)
		assertEqual(example.output('ethRaised'), '16 ETH', `${scenario.filePath} underfunded retained ETH`)
		assertEqual(example.labelFor('thresholdInputEth'), 'Winning ETH kept', `${scenario.filePath} underfunded threshold label`)
		assertEqual(example.output('thresholdInputEth'), '16 ETH', `${scenario.filePath} underfunded threshold input ETH`)
		assertEqual(example.output('underfundedThreshold'), '4 ETH/REP', `${scenario.filePath} underfunded threshold`)
		assertEqual(example.output('aliceReceives'), '4 REP', `${scenario.filePath} underfunded Alice REP`)
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

		assertEqual(example.output('clearingMode'), 'underfunded synthetic uniform', `${scenario.filePath} zero-bid clearing mode`)
		assertEqual(example.output('bindingCondition'), 'underfunded', `${scenario.filePath} zero-bid binding condition`)
		assertEqual(example.output('ethRaised'), '0 ETH', `${scenario.filePath} zero-bid retained ETH`)
		assertEqual(example.output('thresholdInputEth'), '0 ETH', `${scenario.filePath} zero-bid threshold input ETH`)
		assertEqual(example.output('underfundedThreshold'), 'no winning ETH', `${scenario.filePath} zero-bid threshold`)
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
	const html = await readFile('docs/whitepaper_placeholder.html', 'utf8')
	const window = new Window({
		url: pathToFileURL('docs/whitepaper_placeholder.html').href,
	})
	window.document.write(html)
	window.document.close()

	try {
		const script = window.document.querySelector('script:not([src])')
		const scriptText = script?.textContent
		if (scriptText === undefined || scriptText.trim().length === 0) {
			throw new Error('docs/whitepaper_placeholder.html is missing an inline collateral repair script')
		}

		const runScript = new Function('window', 'document', scriptText)
		runScript(window, window.document)

		const example = window.document.getElementById('collateral-repair-example')
		if (example === null) {
			throw new Error('docs/whitepaper_placeholder.html is missing #collateral-repair-example')
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

		assertEqual(output('migratedCollateral'), '47.50 ETH', 'collateral repair default migrated collateral')
		assertEqual(output('initialShortfall'), '2.50 ETH', 'collateral repair default initial shortfall')
		assertEqual(output('remainingShortfall'), '0 ETH', 'collateral repair default remaining shortfall')
		assertEqual(output('repairStatus'), 'full repair', 'collateral repair default repair status')
		assertEqual(targetText.textContent?.trim() ?? '', 'target 50 ETH', 'collateral repair default target text')
	} finally {
		window.close()
	}

	assert.match(html, /190\/200 of the parent collateral, or 47\.5 ETH/, 'collateral repair prose should match default migrated collateral')
	assert.match(html, />50 ETH<\/span/, 'collateral repair parent collateral default should remain 50 ETH')
	assert.match(html, />200 REP<\/span/, 'collateral repair repair-denominator default should remain 200 REP')
	assert.match(html, />190 REP<\/span/, 'collateral repair migrated-REP default should remain 190 REP')
	assert.match(html, />2\.5 ETH<\/span/, 'collateral repair auction-raised default should remain 2.5 ETH')
}

async function checkUnderfundedPrefixExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/whitepaper_placeholder.html', 'underfunded-auction-example')

	try {
		assertEqual(example.output('tickStatus'), 'inputs are consistent with a winning-prefix bid', 'underfunded prefix example default status')
		assertEqual(example.output('underfundedThreshold'), '0.1000 ETH/REP', 'underfunded prefix example default threshold')
		assertEqual(example.output('underfundedRepShare'), '40.0000 REP', 'underfunded prefix example default REP share')
		assertEqual(example.output('repAssignedElsewhere'), '60.0000 REP', 'underfunded prefix example default remainder allocation')

		example.setInput('maxRepBeingSold', 4)
		example.setInput('underfundedWinningEth', 8)
		example.setInput('tickPrice', 1)
		example.setInput('bidEth', 3)

		assertEqual(example.output('tickStatus'), 'synthetic price exceeds this tick limit', 'underfunded prefix example inconsistent status')
		assertEqual(example.output('underfundedThreshold'), '2.0000 ETH/REP', 'underfunded prefix example inconsistent threshold')
		assertEqual(example.output('underfundedRepShare'), 'not applicable', 'underfunded prefix example inconsistent REP share')
		assertEqual(example.output('repAssignedElsewhere'), 'not applicable', 'underfunded prefix example inconsistent remainder allocation')
	} finally {
		example.close()
	}
}

async function checkResolutionEdgeExample(): Promise<void> {
	const example = await loadInteractiveExample('docs/whitepaper_placeholder.html', 'resolution-edge-example')

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
		assertEqual(example.output('resolutionReason'), 'no outcome has a strict lead, so the helper keeps the game unresolved', 'resolution edge example tied leader below cost reason')

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
	const example = await loadInteractiveExample('docs/whitepaper_placeholder.html', 'payout-region-example')

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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const scenarios: AuctionExampleScenario[] = [
	{
		defaultBindingCondition: 'both caps',
		defaultAliceReceives: '1 REP',
		defaultBobReceives: '1.33 REP',
		defaultCarolReceives: '1.67 REP',
		filePath: 'docs/auction-design.html',
		exampleId: 'simple-auction-example',
	},
	{
		defaultBindingCondition: 'REP cap',
		defaultAliceReceives: '1 REP',
		defaultBobReceives: '1.33 REP',
		defaultCarolReceives: '1.67 REP',
		filePath: 'docs/whitepaper_placeholder.html',
		exampleId: 'auction-clearing-example',
	},
]

for (const scenario of scenarios) {
	await checkDefaultFundedClearing(scenario)
	await checkExplicitEthCapScenario(scenario)
	await checkUnderfundedPath(scenario)
	await checkAllZeroBids(scenario)
}

await checkSourceLabelsAndThresholdText('docs/auction-design.html', ['write("clearingMode", "underfunded synthetic uniform")', 'write("bindingCondition", "underfunded")', 'write("thresholdInputEth", formatEth(winningEth))', 'let winningEth = 0', 'winningEth = candidateWinningEth', 'accumulatedEth = winningEth'])

await checkSourceLabelsAndThresholdText('docs/whitepaper_placeholder.html', [
	'const activeBids = bids.filter((bid) => bid.eth > 0)',
	'context.write("clearingMode", "underfunded synthetic uniform")',
	'context.write("bindingCondition", "underfunded")',
	'context.write("thresholdInputEth", formatEth(winningEth))',
	'ethRaised += winningBid.eth',
])

await checkCollateralRepairExample()
await checkUnderfundedPrefixExample()
await checkResolutionEdgeExample()
await checkPayoutRegionExample()

const auctionDesignHtml = await readFile('docs/auction-design.html', 'utf8')
assert.doesNotMatch(auctionDesignHtml, /buy only the REP they demanded/i, 'auction design should not describe underfunded fills as per-tick demand')
assert.doesNotMatch(auctionDesignHtml, /weak demand leaves some REP unsold/i, 'auction design should not describe underfunded settlement as leaving REP unsold')
assert.match(auctionDesignHtml, /non-empty winning prefix/i, 'auction design should qualify full-cap underfunded settlement with a non-empty winning prefix')
assert.match(auctionDesignHtml, /underfundedWinningEth\s*&gt;\s*0/i, 'auction design should qualify the underfunded winner rule with a positive winning prefix')
assert.match(auctionDesignHtml, /type\(uint256\)\.max/i, 'auction design should document the no-winning-prefix underfunded threshold sentinel')
assert.match(auctionDesignHtml, /refunds every bid/i, 'auction design should document the no-winning-prefix refund branch')
assert.match(auctionDesignHtml, /ceilings the\s+synthetic underfunded threshold/i, 'auction design calculator copy should describe ceiling division for the synthetic underfunded threshold')
assert.match(auctionDesignHtml, /floors\s+REP allocations/i, 'auction design calculator copy should distinguish threshold ceil from REP allocation floors')
assert.doesNotMatch(auctionDesignHtml, /data-source="underfundedThreshold = ceil\(underfundedWinningEth \* PRICE_PRECISION \/ maxRepBeingSold\)"/i, 'auction design should not present the underfunded threshold formula as unconditional')
assert.match(auctionDesignHtml, /data-source="underfundedThreshold = if underfundedWinningEth > 0 then ceil\(underfundedWinningEth \* PRICE_PRECISION \/ maxRepBeingSold\) else type\(uint256\)\.max"/i, 'auction design should present the underfunded threshold formula as piecewise')

const operatorReferenceMarkdown = await readFile('docs/operator-reference.md', 'utf8')
assert.match(
	operatorReferenceMarkdown,
	/underfunded auctions with a non-empty winning prefix reuse that remainder while dividing the full REP cap across winning ETH, while the no-winning-prefix sentinel allocates no REP and refunds every bid\./i,
	'operator reference should qualify underfunded dust handling with the no-winning-prefix sentinel',
)

const placeholderHtml = await readFile('docs/whitepaper_placeholder.html', 'utf8')
assert.doesNotMatch(placeholderHtml, /whether the tick qualifies/i, 'whitepaper underfunded widget should not present threshold-only winner membership')
assert.doesNotMatch(placeholderHtml, /refunded below threshold/i, 'whitepaper underfunded widget should not present threshold-only refunds')
assert.doesNotMatch(placeholderHtml, /below-threshold bids/i, 'whitepaper truth-auction math should not describe underfunded losers as threshold-filtered bids')
assert.doesNotMatch(placeholderHtml, /data-source="underfundedThreshold = ceil\(underfundedWinningEth \\cdot PRICE_PRECISION \/ maxRepBeingSold\)"/i, 'whitepaper should not present the underfunded threshold formula as unconditional')
assert.match(placeholderHtml, /When\s*<code>underfundedWinningEth\s*&gt;\s*0<\/code>,\s*the stored\s*<code>clearingTick<\/code>/i, 'whitepaper quick-reference bullet should qualify clearingTick winners with a positive winning prefix')
assert.match(placeholderHtml, /underfundedWinningEth\s*&gt;\s*0/i, 'whitepaper underfunded prose should qualify the winner rule with a positive winning prefix')
assert.match(placeholderHtml, /type\(uint256\)\.max/i, 'whitepaper underfunded prose should document the no-winning-prefix threshold sentinel')
assert.match(placeholderHtml, /every bid refunds/i, 'whitepaper underfunded prose should document the no-winning-prefix refund branch')
assert.match(placeholderHtml, /finalization finds a non-empty\s+winning\s+prefix/i, 'whitepaper underfunded summary should qualify full-cap settlement with a non-empty winning prefix')
assert.match(placeholderHtml, /data-source="underfundedThreshold = if underfundedWinningEth > 0 then ceil\(underfundedWinningEth \\cdot PRICE_PRECISION \/ maxRepBeingSold\) else type\(uint256\)\.max"/i, 'whitepaper quick-reference formula should present the underfunded threshold as piecewise')
assert.match(placeholderHtml, /<mi>underfundedThreshold<\/mi>[\s\S]*?<mtext>type\(uint256\)\.max<\/mtext>/i, 'whitepaper fill-math equation should visibly present the no-winning-prefix threshold branch')
assert.match(
	placeholderHtml,
	/data-source="filledRep = floor\(ethUsed \\cdot pricePrecision \/ clearingPrice\); underfundedThreshold = if underfundedWinningEth > 0 then ceil\(underfundedWinningEth \\cdot pricePrecision \/ maxRepBeingSold\) else type\(uint256\)\.max; underfundedRepShare = if underfundedWinningEth > 0 then floor\(\(bidEth \\cdot maxRepBeingSold \+ clearingRemainderIn\) \/ underfundedWinningEth\) else not applicable; clearingRemainderOut = if underfundedWinningEth > 0 then \(bidEth \\cdot maxRepBeingSold \+ clearingRemainderIn\) mod underfundedWinningEth else not applicable"/i,
	'whitepaper fill-math data-source should make the no-winning-prefix share branch explicit',
)
assert.match(placeholderHtml, /<mi>underfundedRepShare<\/mi>[\s\S]*?<mtext>not applicable<\/mtext>/i, 'whitepaper fill-math equation should visibly mark the no-winning-prefix REP-share branch as not applicable')
assert.match(placeholderHtml, /<mi>clearingRemainderOut<\/mi>[\s\S]*?<mtext>not applicable<\/mtext>/i, 'whitepaper fill-math equation should visibly mark the no-winning-prefix remainder branch as not applicable')
assert.match(placeholderHtml, /share and remainder rows are\s+not applicable,\s+and every bid refunds/i, 'whitepaper fill-math caption should explain the no-winning-prefix share behavior')
