import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'

type AuctionExampleHarness = {
	close: () => void
	output: (name: string) => string
	setInput: (name: string, value: number) => void
}

async function loadAuctionExample(filePath = 'docs/auction-design.html', exampleId = 'simple-auction-example'): Promise<AuctionExampleHarness> {
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

	return {
		close: () => window.close(),
		output,
		setInput,
	}
}

test('auction design example calculates funded clearing', async () => {
	const example = await loadAuctionExample()
	try {
		expect(example.output('clearingMode')).toBe('funded near 3 ETH/REP')
		expect(example.output('ethRaised')).toBe('12 ETH')
		expect(example.output('aliceReceives')).toBe('1 REP')
		expect(example.output('bobReceives')).toBe('1.33 REP')
		expect(example.output('carolReceives')).toBe('1.67 REP')
		expect(example.output('refunds')).toBe('1 ETH')
	} finally {
		example.close()
	}
})

test('auction design example treats zero-value levels as inactive bids', async () => {
	const example = await loadAuctionExample()
	try {
		example.setInput('ethRaiseCap', 30)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 16)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		expect(example.output('clearingMode')).toBe('underfunded tick demand')
		expect(example.output('ethRaised')).toBe('16 ETH')
		expect(example.output('underfundedThreshold')).toBe('4 ETH/REP')
		expect(example.output('aliceReceives')).toBe('3.2 REP')
		expect(example.output('bobReceives')).toBe('0 REP')
		expect(example.output('carolReceives')).toBe('0 REP')
		expect(example.output('refunds')).toBe('0 ETH')
	} finally {
		example.close()
	}
})

test('auction design example keeps all-zero bids finite', async () => {
	const example = await loadAuctionExample()
	try {
		example.setInput('ethRaiseCap', 30)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 0)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		expect(example.output('clearingMode')).toBe('underfunded tick demand')
		expect(example.output('ethRaised')).toBe('0 ETH')
		expect(example.output('underfundedThreshold')).toBe('0 ETH/REP')
		expect(example.output('aliceReceives')).toBe('0 REP')
		expect(example.output('bobReceives')).toBe('0 REP')
		expect(example.output('carolReceives')).toBe('0 REP')
		expect(example.output('refunds')).toBe('0 ETH')
	} finally {
		example.close()
	}
})

test('auction design example source displays underfunded winning ETH as raised ETH', async () => {
	const html = await readFile('docs/auction-design.html', 'utf8')

	expect(html).toContain('let winningEth = 0')
	expect(html).toContain('winningEth += bid.eth')
	expect(html).toContain('accumulatedEth = winningEth')
})

test('Placeholder whitepaper auction example calculates funded clearing', async () => {
	const example = await loadAuctionExample('docs/whitepaper_placeholder.html', 'auction-clearing-example')
	try {
		expect(example.output('clearingMode')).toBe('funded near 3 ETH/REP')
		expect(example.output('ethRaised')).toBe('12 ETH')
		expect(example.output('aliceReceives')).toBe('1 REP')
		expect(example.output('bobReceives')).toBe('1.33 REP')
		expect(example.output('carolReceives')).toBe('1.67 REP')
		expect(example.output('refunds')).toBe('1 ETH')
	} finally {
		example.close()
	}
})

test('Placeholder whitepaper auction example treats zero-value levels as inactive bids', async () => {
	const example = await loadAuctionExample('docs/whitepaper_placeholder.html', 'auction-clearing-example')
	try {
		example.setInput('ethRaiseCap', 30)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 16)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		expect(example.output('clearingMode')).toBe('underfunded tick demand')
		expect(example.output('ethRaised')).toBe('16 ETH')
		expect(example.output('underfundedThreshold')).toBe('4 ETH/REP')
		expect(example.output('aliceReceives')).toBe('3.20 REP')
		expect(example.output('bobReceives')).toBe('0 REP')
		expect(example.output('carolReceives')).toBe('0 REP')
		expect(example.output('refunds')).toBe('0 ETH')
	} finally {
		example.close()
	}
})

test('Placeholder whitepaper auction example keeps all-zero bids finite', async () => {
	const example = await loadAuctionExample('docs/whitepaper_placeholder.html', 'auction-clearing-example')
	try {
		example.setInput('ethRaiseCap', 30)
		example.setInput('repInventory', 4)
		example.setInput('aliceEth', 0)
		example.setInput('bobEth', 0)
		example.setInput('carolEth', 0)

		expect(example.output('clearingMode')).toBe('underfunded tick demand')
		expect(example.output('ethRaised')).toBe('0 ETH')
		expect(example.output('underfundedThreshold')).toBe('0 ETH/REP')
		expect(example.output('aliceReceives')).toBe('0 REP')
		expect(example.output('bobReceives')).toBe('0 REP')
		expect(example.output('carolReceives')).toBe('0 REP')
		expect(example.output('refunds')).toBe('0 ETH')
	} finally {
		example.close()
	}
})

test('Placeholder whitepaper auction example source displays underfunded winning ETH as raised ETH', async () => {
	const html = await readFile('docs/whitepaper_placeholder.html', 'utf8')

	expect(html).toContain('const activeBids = bids.filter((bid) => bid.eth > 0)')
	expect(html).toContain('const totalActiveEth = accumulatedEth')
	expect(html).toContain('ethRaised += bid.eth')
})
