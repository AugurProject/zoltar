import { expect, test } from 'bun:test'
import { installDomEnvironment } from '../../ui/coreShared/ts/tests/testUtils/domEnvironment.ts'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '../../ui/coreShared/ts/wallet/networkProfile.js'
import { getDeploymentSteps } from '../../ui/statoblastShared/ts/protocol/deployment.js'

const additionalGlobalKeys = ['HTMLDetailsElement', 'HTMLSelectElement', 'HTMLTableCellElement', 'HTMLTableSectionElement', 'HTMLOutputElement', 'SVGSVGElement'] as const

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
	const source = await Bun.file(`docs/assets/js/${name}.js`).text()
	await Function(`${source}\nreturn typeof deploymentMaskDecoderReady === 'undefined' ? undefined : deploymentMaskDecoderReady`)()
}

test('interactive tools restore shared state, apply presets, validate input, and reset', async () => {
	const state = encodeURIComponent(JSON.stringify({ yes: '9', no: '8' }))
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', `http://localhost/docs/explanation/escalation-game.html?tool=escalation-game-example&state=${state}`)
	try {
		await runGeneratedRuntime('interactiveTools')
		const tool = document.querySelector<HTMLDetailsElement>('#escalation-game-example')
		const yes = tool?.querySelector<HTMLInputElement>('[data-example-input="yes"]')
		const status = tool?.querySelector<HTMLElement>('.interactive-tool-status')
		const preset = Array.from(tool?.querySelectorAll<HTMLButtonElement>('.interactive-tool-presets button') ?? []).find(button => button.textContent === 'Median increases')
		const reset = Array.from(tool?.querySelectorAll<HTMLButtonElement>('.interactive-tool-toolbar button') ?? []).find(button => button.textContent === 'Reset')
		if (!tool || !yes || !status || !preset || !reset) throw new Error('Escalation controls missing')
		expect(tool.open).toBeTrue()
		expect(yes.value).toBe('9')
		expect(status.textContent).toBe('Shared scenario loaded; results updated.')
		preset.click()
		expect(yes.value).toBe('4')
		expect(preset.getAttribute('aria-pressed')).toBe('true')
		for (const value of ['', '-1', '101', '3.5']) {
			yes.value = value
			yes.dispatchEvent(new Event('input', { bubbles: true }))
			expect(yes.getAttribute('aria-invalid')).toBe('true')
			expect(tool.dataset['inputsValid']).toBe('false')
			expect(preset.getAttribute('aria-pressed')).toBe('false')
		}
		reset.click()
		expect(yes.value).toBe('1')
		expect(yes.hasAttribute('aria-invalid')).toBeFalse()
		expect(tool.dataset['inputsValid']).not.toBe('false')
	} finally {
		cleanup()
	}
})

test('escalation controls use an outcome segment and retain one timeline scrubber', async () => {
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', 'http://localhost/docs/explanation/escalation-game.html')
	try {
		await runGeneratedRuntime('interactiveTools')
		const outcome = document.querySelector<HTMLSelectElement>('[data-example-input="depositOutcome"]')
		const noButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.segmented-control button')).find(button => button.textContent === 'No')
		const days = document.querySelector<HTMLInputElement>('[data-example-input="days"]')
		const numericInputs = Array.from(document.querySelectorAll<HTMLInputElement>('#escalation-game-example input[type="number"]'))
		const depositAmount = document.querySelector<HTMLInputElement>('[data-example-input="depositAmount"]')
		const leaderPreset = Array.from(document.querySelectorAll<HTMLButtonElement>('#escalation-game-example .interactive-tool-presets button')).find(button => button.textContent === 'Leader deposit does not extend')
		const groups = Array.from(document.querySelectorAll<HTMLDetailsElement>('#escalation-game-example .tool-control-group'))
		if (outcome === null || noButton === undefined || days === null || depositAmount === null || leaderPreset === undefined || groups.length !== 4) throw new Error('Escalation control fixture is incomplete')
		expect(numericInputs.length).toBe(6)
		expect(groups.filter(group => group.open).map(group => group.querySelector('summary')?.textContent)).toEqual(['Player move'])
		groups[0]?.querySelector('summary')?.click()
		expect(groups[0]?.open).toBeTrue()
		expect(groups[2]?.open).toBeTrue()
		expect(days.type).toBe('range')
		expect(outcome.tabIndex).toBe(-1)
		expect(outcome.getAttribute('aria-hidden')).toBe('true')
		noButton.click()
		expect(outcome.value).toBe('no')
		expect(noButton.getAttribute('aria-pressed')).toBe('true')
		depositAmount.value = '9'
		depositAmount.dispatchEvent(new Event('input', { bubbles: true }))
		leaderPreset.click()
		expect(depositAmount.value).toBe('1')
	} finally {
		cleanup()
	}
})

test('mobile widgets preserve the primary-only disclosure default', async () => {
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', 'http://localhost/docs/explanation/escalation-game.html')
	try {
		const mobileQuery: MediaQueryList = {
			addEventListener: () => {},
			addListener: () => {},
			dispatchEvent: () => true,
			matches: true,
			media: '(max-width: 640px)',
			onchange: null,
			removeEventListener: () => {},
			removeListener: () => {},
		}
		Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => mobileQuery })
		await runGeneratedRuntime('interactiveTools')
		const groups = Array.from(document.querySelectorAll<HTMLDetailsElement>('#escalation-game-example .tool-control-group'))
		const openGroups = groups.filter(group => group.open)
		expect(openGroups).toHaveLength(1)
		expect(openGroups[0]?.querySelector('summary')?.textContent).toBe('Player move')
	} finally {
		cleanup()
	}
})

test('OpenOracle controls separate coordinator policy from the report request and expose the fee bound', async () => {
	const cleanup = await loadDocument('docs/reference/open-oracle.html', 'http://localhost/docs/reference/open-oracle.html')
	try {
		await runGeneratedRuntime('openOracleTools')
		await runGeneratedRuntime('interactiveTools')
		const groups = Array.from(document.querySelectorAll<HTMLDetailsElement>('#initial-report-estimator-example .tool-control-group'))
		const group = (summary: string) => groups.find(candidate => candidate.querySelector('summary')?.textContent === summary)
		const feeBound = document.querySelector<HTMLOutputElement>('[data-example-output="estimatorSafetyState"]')
		const target = document.querySelector<HTMLInputElement>('[data-example-input="targetPriceErrorForDispute"]')
		const reporterFee = document.querySelector<HTMLInputElement>('[data-example-input="openOracleReporterFee"]')
		const protocolFee = document.querySelector<HTMLInputElement>('[data-example-input="openOracleProtocolFee"]')
		if (feeBound === null || target === null || reporterFee === null || protocolFee === null) throw new Error('OpenOracle grouping fixture is incomplete')
		expect(groups.filter(candidate => candidate.open).map(candidate => candidate.querySelector('summary')?.textContent)).toEqual(['Report request'])
		expect(group('Oracle fees')?.dataset['groupTone']).toBe('system')
		expect(group('Coordinator policy')?.querySelector('[data-example-input="escalationHaltMultiplier"]')).not.toBeNull()
		expect(group('Report request')?.querySelector('[data-example-input="requestedInitialWeth"]')).not.toBeNull()
		expect(group('Report request')?.querySelector('[data-example-input="escalationHaltMultiplier"]')).toBeNull()
		expect(feeBound.value).toBe('fees below target error')

		target.value = '1.2'
		target.dispatchEvent(new Event('input', { bubbles: true }))
		reporterFee.value = '0.2'
		reporterFee.dispatchEvent(new Event('input', { bubbles: true }))
		expect(feeBound.value).toBe('unsafe: fees meet or exceed target error')
		protocolFee.value = ''
		protocolFee.dispatchEvent(new Event('input', { bubbles: true }))
		expect(protocolFee.getAttribute('aria-invalid')).toBe('true')
		expect(feeBound.value).toBe('unsafe: fees meet or exceed target error')
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
		const keyword = document.querySelector<HTMLInputElement>('[data-invariant-filter]')
		const typeSelect = document.querySelector<HTMLSelectElement>('[data-invariant-type]')
		const statusSelect = document.querySelector<HTMLSelectElement>('[data-invariant-status]')
		const count = document.querySelector<HTMLElement>('[data-invariant-count]')
		const empty = document.querySelector<HTMLElement>('[data-invariant-empty]')
		const expand = document.querySelector<HTMLButtonElement>('[data-invariant-expand]')
		const reset = document.querySelector<HTMLButtonElement>('[data-invariant-reset]')
		if (entries.length === 0 || keyword === null || typeSelect === null || statusSelect === null || count === null || empty === null || expand === null || reset === null) throw new Error('Invariant explorer fixture is incomplete')

		expect(document.getElementById(firstIdentifier)?.hasAttribute('open')).toBeTrue()
		expect(count.textContent).toBe(`${entries.length} of ${entries.length} invariants`)
		expect(entries[0]?.querySelector('.invariant-entry-actions a')?.getAttribute('href')).toBe(`#${firstIdentifier}`)

		keyword.value = firstIdentifier
		keyword.dispatchEvent(new Event('input'))
		expect(entries.find(entry => entry.id === firstIdentifier)?.hidden).toBeFalse()
		expect(entries.filter(entry => !entry.hidden).length).toBeLessThan(entries.length)
		keyword.value = 'no-invariant-can-match-this-token'
		keyword.dispatchEvent(new Event('input'))
		expect(count.textContent).toBe(`0 of ${entries.length} invariants`)
		expect(empty.hidden).toBeFalse()
		reset.click()
		expect(keyword.value).toBe('')
		expect(count.textContent).toBe(`${entries.length} of ${entries.length} invariants`)

		const livenessOption = Array.from(typeSelect.options).find(option => option.value === 'Conservation')
		const toolingOption = Array.from(statusSelect.options).find(option => option.value === 'Contract guard and regression tests')
		if (livenessOption === undefined || toolingOption === undefined) throw new Error('Invariant explorer facets are missing expected options')
		typeSelect.value = livenessOption.value
		typeSelect.dispatchEvent(new Event('change'))
		const livenessCount = entries.filter(entry => !entry.hidden).length
		expect(livenessCount).toBeGreaterThan(0)
		expect(count.textContent).toBe(`${livenessCount} of ${entries.length} invariants`)
		statusSelect.value = toolingOption.value
		statusSelect.dispatchEvent(new Event('change'))
		expect(count.textContent).toBe(`0 of ${entries.length} invariants`)
		expect(empty.hidden).toBeFalse()
		expect(entries.every(entry => entry.hidden)).toBeTrue()

		reset.click()
		expect(typeSelect.value).toBe('')
		expect(statusSelect.value).toBe('')
		expect(empty.hidden).toBeTrue()
		expand.click()
		expect(entries.every(entry => entry.open)).toBeTrue()
	} finally {
		cleanup()
	}
})

test('invariant filters mark page-outline links whose sections they hide', async () => {
	const cleanup = await loadDocument('docs/reference/invariants.html', 'http://localhost/docs/reference/invariants.html')
	try {
		const outline = document.createElement('ol')
		outline.className = 'docs-outline-list'
		outline.innerHTML = '<li><a href="#standing">Classification and scope</a></li>'
		document.body.append(outline)
		await runGeneratedRuntime('invariantExplorer')
		const keyword = document.querySelector<HTMLInputElement>('[data-invariant-filter]')
		const standingLink = outline.querySelector('a')
		if (keyword === null || standingLink === null) throw new Error('Invariant outline fixture is incomplete')
		expect(standingLink.hasAttribute('aria-disabled')).toBeFalse()
		keyword.value = 'auction'
		keyword.dispatchEvent(new Event('input'))
		expect(standingLink.getAttribute('aria-disabled')).toBe('true')
		expect(standingLink.textContent).toBe('Classification and scope (hidden by filter)')
		const click = new MouseEvent('click', { bubbles: true, cancelable: true })
		standingLink.dispatchEvent(click)
		expect(click.defaultPrevented).toBeTrue()
		keyword.value = ''
		keyword.dispatchEvent(new Event('input'))
		expect(standingLink.hasAttribute('aria-disabled')).toBeFalse()
		expect(standingLink.textContent).toBe('Classification and scope')
	} finally {
		cleanup()
	}
})

test('invariant fragment navigation clears sticky explorer controls', async () => {
	const cleanup = await loadDocument('docs/reference/invariants.html', 'http://localhost/docs/reference/invariants.html#pool-accounting')
	try {
		const explorer = document.querySelector<HTMLElement>('#invariant-explorer')
		const target = document.querySelector<HTMLDetailsElement>('#pool-accounting')
		if (explorer === null || target === null) throw new Error('Invariant fragment fixture is incomplete')
		let scrollByOptions: ScrollToOptions | undefined
		const runAnimationFrame = (callback: FrameRequestCallback): number => {
			callback(0)
			return 1
		}
		Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: runAnimationFrame, writable: true })
		Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ position: 'sticky' }), writable: true })
		Object.defineProperty(explorer, 'getBoundingClientRect', { configurable: true, value: () => ({ bottom: 373, height: 293 }) })
		Object.defineProperty(target, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 80 }) })
		Object.defineProperty(target, 'scrollIntoView', { configurable: true, value: () => {} })
		Object.defineProperty(window, 'scrollBy', {
			configurable: true,
			value: (options: ScrollToOptions) => {
				scrollByOptions = options
			},
		})

		await runGeneratedRuntime('invariantExplorer')

		expect(target.open).toBeTrue()
		expect(target.style.scrollMarginTop).toBe('309px')
		expect(scrollByOptions).toEqual({ behavior: 'instant', top: -309 })
	} finally {
		cleanup()
	}
})

test('invariant index links reveal a filtered-out entry clear of the sticky explorer controls', async () => {
	const cleanup = await loadDocument('docs/reference/invariants.html', 'http://localhost/docs/reference/invariants.html')
	try {
		const explorer = document.querySelector<HTMLElement>('#invariant-explorer')
		const target = document.querySelector<HTMLDetailsElement>('#escalation')
		const keyword = document.querySelector<HTMLInputElement>('[data-invariant-filter]')
		if (explorer === null || target === null || keyword === null) throw new Error('Invariant index navigation fixture is incomplete')
		let scrollByOptions: ScrollToOptions | undefined
		const runAnimationFrame = (callback: FrameRequestCallback): number => {
			callback(0)
			return 1
		}
		Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: runAnimationFrame, writable: true })
		Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ position: 'sticky' }), writable: true })
		Object.defineProperty(explorer, 'getBoundingClientRect', { configurable: true, value: () => ({ bottom: 373, height: 293 }) })
		Object.defineProperty(target, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 80 }) })
		Object.defineProperty(target, 'scrollIntoView', { configurable: true, value: () => {} })
		Object.defineProperty(window, 'scrollBy', {
			configurable: true,
			value: (options: ScrollToOptions) => {
				scrollByOptions = options
			},
		})

		await runGeneratedRuntime('invariantExplorer')
		keyword.value = 'UNI-01'
		keyword.dispatchEvent(new Event('input'))
		expect(target.hidden).toBeTrue()
		keyword.blur()

		window.location.hash = '#escalation'
		window.dispatchEvent(new Event('hashchange'))

		expect(target.hidden).toBeFalse()
		expect(target.open).toBeTrue()
		expect(keyword.value).toBe('')
		expect(document.activeElement).not.toBe(keyword)
		expect(target.style.scrollMarginTop).toBe('309px')
		expect(scrollByOptions).toEqual({ behavior: 'instant', top: -309 })
	} finally {
		cleanup()
	}
})

test('MMR planner updates valid output and guards invalid leaf and index boundaries', async () => {
	const cleanup = await loadDocument('docs/reference/merkle-mountain-range.html', 'http://localhost/docs/reference/merkle-mountain-range.html')
	try {
		await runGeneratedRuntime('mmrProofPlanner')
		await runGeneratedRuntime('interactiveTools')
		const leafCount = document.querySelector<HTMLInputElement>('[data-tool-input="leafCount"]')
		const peakHeight = document.querySelector<HTMLSelectElement>('[data-tool-input="peakHeight"]')
		const leafIndex = document.querySelector<HTMLInputElement>('[data-tool-input="leafIndex"]')
		const leafCountError = document.querySelector<HTMLElement>('#mmr-leaf-count-error')
		const leafIndexError = document.querySelector<HTMLElement>('#mmr-leaf-index-error')
		const selection = document.querySelector<HTMLOutputElement>('[data-mmr-output="selection"]')
		const siblings = document.querySelector<HTMLOutputElement>('[data-mmr-output="mmrSiblings"]')
		const heightTwo = Array.from(document.querySelectorAll<HTMLButtonElement>('.peak-choice-control button')).find(button => button.textContent === 'Height 2')
		const preset = Array.from(document.querySelectorAll<HTMLButtonElement>('#mmr-proof-planner .interactive-tool-presets button')).find(button => button.textContent === '13 leaves, height 2')
		const status = document.querySelector<HTMLElement>('#mmr-proof-planner .interactive-tool-status')
		const snapshotGroup = leafCount?.closest<HTMLDetailsElement>('details.tool-control-group')
		if (leafCount === null || peakHeight === null || leafIndex === null || leafCountError === null || leafIndexError === null || selection === null || siblings === null || heightTwo === undefined || preset === undefined || status === null || snapshotGroup === null || snapshotGroup === undefined)
			throw new Error('MMR planner fixture is incomplete')

		expect(peakHeight.value).toBe('2')
		expect(peakHeight.tabIndex).toBe(-1)
		expect(peakHeight.getAttribute('aria-hidden')).toBe('true')
		expect(selection.value).toBe('Valid in-peak offset')
		expect(siblings.value).toBe('4')
		expect(heightTwo.getAttribute('aria-pressed')).toBe('true')
		preset.click()
		expect(preset.getAttribute('aria-pressed')).toBe('true')
		const heightZero = Array.from(document.querySelectorAll<HTMLButtonElement>('.peak-choice-control button')).find(button => button.textContent === 'Height 0')
		if (heightZero === undefined) throw new Error('MMR height-zero control is missing')
		heightZero.focus()
		heightZero.click()
		expect(document.activeElement).toBe(heightZero)
		expect(preset.getAttribute('aria-pressed')).toBe('false')
		expect(status.textContent).toBe('')

		snapshotGroup.open = false
		leafCount.value = '0'
		leafCount.dispatchEvent(new Event('input'))
		expect(snapshotGroup.open).toBeTrue()
		expect(leafCount.getAttribute('aria-invalid')).toBe('true')
		expect(leafCount.getAttribute('aria-describedby')).toContain(leafCountError.id)
		expect(leafCountError.hidden).toBeFalse()
		expect(leafCountError.textContent).toContain('Enter an integer from 1 through')
		expect(leafIndex.hasAttribute('aria-invalid')).toBeFalse()
		expect(leafIndexError.hidden).toBeTrue()
		expect(peakHeight.disabled).toBeTrue()
		expect(Array.from(document.querySelectorAll<HTMLButtonElement>('.peak-choice-control button')).every(button => button.disabled)).toBeTrue()
		expect(selection.value).toBe('—')
		expect(status.textContent).toBe('Snapshot leaf count: Enter an integer from 1 through 2⁶⁴ − 1.')

		leafCount.value = '8'
		leafCount.dispatchEvent(new Event('input'))
		expect(leafCount.hasAttribute('aria-invalid')).toBeFalse()
		expect(leafCountError.hidden).toBeTrue()
		expect(status.textContent).toBe('')
		expect(peakHeight.value).toBe('3')
		leafIndex.value = '8'
		leafIndex.dispatchEvent(new Event('input'))
		expect(leafIndex.getAttribute('aria-invalid')).toBe('true')
		expect(leafIndex.getAttribute('aria-describedby')).toContain(leafIndexError.id)
		expect(leafIndexError.hidden).toBeFalse()
		expect(leafIndexError.textContent).toBe('Enter an offset from 0 through 7.')
		expect(selection.value).toBe('Offset must be between 0 and 7')
		leafIndex.value = '7'
		leafIndex.dispatchEvent(new Event('input'))
		expect(leafIndex.hasAttribute('aria-invalid')).toBeFalse()
		expect(leafIndexError.hidden).toBeTrue()
		expect(selection.value).toBe('Valid in-peak offset')
	} finally {
		cleanup()
	}
})

test('deployment bit controls clear the active preset and stale status', async () => {
	const cleanup = await loadDocument('docs/reference/deployment-status.html', 'http://localhost/docs/reference/deployment-status.html')
	const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (input: URL | RequestInfo) => {
			const source = String(input)
			const path = source.includes('sepolia') ? 'docs/sepolia-deployment-addresses.json' : 'docs/mainnet-deployment-addresses.json'
			return new Response(await Bun.file(path).text(), { headers: { 'content-type': 'application/json' }, status: 200 })
		},
	})
	try {
		await runGeneratedRuntime('deploymentMaskDecoder')
		await runGeneratedRuntime('interactiveTools')
		for (let attempt = 0; attempt < 20 && document.querySelector('[data-deployment-bit-toggle]') === null; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
		const preset = Array.from(document.querySelectorAll<HTMLButtonElement>('#deployment-mask-decoder .interactive-tool-presets button')).find(button => button.textContent === 'First and third set')
		const bit = document.querySelector<HTMLButtonElement>('[data-deployment-bit-toggle="0"]')
		const status = document.querySelector<HTMLElement>('#deployment-mask-decoder .interactive-tool-status')
		if (preset === undefined || bit === null || status === null) throw new Error('Deployment decoder controls are missing')
		preset.click()
		expect(preset.getAttribute('aria-pressed')).toBe('true')
		bit.click()
		expect(preset.getAttribute('aria-pressed')).toBe('false')
		expect(status.textContent).toBe('')
	} finally {
		if (fetchDescriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch')
		else Object.defineProperty(globalThis, 'fetch', fetchDescriptor)
		cleanup()
	}
})

test('deployment decoder decodes a mask against the selected network mapping', async () => {
	const mainnetSteps = getDeploymentSteps(MAINNET_NETWORK_PROFILE).filter(step => step.id !== 'deploymentStatusOracle')
	const sepoliaSteps = getDeploymentSteps(SEPOLIA_NETWORK_PROFILE).filter(step => step.id !== 'deploymentStatusOracle')
	expect(mainnetSteps[1]?.id).toBe('multicall3')
	expect(sepoliaSteps[1]?.id).toBe('reputationToken')
	expect(sepoliaSteps).toHaveLength(mainnetSteps.length + 1)
	const cleanup = await loadDocument('docs/reference/deployment-status.html', 'http://localhost/docs/reference/deployment-status.html')
	const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (input: URL | RequestInfo) => {
			const source = String(input)
			const path = source.includes('sepolia') ? 'docs/sepolia-deployment-addresses.json' : 'docs/mainnet-deployment-addresses.json'
			return new Response(await Bun.file(path).text(), { headers: { 'content-type': 'application/json' }, status: 200 })
		},
	})
	try {
		await runGeneratedRuntime('deploymentMaskDecoder')
		const network = document.querySelector<HTMLSelectElement>('[data-deployment-mask-network]')
		const input = document.querySelector<HTMLInputElement>('#deployment-mask-input')
		const summary = document.querySelector<HTMLOutputElement>('[data-deployment-mask-summary]')
		const mainnetStatus = document.querySelector<HTMLTableCellElement>('#deployment-status-bit-mapping [data-deployment-bit-status="1"]')
		const sepoliaStatus = document.querySelector<HTMLTableCellElement>('#sepolia-deployment-status-bit-mapping [data-deployment-bit-status="1"]')
		if (network === null || input === null || summary === null || mainnetStatus === null || sepoliaStatus === null) throw new Error('Deployment decoder network controls are missing')
		input.value = '0x2'
		input.dispatchEvent(new Event('input'))
		expect(summary.value).toBe(`Ethereum mainnet: 1 of ${mainnetSteps.length} tracked steps have set bits: Multicall3.`)
		expect(document.querySelectorAll('#deployment-status-bit-mapping [data-deployment-bit-status]')).toHaveLength(mainnetSteps.length)
		expect(mainnetStatus.dataset['maskState']).toBe('set')
		expect(sepoliaStatus.dataset['maskState']).toBeUndefined()
		network.value = 'sepolia'
		network.dispatchEvent(new Event('change'))
		expect(summary.value).toBe(`Sepolia: 1 of ${sepoliaSteps.length} tracked steps have set bits: GenesisReputationToken.`)
		expect(sepoliaStatus.dataset['maskState']).toBe('set')
		expect(mainnetStatus.dataset['maskState']).toBeUndefined()
		expect(document.querySelectorAll('[data-deployment-bit-toggle]')).toHaveLength(sepoliaSteps.length)

		const bitToggles = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-deployment-bit-toggle]'))
		expect(bitToggles().some(button => button.getAttribute('aria-pressed') === 'true')).toBeTrue()
		input.value = 'xyz'
		input.dispatchEvent(new Event('input'))
		expect(input.getAttribute('aria-invalid')).toBe('true')
		expect(bitToggles().every(button => button.disabled)).toBeTrue()
		expect(bitToggles().some(button => button.getAttribute('aria-pressed') === 'true')).toBeFalse()
		input.value = '0x2'
		input.dispatchEvent(new Event('input'))
		expect(input.hasAttribute('aria-invalid')).toBeFalse()
		expect(bitToggles().every(button => !button.disabled)).toBeTrue()
		expect(bitToggles().some(button => button.getAttribute('aria-pressed') === 'true')).toBeTrue()
	} finally {
		if (fetchDescriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch')
		else Object.defineProperty(globalThis, 'fetch', fetchDescriptor)
		cleanup()
	}
})

test('deployment decoder exposes retryable HTTP and malformed-manifest failures', async () => {
	const cleanup = await loadDocument('docs/reference/deployment-status.html', 'http://localhost/docs/reference/deployment-status.html')
	const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
	let mainnetResponse: 'http-error' | 'malformed' = 'http-error'
	Object.defineProperty(globalThis, 'fetch', {
		configurable: true,
		value: async (input: URL | RequestInfo) => {
			const source = String(input)
			if (source.includes('sepolia')) return new Response(JSON.stringify({ deploymentSteps: [] }), { headers: { 'content-type': 'application/json' }, status: 200 })
			if (mainnetResponse === 'http-error') return new Response('Unavailable', { status: 500 })
			return new Response(JSON.stringify({ deploymentSteps: [] }), { headers: { 'content-type': 'application/json' }, status: 200 })
		},
	})
	try {
		await runGeneratedRuntime('deploymentMaskDecoder')
		await runGeneratedRuntime('interactiveTools')
		const mapping = document.querySelector<HTMLTableSectionElement>('#deployment-status-bit-mapping')
		const sepoliaMapping = document.querySelector<HTMLTableSectionElement>('#sepolia-deployment-status-bit-mapping')
		const input = document.querySelector<HTMLInputElement>('#deployment-mask-input')
		const retry = document.querySelector<HTMLButtonElement>('[data-deployment-mask-retry]')
		const preset = document.querySelector<HTMLButtonElement>('#deployment-mask-decoder .interactive-tool-presets button')
		if (mapping === null || sepoliaMapping === null || input === null || retry === null || preset === null) throw new Error('Deployment failure controls are missing')
		for (let attempt = 0; attempt < 20 && retry.hidden; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
		expect(mapping.textContent).toContain('Unable to load the deployment mapping.')
		expect(sepoliaMapping.textContent).toContain('Unable to load the deployment mapping.')
		expect(mapping.getAttribute('aria-busy')).toBe('false')
		expect(sepoliaMapping.getAttribute('aria-busy')).toBe('false')
		expect(input.disabled).toBeTrue()
		expect(preset.disabled).toBeTrue()
		expect(retry.hidden).toBeFalse()
		expect(retry.disabled).toBeFalse()

		mainnetResponse = 'malformed'
		retry.click()
		expect(mapping.getAttribute('aria-busy')).toBe('true')
		for (let attempt = 0; attempt < 20 && mapping.getAttribute('aria-busy') !== 'false'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
		expect(mapping.textContent).toContain('Unable to load the deployment mapping.')
		expect(mapping.getAttribute('aria-busy')).toBe('false')
		expect(input.disabled).toBeTrue()
		expect(retry.hidden).toBeFalse()
		expect(retry.disabled).toBeFalse()
	} finally {
		if (fetchDescriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch')
		else Object.defineProperty(globalThis, 'fetch', fetchDescriptor)
		cleanup()
	}
})

test('copy status clears on edit and failed clipboard access reveals a focused link', async () => {
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', 'http://localhost/docs/explanation/escalation-game.html')
	const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
	const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
	try {
		await runGeneratedRuntime('interactiveTools')
		const copy = Array.from(document.querySelectorAll<HTMLButtonElement>('#escalation-game-example .interactive-tool-actions button')).find(button => button.textContent === 'Copy scenario link')
		const increment = document.querySelector<HTMLInputElement>('#escalation-game-example [data-example-input="yes"]')
		const status = document.querySelector<HTMLElement>('#escalation-game-example .interactive-tool-status')
		if (copy === undefined || increment === null || status === null) throw new Error('Copy scenario controls are missing')
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
		copy.click()
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(status.textContent).toBe('Scenario link copied.')
		increment.value = '2'
		increment.dispatchEvent(new Event('input', { bubbles: true }))
		expect(status.textContent).toBe('')

		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: async () => {
					throw new DOMException('Clipboard unavailable')
				},
			},
		})
		Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
		copy.click()
		await new Promise(resolve => setTimeout(resolve, 0))
		const recoveryLink = status.querySelector<HTMLAnchorElement>('a')
		expect(status.textContent).toBe('Copy failed. Open scenario link')
		expect(recoveryLink?.href).toContain('tool=escalation-game-example')
		expect(document.activeElement).toBe(recoveryLink)
	} finally {
		if (clipboardDescriptor === undefined) Reflect.deleteProperty(navigator, 'clipboard')
		else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
		if (execCommandDescriptor === undefined) Reflect.deleteProperty(document, 'execCommand')
		else Object.defineProperty(document, 'execCommand', execCommandDescriptor)
		cleanup()
	}
})

test('shared scenarios reject invalid number control values', async () => {
	const state = encodeURIComponent(JSON.stringify({ yes: '101' }))
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', `http://localhost/docs/explanation/escalation-game.html?tool=escalation-game-example&state=${state}`)
	try {
		await runGeneratedRuntime('interactiveTools')
		const alice = document.querySelector<HTMLInputElement>('[data-example-input="yes"]')
		const status = document.querySelector<HTMLElement>('#escalation-game-example .interactive-tool-status')
		if (alice === null || status === null) throw new Error('Interactive truth-auction fixture is missing')
		expect(alice.value).toBe('1')
		expect(alice.hasAttribute('aria-invalid')).toBeFalse()
		expect(status.textContent).toBe('The shared scenario contains invalid values; defaults remain active.')
	} finally {
		cleanup()
	}
})

test('shared scenarios reject unknown segmented-control values without dispatching them', async () => {
	const state = encodeURIComponent(JSON.stringify({ depositOutcome: 'bogus', depositAmount: '4' }))
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', `http://localhost/docs/explanation/escalation-game.html?tool=escalation-game-example&state=${state}`)
	try {
		const outcome = document.querySelector<HTMLSelectElement>('[data-example-input="depositOutcome"]')
		if (outcome === null) throw new Error('Escalation outcome fixture is missing')
		let invalidChangeCount = 0
		outcome.addEventListener('change', () => {
			if (!Array.from(outcome.options).some(option => option.value === outcome.value)) invalidChangeCount += 1
		})
		await runGeneratedRuntime('interactiveTools')
		const status = document.querySelector<HTMLElement>('#escalation-game-example .interactive-tool-status')
		const selectedOutcome = document.querySelector<HTMLButtonElement>('#escalation-game-example .segmented-control button[aria-pressed="true"]')
		const depositAmount = document.querySelector<HTMLInputElement>('[data-example-input="depositAmount"]')
		if (status === null || selectedOutcome === null || depositAmount === null) throw new Error('Escalation shared-state controls are incomplete')
		expect(invalidChangeCount).toBe(0)
		expect(outcome.value).toBe('yes')
		expect(selectedOutcome.textContent).toBe('Yes')
		expect(depositAmount.value).toBe('1')
		expect(status.textContent).toBe('The shared scenario contains invalid values; defaults remain active.')
	} finally {
		cleanup()
	}
})

test('shared scenarios reject out-of-range timeline values before the browser clamps them', async () => {
	const state = encodeURIComponent(JSON.stringify({ days: '999', depositAmount: '4' }))
	const cleanup = await loadDocument('docs/explanation/escalation-game.html', `http://localhost/docs/explanation/escalation-game.html?tool=escalation-game-example&state=${state}`)
	try {
		await runGeneratedRuntime('interactiveTools')
		const days = document.querySelector<HTMLInputElement>('[data-example-input="days"]')
		const depositAmount = document.querySelector<HTMLInputElement>('[data-example-input="depositAmount"]')
		const status = document.querySelector<HTMLElement>('#escalation-game-example .interactive-tool-status')
		if (days === null || depositAmount === null || status === null) throw new Error('Escalation range-state fixture is incomplete')
		expect(days.value).toBe('0')
		expect(depositAmount.value).toBe('1')
		expect(status.textContent).toBe('The shared scenario contains invalid values; defaults remain active.')
	} finally {
		cleanup()
	}
})

for (const scenario of [{ input: 'nonDecisionThreshold', mount: 'fig-statoblast-escalation-cost-curve', name: 'escalation', path: 'docs/explanation/escalation-game.html', tool: 'escalation-game-example' }] as const) {
	test(`quantitative chart resize preserves last-valid ${scenario.name} state`, async () => {
		const cleanup = await loadDocument(scenario.path, `http://localhost/${scenario.path}`)
		const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
		const windowDescriptor = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
		const observers: TestResizeObserver[] = []
		class TestResizeObserver implements ResizeObserver {
			readonly callback: ResizeObserverCallback

			constructor(callback: ResizeObserverCallback) {
				this.callback = callback
				observers.push(this)
			}

			disconnect(): void {}
			observe(): void {}
			unobserve(): void {}
		}
		Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
		Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
		try {
			await runGeneratedRuntime('chartRuntime')
			await runGeneratedRuntime('interactiveTools')
			const tool = document.getElementById(scenario.tool)
			const input = tool?.querySelector<HTMLInputElement>(`[data-example-input="${scenario.input}"]`)
			const mount = document.querySelector<HTMLElement>(`[data-plot-chart="${scenario.mount}"]`)
			if (!(tool instanceof HTMLDetailsElement) || input === null || input === undefined || mount === null) throw new Error(`${scenario.name} resize fixture is incomplete`)
			if (scenario.name === 'escalation') {
				const yesArena = tool.querySelector<HTMLElement>('[data-escalation-arena="yes"]')
				const yesValue = tool.querySelector<HTMLOutputElement>('[data-escalation-arena-value="yes"]')
				const state = tool.querySelector<HTMLOutputElement>('[data-escalation-output="state"]')
				const threshold = tool.querySelector<HTMLInputElement>('[data-example-input="nonDecisionThreshold"]')
				const yes = tool.querySelector<HTMLInputElement>('[data-example-input="yes"]')
				const no = tool.querySelector<HTMLInputElement>('[data-example-input="no"]')
				const outcome = tool.querySelector<HTMLSelectElement>('[data-example-input="depositOutcome"]')
				const deposit = tool.querySelector<HTMLInputElement>('[data-example-input="depositAmount"]')
				const days = tool.querySelector<HTMLInputElement>('[data-example-input="days"]')
				if (yesArena === null || yesValue === null || state === null || threshold === null || yes === null || no === null || outcome === null || deposit === null || days === null) throw new Error('Escalation arena fixture is incomplete')
				expect(yesArena.dataset['selected']).toBe('true')
				expect(yesArena.style.getPropertyValue('--balance-before')).not.toBe('')
				expect(yesArena.style.getPropertyValue('--balance-after')).not.toBe('')
				expect(yesValue.value).toBe('1 → 2 REP')

				threshold.value = '2'
				yes.value = '2'
				no.value = '1'
				outcome.value = 'no'
				deposit.value = '1'
				deposit.dispatchEvent(new Event('input', { bubbles: true }))
				expect(state.value).toBe('non-decision: fork path')

				threshold.value = '10'
				yes.value = '1'
				no.value = '1'
				outcome.value = 'yes'
				days.value = '56'
				days.dispatchEvent(new Event('input', { bubbles: true }))
				expect(state.value).toBe('locally resolvable: Yes')
			}
			input.value = ''
			input.dispatchEvent(new Event('input', { bubbles: true }))
			expect(tool.dataset['inputsValid']).toBe('false')
			if (scenario.name === 'escalation') {
				const state = tool.querySelector<HTMLOutputElement>('[data-escalation-output="state"]')
				const yesArena = tool.querySelector<HTMLElement>('[data-escalation-arena="yes"]')
				const noArena = tool.querySelector<HTMLElement>('[data-escalation-arena="no"]')
				const outcome = tool.querySelector<HTMLSelectElement>('[data-example-input="depositOutcome"]')
				const days = tool.querySelector<HTMLInputElement>('[data-example-input="days"]')
				if (state === null || yesArena === null || noArena === null || outcome === null || days === null) throw new Error('Escalation invalid-state fixture is incomplete')
				const lastValidState = state.value
				const lastValidYesSelection = yesArena.dataset['selected']

				days.value = '0'
				days.dispatchEvent(new Event('input', { bubbles: true }))
				outcome.value = 'no'
				outcome.dispatchEvent(new Event('input', { bubbles: true }))
				expect(state.value).toBe(lastValidState)
				expect(yesArena.dataset['selected']).toBe(lastValidYesSelection)
				expect(noArena.dataset['selected']).toBe('false')

				input.value = '10'
				input.dispatchEvent(new Event('input', { bubbles: true }))
				expect(tool.dataset['inputsValid']).toBeUndefined()
				expect(state.value).toBe('activation pending')
				expect(yesArena.dataset['selected']).toBe('false')
				expect(noArena.dataset['selected']).toBe('true')
				input.value = ''
				input.dispatchEvent(new Event('input', { bubbles: true }))
				expect(tool.dataset['inputsValid']).toBe('false')
			}
			mount.dataset['renderedChartWidth'] = '0'
			for (const observer of observers) observer.callback([], observer)
			await new Promise(resolve => setTimeout(resolve, 20))
			expect(mount.dataset['renderedChartWidth']).toBe('0')
		} finally {
			if (globalDescriptor === undefined) Reflect.deleteProperty(globalThis, 'ResizeObserver')
			else Object.defineProperty(globalThis, 'ResizeObserver', globalDescriptor)
			if (windowDescriptor === undefined) Reflect.deleteProperty(window, 'ResizeObserver')
			else Object.defineProperty(window, 'ResizeObserver', windowDescriptor)
			cleanup()
		}
	})
}
