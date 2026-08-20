import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../ui/ts/tests/testUtils/domEnvironment.ts'

const additionalGlobalKeys = ['HTMLDetailsElement', 'HTMLSelectElement', 'HTMLOutputElement'] as const

const loadDocument = async (relativePath: string, url: string) => {
	const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
	const environment = installDomEnvironment(url)
	for (const key of additionalGlobalKeys) {
		previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
		Object.defineProperty(globalThis, key, { configurable: true, value: Reflect.get(environment.window, key), writable: true })
	}
	document.write(await Bun.file(relativePath).text())
	document.close()
	return () => {
		environment.cleanup()
		for (const key of additionalGlobalKeys) {
			const descriptor = previousGlobals.get(key)
			if (descriptor === undefined) Reflect.deleteProperty(globalThis, key)
			else Object.defineProperty(globalThis, key, descriptor)
		}
	}
}

const runGeneratedRuntime = async (name: string): Promise<void> => {
	Function(await Bun.file(`docs/assets/js/${name}.js`).text())()
}

test('interactive tools load shared state and preserve preset and reset behavior', async () => {
	const state = encodeURIComponent(JSON.stringify({ aliceEth: '9', bobEth: '8', carolEth: '7', ethRaiseCap: '30', repInventory: '6' }))
	const cleanup = await loadDocument('docs/explanation/truth-auctions.html', `http://localhost/docs/explanation/truth-auctions.html?tool=simple-auction-example&state=${state}`)
	try {
		const tool = document.querySelector<HTMLDetailsElement>('#simple-auction-example')
		const alice = tool?.querySelector<HTMLInputElement>('[data-example-input="aliceEth"]')
		if (tool === null || alice === null || alice === undefined) throw new Error('Interactive truth-auction fixture is missing')
		const defaultAlice = alice.value
		await runGeneratedRuntime('interactiveTools')
		const scenario = tool.querySelector<HTMLSelectElement>('.interactive-tool-toolbar select')
		const reset = Array.from(tool.querySelectorAll<HTMLButtonElement>('.interactive-tool-toolbar button')).find(button => button.textContent === 'Reset')
		const status = tool.querySelector<HTMLElement>('.interactive-tool-status')
		if (scenario === null || reset === undefined || status === null) throw new Error('Interactive toolbar was not created')

		expect(tool.open).toBeTrue()
		expect(alice.value).toBe('9')
		expect(status.textContent).toBe('Shared scenario loaded; results updated.')
		expect(tool.querySelector('.example-output-grid, .example-output, [data-tool-output-region]')?.getAttribute('aria-live')).toBe('polite')

		scenario.value = '0'
		scenario.dispatchEvent(new Event('change'))
		expect(alice.value).toBe('3')
		expect(status.textContent).toBe('Weak demand applied; results updated.')

		reset.click()
		expect(alice.value).toBe(defaultAlice)
		expect(scenario.value).toBe('')
		expect(status.textContent).toBe('Default values restored.')

		tool.dataset['toolUnavailable'] = 'true'
		tool.dispatchEvent(new CustomEvent('docs:tool-availability'))
		expect(scenario.disabled).toBeTrue()
		expect(reset.disabled).toBeTrue()
	} finally {
		cleanup()
	}
})

test('invariant explorer filters, expands, resets, and opens a fragment target', async () => {
	const source = await Bun.file('docs/reference/invariants.html').text()
	const firstIdentifier = source.match(/<details class="invariant-entry" id="([^"]+)"/)?.[1]
	if (firstIdentifier === undefined) throw new Error('Invariant fixture has no entries')
	const cleanup = await loadDocument('docs/reference/invariants.html', `http://localhost/docs/reference/invariants.html#${firstIdentifier}`)
	try {
		await runGeneratedRuntime('invariantExplorer')
		const entries = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.invariant-entry'))
		const search = document.querySelector<HTMLInputElement>('[data-invariant-search]')
		const count = document.querySelector<HTMLElement>('[data-invariant-count]')
		const empty = document.querySelector<HTMLElement>('[data-invariant-empty]')
		const expand = document.querySelector<HTMLButtonElement>('[data-invariant-expand]')
		const reset = document.querySelector<HTMLButtonElement>('[data-invariant-reset]')
		if (entries.length === 0 || search === null || count === null || empty === null || expand === null || reset === null) throw new Error('Invariant explorer fixture is incomplete')

		expect(document.getElementById(firstIdentifier)?.hasAttribute('open')).toBeTrue()
		expect(count.textContent).toBe(`${entries.length} of ${entries.length} invariants`)
		expect(entries[0]?.querySelector('.invariant-entry-actions a')?.getAttribute('href')).toBe(`#${firstIdentifier}`)

		search.value = 'no-invariant-can-match-this-token'
		search.dispatchEvent(new Event('input'))
		expect(count.textContent).toBe(`0 of ${entries.length} invariants`)
		expect(empty.hidden).toBeFalse()
		expect(entries.every(entry => entry.hidden)).toBeTrue()

		reset.click()
		expect(search.value).toBe('')
		expect(empty.hidden).toBeTrue()
		expand.click()
		expect(entries.every(entry => entry.open)).toBeTrue()
	} finally {
		cleanup()
	}
})

test('MMR planner updates valid output and guards invalid leaf and index boundaries', async () => {
	const cleanup = await loadDocument('docs/reference/merkle-mountain-range.html', 'http://localhost/docs/reference/merkle-mountain-range.html')
	try {
		await runGeneratedRuntime('mmrProofPlanner')
		const leafCount = document.querySelector<HTMLInputElement>('[data-tool-input="leafCount"]')
		const peakHeight = document.querySelector<HTMLSelectElement>('[data-tool-input="peakHeight"]')
		const leafIndex = document.querySelector<HTMLInputElement>('[data-tool-input="leafIndex"]')
		const selection = document.querySelector<HTMLOutputElement>('[data-mmr-output="selection"]')
		const siblings = document.querySelector<HTMLOutputElement>('[data-mmr-output="mmrSiblings"]')
		if (leafCount === null || peakHeight === null || leafIndex === null || selection === null || siblings === null) throw new Error('MMR planner fixture is incomplete')

		expect(peakHeight.value).toBe('2')
		expect(selection.value).toBe('Valid peak-local index')
		expect(siblings.value).toBe('4')

		leafCount.value = '0'
		leafCount.dispatchEvent(new Event('input'))
		expect(leafCount.getAttribute('aria-invalid')).toBe('true')
		expect(peakHeight.disabled).toBeTrue()
		expect(selection.value).toContain('Enter an integer from 1 through')

		leafCount.value = '8'
		leafCount.dispatchEvent(new Event('input'))
		expect(leafCount.hasAttribute('aria-invalid')).toBeFalse()
		expect(peakHeight.value).toBe('3')
		leafIndex.value = '8'
		leafIndex.dispatchEvent(new Event('input'))
		expect(selection.value).toBe('Index must be between 0 and 7')
		leafIndex.value = '7'
		leafIndex.dispatchEvent(new Event('input'))
		expect(selection.value).toBe('Valid peak-local index')
	} finally {
		cleanup()
	}
})
