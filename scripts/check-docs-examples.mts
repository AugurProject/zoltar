import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

type AuctionExampleHarness = {
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

async function loadAuctionExample({ filePath, exampleId }: AuctionExampleScenario): Promise<AuctionExampleHarness> {
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
		assertEqual(example.labelFor('thresholdInputEth'), 'Threshold input ETH', `${scenario.filePath} threshold input label`)
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

		assertEqual(example.output('clearingMode'), 'underfunded tick demand', `${scenario.filePath} underfunded clearing mode`)
		assertEqual(example.labelFor('ethRaised'), 'ETH retained', `${scenario.filePath} underfunded ETH retained label`)
		assertEqual(example.output('ethRaised'), '16 ETH', `${scenario.filePath} underfunded retained ETH`)
		assertEqual(example.labelFor('thresholdInputEth'), 'Threshold input ETH', `${scenario.filePath} underfunded threshold label`)
		assertEqual(example.output('thresholdInputEth'), '16 ETH', `${scenario.filePath} underfunded threshold input ETH`)
		assertEqual(example.output('underfundedThreshold'), '4 ETH/REP', `${scenario.filePath} underfunded threshold`)
		assertEqual(example.output('aliceReceives'), scenario.filePath.endsWith('whitepaper_placeholder.html') ? '3.20 REP' : '3.2 REP', `${scenario.filePath} underfunded Alice REP`)
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

		assertEqual(example.output('clearingMode'), 'underfunded tick demand', `${scenario.filePath} zero-bid clearing mode`)
		assertEqual(example.output('ethRaised'), '0 ETH', `${scenario.filePath} zero-bid retained ETH`)
		assertEqual(example.output('thresholdInputEth'), '0 ETH', `${scenario.filePath} zero-bid threshold input ETH`)
		assertEqual(example.output('underfundedThreshold'), '0 ETH/REP', `${scenario.filePath} zero-bid threshold`)
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
	assert.match(html, /<span>Threshold input ETH<\/span/, `${filePath} should label threshold input ETH explicitly`)
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

await checkSourceLabelsAndThresholdText('docs/auction-design.html', ['write("thresholdInputEth", formatEth(totalActiveEth))', 'let winningEth = 0', 'winningEth += bid.eth', 'accumulatedEth = winningEth'])

await checkSourceLabelsAndThresholdText('docs/whitepaper_placeholder.html', ['const activeBids = bids.filter((bid) => bid.eth > 0)', 'const totalActiveEth = accumulatedEth', 'context.write("thresholdInputEth", formatEth(totalActiveEth))', 'ethRaised += bid.eth'])

await checkCollateralRepairExample()
