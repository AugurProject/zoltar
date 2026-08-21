import { afterEach, describe, expect, test } from 'bun:test'
import { Browser } from 'happy-dom'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'

const servers: ReturnType<typeof startDashboardServer>[] = []
const browsers: Browser[] = []

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	for (const browser of browsers.splice(0)) await browser.close()
})

type PendingTransaction = {
	hash: string
	kind: string
	label: string
	maxBlockNumber: string
	mode: 'private' | 'public'
	nonce: string
	requiresMarketEvidence: boolean
	submissionBlock: string
}

type DashboardUniverse = {
	approved: boolean
	forkedPoolCount: number
	forkQuestionId: string
	forkTime: string
	id: string
	migratableVaultCount: number
	operationalPoolCount: number
	outcomeIndex?: string
	parentId?: string
	poolCount: number
	repToken: string
	selectedPoolCount: number
}

type DashboardConfiguration = {
	approvedUniverses: string[]
	centralizedMarkets: unknown
	childMarketConfigurations: unknown[]
	connectivity?: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string }
	desiredPools: unknown[]
	network?: { chainId: number; explorerUrl: string; name: 'mainnet' | 'sepolia' }
	networkConfigured?: boolean
	runtime: { historicalLogRecovery: boolean; logLookbackBlocks: number }
	selectedPools: string[]
	strategy: Record<string, string | number | boolean>
}

function universe(id: string, parentId?: string, outcomeIndex?: string): DashboardUniverse {
	return {
		approved: true,
		forkedPoolCount: 0,
		forkQuestionId: '7',
		forkTime: '0',
		id,
		migratableVaultCount: 0,
		operationalPoolCount: 1,
		...(outcomeIndex === undefined ? {} : { outcomeIndex }),
		...(parentId === undefined ? {} : { parentId }),
		poolCount: 1,
		repToken: '0x3',
		selectedPoolCount: 1,
	}
}

function configuration(approvedUniverses = ['1'], network?: DashboardConfiguration['network']): DashboardConfiguration {
	return {
		approvedUniverses,
		centralizedMarkets: {},
		childMarketConfigurations: [],
		desiredPools: [],
		network: network ?? { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' },
		networkConfigured: network !== undefined,
		runtime: { historicalLogRecovery: false, logLookbackBlocks: 256 },
		selectedPools: ['0x1111111111111111111111111111111111111111'],
		strategy: {},
	}
}

function mainnetConfiguration(approvedUniverses = ['1']) {
	return configuration(approvedUniverses, { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' })
}

function state(
	error?: string,
	alerts: { message: string; severity: 'error' | 'warning' }[] = [],
	options: {
		execute?: boolean
		lastScannedBlock?: string
		lastScannedTimestamp?: string
		network?: 'mainnet' | 'sepolia'
		paused?: boolean
		pendingStagedOperations?: { candidateBlock?: string; coordinator: string; historicalRecoveryComplete: boolean; latestRecoveryBlock?: string; nextHistoricalBlock?: string; operationId: string; queuedBlock: string; target: string }[]
		pendingTransactions?: PendingTransaction[]
		rpcEndpointHealth?: { consecutiveFailures: number; latencyMilliseconds?: number; status: string; target: string }[]
		universes?: DashboardUniverse[]
	} = {},
) {
	return {
		activities: [],
		alerts,
		error,
		execute: options.execute ?? false,
		lastScannedBlock: options.lastScannedBlock,
		lastScannedTimestamp: options.lastScannedTimestamp,
		metrics: {
			approvedUniverseCount: 1,
			assumedOpenInterestEth: '0',
			candidateCount: 0,
			deployedRep: '0',
			eligiblePoolCount: 1,
			poolCount: 1,
			selectedPoolCount: 1,
			walletEth: '1',
			walletRep: '2',
		},
		network: options.network ?? 'mainnet',
		paused: options.paused ?? false,
		pendingStagedOperations: options.pendingStagedOperations ?? [],
		pendingTransactions: options.pendingTransactions ?? [],
		rpcEndpointHealth: options.rpcEndpointHealth ?? [],
		pools: [
			{
				knownVaultCount: '0',
				address: '0x1111111111111111111111111111111111111111',
				approvedUniverse: true,
				botVault: { address: '0x2', capacityOwnershipRep: '0', openInterestDisplay: '0', vaultRepBacking: '0', claimableFeesEth: '0' },
				candidateCount: 0,
				settlementCollateralEth: '0',
				centralizedPriceAllowed: true,
				isPriceValid: true,
				lastPrice: '1',
				multiplierBps: '10000',
				questionId: '7',
				selected: true,
				systemState: '0',
				totalCapacityOwnershipRep: '0',
				totalPoolHeldRep: '0',
				truncatedVaults: false,
				universeId: '1',
			},
		],
		scanning: false,
		status: 'running',
		marketSources: [],
		universes: options.universes ?? [universe('1')],
	}
}

async function dashboard(initialConfiguration = mainnetConfiguration(), initialState = state('rpc secret at /api/internal'), initialStateRequestFailure = false, initialConfigurationRequestFailure = false) {
	const server = startDashboardServer(0, {
		getConfiguration: () => ({}),
		getState: () => ({}),
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setApprovedUniverses: value => value,
		setPaused: value => value,
		setSelectedPools: value => value,
		setSigner: value => value,
		setStrategy: value => value,
	})
	servers.push(server)
	const browser = new Browser({
		settings: {
			enableJavaScriptEvaluation: true,
			suppressInsecureJavaScriptEnvironmentWarning: true,
		},
	})
	browsers.push(browser)
	const page = browser.newPage()
	page.url = server.url.href
	page.content = (await (await fetch(server.url)).text()).replace('<script type="module" src="/dashboard.js"></script>', '')
	const window = page.mainFrame.window
	Reflect.set(window, 'Boolean', Boolean)
	Reflect.set(window, 'Date', Date)
	Reflect.set(window, 'AbortController', AbortController)
	Reflect.set(window, 'Map', Map)
	Reflect.set(window, 'Set', Set)
	Reflect.set(window, 'JSON', JSON)
	Reflect.set(window, 'Error', Error)
	Reflect.set(window, 'Math', Math)
	Reflect.set(window, 'Number', Number)
	Reflect.set(window, 'Object', Object)
	Reflect.set(window, 'Promise', Promise)
	Reflect.set(window, 'Reflect', Reflect)
	Reflect.set(window, 'String', String)
	Reflect.set(window, 'decodeURIComponent', decodeURIComponent)
	const refreshCallbacks: (() => unknown)[] = []
	window.setInterval = handler => {
		if (typeof handler === 'function') refreshCallbacks.push(() => handler())
		const timeout = window.setTimeout(() => undefined, 1)
		window.clearTimeout(timeout)
		return timeout
	}
	let snapshot = initialState
	let currentConfiguration = initialConfiguration
	let pendingProfileConfiguration: DashboardConfiguration | undefined
	let staleProfilePolls = 0
	let configurationRequestFailure = initialConfigurationRequestFailure
	let rejectPause = false
	const pauseRequests: unknown[] = []
	const approvedUniverseRequests: string[][] = []
	const selectedPoolRequests: string[][] = []
	let stateRequestCount = 0
	let stateRequestFailure = initialStateRequestFailure
	let hangNextStateRequest = false
	let releaseStateRequest: (() => void) | undefined
	let releasePauseRequest: (() => void) | undefined
	let releaseMarketSourceRequest: (() => void) | undefined
	let releaseApprovedUniverseRequest: (() => void) | undefined
	let releaseSelectedPoolRequest: (() => void) | undefined
	window.fetch = async (input, init) => {
		const inputUrl = typeof input === 'string' ? input : input instanceof window.URL ? input.href : Reflect.get(input, 'url')
		if (typeof inputUrl !== 'string') throw new Error('Unexpected request URL')
		const url = new URL(inputUrl, server.url)
		if (url.pathname === '/api/configuration') {
			if (configurationRequestFailure) return new window.Response(JSON.stringify({ error: 'configuration fixture unavailable' }), { headers: { 'content-type': 'application/json' }, status: 503 })
			if (pendingProfileConfiguration !== undefined) {
				if (staleProfilePolls === 0) {
					currentConfiguration = pendingProfileConfiguration
					pendingProfileConfiguration = undefined
					snapshot = { ...snapshot, network: 'sepolia' }
				} else staleProfilePolls -= 1
			}
			return new window.Response(JSON.stringify(currentConfiguration), {
				headers: { 'content-type': 'application/json' },
			})
		}
		if (url.pathname === '/api/state') {
			stateRequestCount += 1
			const capturedSnapshot = snapshot
			if (hangNextStateRequest) {
				hangNextStateRequest = false
				return await new Promise<InstanceType<typeof window.Response>>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new Error('fixture state request aborted')), { once: true })
				})
			}
			if (releaseStateRequest !== undefined) await new Promise<void>(resolve => (releaseStateRequest = resolve))
			if (stateRequestFailure) return new window.Response(JSON.stringify({ error: 'state fixture unavailable' }), { headers: { 'content-type': 'application/json' }, status: 503 })
			return new window.Response(JSON.stringify(capturedSnapshot), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/test-market-sources') {
			if (releaseMarketSourceRequest !== undefined) await new Promise<void>(resolve => (releaseMarketSourceRequest = resolve))
			return new window.Response(JSON.stringify({ assets: [{ assetId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sources: [{ id: 'uniswap-v2', kind: 'dex', market: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', status: 'observed' }] }], blockNumber: '42' }), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/paused' && rejectPause) {
			return new window.Response(JSON.stringify({ error: 'Fixture rejected /api/paused with secret' }), { headers: { 'content-type': 'application/json' }, status: 400 })
		}
		if (url.pathname === '/api/approved-universes') {
			const approved: unknown = JSON.parse(String(init?.body))
			if (!Array.isArray(approved)) throw new Error('Unexpected approved-universe request')
			const approvedValues: string[] = []
			for (const value of approved) {
				if (typeof value !== 'string') throw new Error('Unexpected approved-universe request')
				approvedValues.push(value)
			}
			approvedUniverseRequests.push(approvedValues)
			if (releaseApprovedUniverseRequest !== undefined) await new Promise<void>(resolve => (releaseApprovedUniverseRequest = resolve))
			currentConfiguration = { ...currentConfiguration, approvedUniverses: approvedValues }
			return new window.Response(JSON.stringify(currentConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/selected-pools') {
			const selected: unknown = JSON.parse(String(init?.body))
			if (!Array.isArray(selected) || selected.some(value => typeof value !== 'string')) throw new Error('Unexpected selected-pool request')
			const selectedValues = selected.map(String)
			selectedPoolRequests.push(selectedValues)
			if (releaseSelectedPoolRequest !== undefined) await new Promise<void>(resolve => (releaseSelectedPoolRequest = resolve))
			currentConfiguration = { ...currentConfiguration, selectedPools: selectedValues }
			return new window.Response(JSON.stringify(currentConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/network-connectivity') {
			currentConfiguration = {
				...currentConfiguration,
				connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'https://sepolia.example' },
				network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
				networkConfigured: true,
			}
			return new window.Response(JSON.stringify(currentConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/network-profile') {
			snapshot = { ...snapshot, network: 'sepolia' }
			pendingProfileConfiguration = {
				...currentConfiguration,
				connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: '' },
				network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
				networkConfigured: false,
			}
			return new window.Response(JSON.stringify(pendingProfileConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/paused') {
			const request: unknown = JSON.parse(String(init?.body))
			pauseRequests.push(request)
			if (releasePauseRequest !== undefined) await new Promise<void>(resolve => (releasePauseRequest = resolve))
		}
		return new window.Response('{}', { headers: { 'content-type': 'application/json' } })
	}
	page.evaluate(await (await fetch(new URL('/dashboard.js', server.url))).text())
	await page.waitUntilComplete()
	const refresh = refreshCallbacks[0]
	if (refresh === undefined) throw new Error('Dashboard did not register its refresh interval')
	const blockTick = refreshCallbacks[1]
	if (blockTick === undefined) throw new Error('Dashboard did not register its block-age interval')
	return {
		blockTick,
		refresh: async () => {
			await refresh()
			await page.waitUntilComplete()
		},
		rejectPause: (reject: boolean) => {
			rejectPause = reject
		},
		setSnapshot: (next: ReturnType<typeof state>) => {
			snapshot = next
		},
		approvedUniverseRequests,
		selectedPoolRequests,
		pauseRequests,
		stateRequestCount: () => stateRequestCount,
		setStateRequestFailure: (failed: boolean) => {
			stateRequestFailure = failed
		},
		setConfigurationRequestFailure: (failed: boolean) => {
			configurationRequestFailure = failed
		},
		setStaleProfilePolls: (count: number) => {
			staleProfilePolls = count
		},
		hangNextStateRequest: () => {
			hangNextStateRequest = true
		},
		suspendNextStateRequest: () => {
			releaseStateRequest = () => undefined
		},
		releaseStateRequest: () => {
			const release = releaseStateRequest
			releaseStateRequest = undefined
			release?.()
		},
		suspendNextPauseRequest: () => {
			releasePauseRequest = () => undefined
		},
		releasePauseRequest: () => {
			const release = releasePauseRequest
			releasePauseRequest = undefined
			release?.()
		},
		suspendNextMarketSourceRequest: () => {
			releaseMarketSourceRequest = () => undefined
		},
		releaseMarketSourceRequest: () => {
			const release = releaseMarketSourceRequest
			releaseMarketSourceRequest = undefined
			release?.()
		},
		suspendNextApprovedUniverseRequest: () => {
			releaseApprovedUniverseRequest = () => undefined
		},
		releaseApprovedUniverseRequest: () => {
			const release = releaseApprovedUniverseRequest
			releaseApprovedUniverseRequest = undefined
			release?.()
		},
		suspendNextSelectedPoolRequest: () => {
			releaseSelectedPoolRequest = () => undefined
		},
		releaseSelectedPoolRequest: () => {
			const release = releaseSelectedPoolRequest
			releaseSelectedPoolRequest = undefined
			release?.()
		},
		window,
		waitUntilComplete: () => page.waitUntilComplete(),
	}
}

describe('liquidator dashboard refresh behavior', () => {
	test('shows the current block and when it appeared', async () => {
		const nowSeconds = Math.floor(Date.now() / 1_000)
		const page = await dashboard(configuration(), state(undefined, [], { lastScannedBlock: '12345678', lastScannedTimestamp: (nowSeconds - 12).toString() }))
		await page.refresh()
		await page.blockTick()
		expect(page.window.document.getElementById('block-status')?.textContent).toMatch(/^Block 12345678 · seen 1[23]s ago$/)
	})

	test('provides a durable manual refresh action across success and failure', async () => {
		const page = await dashboard()
		const refreshButton = page.window.document.getElementById('refresh-button')
		if (!(refreshButton instanceof page.window.HTMLButtonElement)) throw new Error('Expected refresh control')
		const before = page.stateRequestCount()

		refreshButton.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.stateRequestCount()).toBe(before + 1)
		expect(refreshButton.disabled).toBe(false)
		expect(refreshButton.textContent).toBe('Refresh')
		expect(refreshButton.hasAttribute('aria-busy')).toBe(false)

		page.setStateRequestFailure(true)
		refreshButton.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.stateRequestCount()).toBe(before + 2)
		expect(refreshButton.disabled).toBe(false)
		expect(refreshButton.textContent).toBe('Refresh')
		expect(page.window.document.getElementById('run-status-badge')?.textContent).toBe('Disconnected')
	})

	test('keeps a run-state mutation single-flight across an intervening successful poll', async () => {
		const page = await dashboard(mainnetConfiguration(), state())
		const pauseButton = page.window.document.getElementById('pause-button')
		if (!(pauseButton instanceof page.window.HTMLButtonElement)) throw new Error('Expected pause control')
		page.suspendNextPauseRequest()

		pauseButton.click()
		await Bun.sleep(1)
		expect(page.pauseRequests).toEqual([{ paused: true }])
		expect(pauseButton.disabled).toBe(true)
		expect(pauseButton.textContent).toBe('Pausing…')
		expect(pauseButton.getAttribute('aria-busy')).toBe('true')

		await page.refresh()
		expect(pauseButton.disabled).toBe(true)
		expect(pauseButton.textContent).toBe('Pausing…')
		pauseButton.click()
		expect(page.pauseRequests).toHaveLength(1)

		page.setSnapshot(state(undefined, [], { paused: true }))
		page.releasePauseRequest()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(pauseButton.disabled).toBe(false)
		expect(pauseButton.textContent).toBe('Resume')
		expect(pauseButton.hasAttribute('aria-busy')).toBe(false)
	})

	test('makes initial and post-success state request failures explicit and recovers', async () => {
		const mainnet = { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' as const }
		const initialFailure = await dashboard(configuration(['1'], mainnet), state(), true)
		expect(initialFailure.window.document.getElementById('mode-badge')?.textContent).toBe('Mode unavailable')
		expect(initialFailure.window.document.getElementById('network-badge')?.textContent).toBe('Mainnet · chain 1 · unverified')
		expect(initialFailure.window.document.getElementById('run-status-badge')?.textContent).toBe('Disconnected')
		expect(initialFailure.window.document.getElementById('attention-badge')?.textContent).toBe('1 action')
		expect(initialFailure.window.document.getElementById('attention-badge')?.getAttribute('href')).toBe('/overview#global-error')
		expect(initialFailure.window.document.getElementById('pause-button')?.hasAttribute('disabled')).toBe(true)
		expect(initialFailure.window.document.getElementById('global-error')?.textContent).toContain('Automatic retry is active')
		expect(initialFailure.window.document.body.textContent).not.toContain('state fixture unavailable')

		const recovered = await dashboard(configuration(['1'], mainnet), state())
		recovered.setStateRequestFailure(true)
		await recovered.refresh()
		expect(recovered.window.document.getElementById('mode-badge')?.textContent).toBe('Dry run · last known')
		expect(recovered.window.document.getElementById('network-badge')?.textContent).toBe('Mainnet · chain 1 · last known')
		expect(recovered.window.document.getElementById('run-status-badge')?.textContent).toBe('Disconnected')
		expect(recovered.window.document.getElementById('attention-badge')?.textContent).toBe('1 action')
		expect(recovered.window.document.getElementById('pause-button')?.hasAttribute('disabled')).toBe(false)
		const stalePause = recovered.window.document.getElementById('pause-button')
		if (!(stalePause instanceof recovered.window.HTMLButtonElement)) throw new Error('Expected stale-state pause control')
		stalePause.click()
		await recovered.waitUntilComplete()
		expect(recovered.pauseRequests).toContainEqual({ paused: true })
		recovered.setStateRequestFailure(false)
		await recovered.refresh()
		expect(recovered.window.document.getElementById('mode-badge')?.textContent).toBe('Dry run')
		expect(recovered.window.document.getElementById('network-badge')?.textContent).toBe('Mainnet · chain 1')
		expect(recovered.window.document.getElementById('run-status-badge')?.textContent).toBe('Running')
		expect(recovered.window.document.getElementById('attention-badge')?.textContent).toBe('No blockers')
		expect(recovered.window.document.getElementById('pause-button')?.hasAttribute('disabled')).toBe(false)
		expect(recovered.window.document.getElementById('global-error')?.classList.contains('hidden')).toBe(true)
	})

	test('keeps emergency Pause available while identity-dependent controls fail closed', async () => {
		const page = await dashboard(configuration(['1'], { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }), state())
		page.setStateRequestFailure(true)
		const pauseButton = page.window.document.getElementById('pause-button')
		if (!(pauseButton instanceof page.window.HTMLButtonElement)) throw new Error('Expected pause control')
		pauseButton.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(pauseButton.disabled).toBe(false)
		for (const id of ['network-fields', 'market-configuration-fields', 'strategy-fields', 'clear-signer']) {
			const control = page.window.document.getElementById(id)
			expect(control?.hasAttribute('disabled')).toBe(true)
		}
		const signerInput = page.window.document.querySelector('#signer-form input[name="privateKey"]')
		const poolInput = page.window.document.querySelector('#pool-rows input')
		const universeInput = page.window.document.querySelector('#universe-rows input')
		if (!(signerInput instanceof page.window.HTMLInputElement) || !(poolInput instanceof page.window.HTMLInputElement) || !(universeInput instanceof page.window.HTMLInputElement)) throw new Error('Expected mutation controls')
		expect(signerInput.disabled).toBe(true)
		expect(poolInput.disabled).toBe(true)
		expect(universeInput.disabled).toBe(true)

		page.setStateRequestFailure(false)
		await page.refresh()
		expect(pauseButton.disabled).toBe(false)
		expect(page.window.document.getElementById('network-fields')?.hasAttribute('disabled')).toBe(false)
		expect(page.window.document.getElementById('market-configuration-fields')?.hasAttribute('disabled')).toBe(false)
		expect(page.window.document.getElementById('strategy-fields')?.hasAttribute('disabled')).toBe(false)
		expect(page.window.document.getElementById('clear-signer')?.hasAttribute('disabled')).toBe(false)
		expect(signerInput.disabled).toBe(false)
		const recoveredPoolInput = page.window.document.querySelector('#pool-rows input')
		const recoveredUniverseInput = page.window.document.querySelector('#universe-rows input')
		if (!(recoveredPoolInput instanceof page.window.HTMLInputElement) || !(recoveredUniverseInput instanceof page.window.HTMLInputElement)) throw new Error('Expected recovered mutation controls')
		expect(recoveredPoolInput.disabled).toBe(false)
		expect(recoveredUniverseInput.disabled).toBe(false)
	})

	test('keeps network identity visible and updates it after configuration', async () => {
		const unconfigured = await dashboard(configuration(), state())
		expect(unconfigured.window.document.getElementById('network-badge')?.textContent).toBe('RPC setup required')
		expect(unconfigured.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Ethereum mainnet profile')
		expect(unconfigured.window.document.getElementById('network-scope-summary')?.textContent).toContain('Ethereum mainnet profile')
		expect(unconfigured.window.document.getElementById('network-fields')?.hasAttribute('disabled')).toBe(false)
		for (const id of ['market-configuration-fields', 'strategy-fields']) expect(unconfigured.window.document.getElementById(id)?.hasAttribute('disabled')).toBe(true)
		const signerInput = unconfigured.window.document.querySelector('#signer-form input[name="privateKey"]')
		const poolInput = unconfigured.window.document.querySelector('#pool-rows input')
		const universeInput = unconfigured.window.document.querySelector('#universe-rows input')
		if (!(signerInput instanceof unconfigured.window.HTMLInputElement) || !(poolInput instanceof unconfigured.window.HTMLInputElement) || !(universeInput instanceof unconfigured.window.HTMLInputElement)) throw new Error('Expected chain-specific settings controls')
		expect(signerInput.disabled).toBe(true)
		expect(poolInput.disabled).toBe(true)
		expect(universeInput.disabled).toBe(true)
		const attention = unconfigured.window.document.getElementById('attention-badge')
		expect(attention?.textContent).toBe('1 action')
		expect(attention?.getAttribute('href')).toBe('/settings#network-connectivity')
		if (!(attention instanceof unconfigured.window.HTMLAnchorElement)) throw new Error('Expected network-setup attention action')
		const networkForm = unconfigured.window.document.getElementById('network-form')
		const networkName = unconfigured.window.document.getElementById('network-name')
		const readRpcUrl = unconfigured.window.document.getElementById('read-rpc-url')
		const publicRpcUrls = unconfigured.window.document.getElementById('public-rpc-urls')
		if (!(networkForm instanceof unconfigured.window.HTMLFormElement) || !(networkName instanceof unconfigured.window.HTMLSelectElement) || !(readRpcUrl instanceof unconfigured.window.HTMLInputElement) || !(publicRpcUrls instanceof unconfigured.window.HTMLTextAreaElement)) {
			throw new Error('Expected network configuration controls')
		}
		networkName.value = 'sepolia'
		readRpcUrl.value = 'https://sepolia.example'
		publicRpcUrls.value = 'https://sepolia.example'
		networkForm.dispatchEvent(new unconfigured.window.Event('submit', { bubbles: true, cancelable: true }))
		await unconfigured.waitUntilComplete()
		await Bun.sleep(1)
		expect({
			attention: unconfigured.window.document.getElementById('attention-badge')?.textContent,
			badge: unconfigured.window.document.getElementById('network-badge')?.textContent,
			status: unconfigured.window.document.getElementById('network-status')?.textContent,
		}).toEqual({ attention: 'No blockers', badge: 'Sepolia · chain 11155111', status: 'Chain and RPCs passed validation, were saved, and apply to the next scan.' })
		expect(unconfigured.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Sepolia profile')
		expect(unconfigured.window.document.getElementById('network-scope-summary')?.textContent).toBe('Sepolia profile · switchable')
		expect(networkName.disabled).toBe(false)
		for (const id of ['market-configuration-fields', 'strategy-fields']) expect(unconfigured.window.document.getElementById(id)?.hasAttribute('disabled')).toBe(false)
		expect(signerInput.disabled).toBe(false)

		const mainnet = await dashboard(configuration(['1'], { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }), state())
		expect(mainnet.window.document.getElementById('network-badge')?.textContent).toBe('Mainnet · chain 1')
	})

	test('keeps the requested chain locked and visible while stale profile polls drain', async () => {
		const page = await dashboard(mainnetConfiguration(), state(undefined, [], { rpcEndpointHealth: [{ consecutiveFailures: 0, latencyMilliseconds: 84, status: 'healthy', target: 'https://mainnet.example' }] }))
		page.setStaleProfilePolls(3)
		const networkName = page.window.document.getElementById('network-name')
		const networkFields = page.window.document.getElementById('network-fields')
		const strategyFields = page.window.document.getElementById('strategy-fields')
		if (!(networkName instanceof page.window.HTMLSelectElement) || !(networkFields instanceof page.window.HTMLFieldSetElement) || !(strategyFields instanceof page.window.HTMLFieldSetElement)) throw new Error('Expected chain-profile controls')
		expect(page.window.document.getElementById('rpc-endpoint-health')?.children).toHaveLength(1)
		const testSources = page.window.document.getElementById('test-market-sources')
		if (!(testSources instanceof page.window.HTMLButtonElement)) throw new Error('Expected source test control')
		page.suspendNextMarketSourceRequest()
		testSources.click()
		await Bun.sleep(10)

		page.suspendNextStateRequest()
		const staleStateRefresh = page.refresh()
		await Bun.sleep(10)
		networkName.value = 'sepolia'
		networkName.dispatchEvent(new page.window.Event('change', { bubbles: true }))
		await Bun.sleep(50)
		expect(networkName.value).toBe('sepolia')
		expect(networkFields.disabled).toBe(true)
		expect(strategyFields.disabled).toBe(true)
		expect(page.window.document.getElementById('network-status')?.textContent).toBe('Profile saved. The bot is switching chains in place; settings will reload automatically.')
		expect(page.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Ethereum mainnet profile')
		expect(page.window.document.getElementById('market-source-rows')?.textContent).not.toContain('Observed')
		expect(page.window.document.getElementById('market-source-caption')?.textContent).toBe('Configured source admission')
		expect(page.window.document.getElementById('show-active-admission')?.classList.contains('hidden')).toBe(true)
		page.releaseMarketSourceRequest()
		await Bun.sleep(20)
		expect(page.window.document.getElementById('market-source-rows')?.textContent).not.toContain('Observed')
		expect(page.window.document.getElementById('market-source-caption')?.textContent).toBe('Configured source admission')
		expect(page.window.document.getElementById('show-active-admission')?.classList.contains('hidden')).toBe(true)

		page.releaseStateRequest()
		await Bun.sleep(20)
		expect(networkName.value).toBe('sepolia')
		await staleStateRefresh
		await Bun.sleep(1_600)
		expect(networkName.value).toBe('sepolia')
		expect(networkFields.disabled).toBe(false)
		expect(strategyFields.disabled).toBe(true)
		expect(page.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Sepolia profile')
		expect(page.window.document.getElementById('network-status')?.textContent).toBe('Sepolia profile loaded; RPC setup required.')
		expect(page.window.document.getElementById('rpc-endpoint-health')?.children).toHaveLength(0)
	})

	test('keeps resume locked when configuration and network identity are unavailable', async () => {
		const page = await dashboard(configuration(), state(undefined, [], { execute: true, paused: true }), false, true)
		const pauseButton = page.window.document.getElementById('pause-button')
		const confirmResume = page.window.document.getElementById('confirm-resume')
		if (!(pauseButton instanceof page.window.HTMLButtonElement) || !(confirmResume instanceof page.window.HTMLButtonElement)) throw new Error('Expected resume controls')

		expect(page.window.document.getElementById('network-badge')?.textContent).toBe('Network unavailable')
		expect(pauseButton.textContent).toBe('Resume')
		expect(pauseButton.disabled).toBe(true)
		expect(confirmResume.disabled).toBe(true)
		pauseButton.click()
		expect(page.pauseRequests).toHaveLength(0)
	})

	test('prunes approved descendants when changing or clearing a truth path', async () => {
		const universes = [universe('1'), universe('2', '1', '1'), universe('3', '1', '2'), universe('4', '2', '1')]
		const siblingPage = await dashboard(mainnetConfiguration(['1', '2', '4']), state(undefined, [], { universes }))
		const legend = siblingPage.window.document.querySelector('.truth-options legend')
		expect(legend?.firstChild?.textContent).toBe('Truth outcome')
		expect(legend?.textContent).toBe('Truth outcome for universe #1')
		const sibling = siblingPage.window.document.querySelector('input[value="3"]')
		if (!(sibling instanceof siblingPage.window.HTMLInputElement)) throw new Error('Expected sibling truth control')
		sibling.click()
		await siblingPage.waitUntilComplete()
		await Bun.sleep(1)
		expect(siblingPage.approvedUniverseRequests.at(-1)?.sort()).toEqual(['1', '3'])

		const nonePage = await dashboard(mainnetConfiguration(['1', '2', '4']), state(undefined, [], { universes }))
		const none = nonePage.window.document.querySelector('input[data-record-key="universe:none:1"]')
		if (!(none instanceof nonePage.window.HTMLInputElement)) throw new Error('Expected no-child truth control')
		none.click()
		await nonePage.waitUntilComplete()
		await Bun.sleep(1)
		expect(nonePage.approvedUniverseRequests.at(-1)).toEqual(['1'])
	})

	test('switches a nested truth selection across the complete ancestor path', async () => {
		const universes = [universe('1'), universe('2', '1', '1'), universe('3', '1', '2'), universe('4', '2', '1'), universe('5', '3', '1')]
		const page = await dashboard(mainnetConfiguration(['1', '2', '4']), state(undefined, [], { universes }))
		const destination = page.window.document.querySelector('input[value="5"]')
		if (!(destination instanceof page.window.HTMLInputElement)) throw new Error('Expected nested truth control')

		destination.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)

		expect(page.approvedUniverseRequests.at(-1)?.sort()).toEqual(['1', '3', '5'])
	})

	test('serializes full-set universe and pool selection mutations', async () => {
		const universes = [universe('1'), universe('2', '1', '1'), universe('3', '1', '2')]
		const universePage = await dashboard(mainnetConfiguration(['1']), state(undefined, [], { universes }))
		universePage.suspendNextApprovedUniverseRequest()
		const firstUniverse = universePage.window.document.querySelector('input[value="2"]')
		const secondUniverse = universePage.window.document.querySelector('input[value="3"]')
		if (!(firstUniverse instanceof universePage.window.HTMLInputElement) || !(secondUniverse instanceof universePage.window.HTMLInputElement)) throw new Error('Expected universe controls')
		firstUniverse.click()
		await Bun.sleep(1)
		expect(secondUniverse.disabled).toBe(true)
		secondUniverse.click()
		expect(universePage.approvedUniverseRequests).toHaveLength(1)
		universePage.releaseApprovedUniverseRequest()
		await universePage.waitUntilComplete()
		await Bun.sleep(1)
		expect(universePage.approvedUniverseRequests).toEqual([['1', '2']])

		const poolSnapshot = state()
		const firstPool = poolSnapshot.pools[0]
		if (firstPool === undefined) throw new Error('Expected pool fixture')
		poolSnapshot.pools.push({ ...firstPool, address: '0x2222222222222222222222222222222222222222', selected: false })
		const poolPage = await dashboard(mainnetConfiguration(), poolSnapshot)
		poolPage.suspendNextSelectedPoolRequest()
		const firstPoolControl = poolPage.window.document.querySelector('input[data-record-key="pool:0x1111111111111111111111111111111111111111"]')
		const secondPoolControl = poolPage.window.document.querySelector('input[data-record-key="pool:0x2222222222222222222222222222222222222222"]')
		if (!(firstPoolControl instanceof poolPage.window.HTMLInputElement) || !(secondPoolControl instanceof poolPage.window.HTMLInputElement)) throw new Error('Expected pool controls')
		firstPoolControl.click()
		await Bun.sleep(1)
		expect(secondPoolControl.disabled).toBe(true)
		secondPoolControl.click()
		expect(poolPage.selectedPoolRequests).toHaveLength(1)
		poolPage.releaseSelectedPoolRequest()
		await poolPage.waitUntilComplete()
		await Bun.sleep(1)
		expect(poolPage.selectedPoolRequests).toEqual([[]])
	})

	test('turns a scan-only error into an actionable blocker', async () => {
		const page = await dashboard(configuration(['1'], { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }), state('read RPC stalled'))
		expect(page.window.document.getElementById('run-status-badge')?.textContent).toBe('Error')
		expect(page.window.document.getElementById('attention-badge')?.textContent).toBe('1 action')
		const action = page.window.document.querySelector('#attention-badge[href="/overview#global-error"]')
		expect(action?.textContent).toBe('1 action')
		if (!(action instanceof page.window.HTMLAnchorElement)) throw new Error('Expected scan-error action')
		const globalError = page.window.document.getElementById('global-error')
		expect(globalError?.textContent).toContain('RPC connectivity or chain reads failed.')
		expect(globalError?.textContent).toContain('Automatic retry is active.')
		expect(globalError?.textContent).not.toContain('read RPC stalled')
		expect(page.window.document.getElementById('operator-alerts')?.classList.contains('hidden')).toBe(true)
	})

	test('surfaces an incomplete vault registry scan', async () => {
		const page = await dashboard()
		const rootUniverseToggle = page.window.document.querySelector('.truth-root-toggle input[type="checkbox"]')
		expect(rootUniverseToggle?.getAttribute('aria-label')).toBe('Approve root universe 1')
		const snapshot = state()
		const [pool] = snapshot.pools
		if (pool === undefined) throw new Error('Expected pool snapshot')
		pool.truncatedVaults = true
		page.setSnapshot(snapshot)

		await page.refresh()

		expect(page.window.document.body.textContent).toContain('Vault scan capped')
	})

	test('serializes overlapping polling refreshes and preserves one trailing request', async () => {
		const page = await dashboard()
		const before = page.stateRequestCount()
		page.suspendNextStateRequest()
		const first = page.refresh()
		const second = page.refresh()
		await Bun.sleep(1)
		expect(page.stateRequestCount()).toBe(before + 1)
		page.releaseStateRequest()
		await Promise.all([first, second])
		expect(page.stateRequestCount()).toBe(before + 2)
	})

	test('fails closed when a state request never resolves', async () => {
		const page = await dashboard(configuration(), state(undefined, [], { execute: true }))
		page.hangNextStateRequest()
		const outcome = await Promise.race([page.refresh().then(() => 'completed'), Bun.sleep(1_500).then(() => 'timed-out')])

		expect(outcome).toBe('completed')
		expect(page.window.document.getElementById('run-status-badge')?.textContent).toBe('Disconnected')
		expect(page.window.document.getElementById('pause-button')?.hasAttribute('disabled')).toBe(false)
		expect(page.window.document.getElementById('resume-dialog')?.hasAttribute('open')).toBe(false)
	})

	test('preserves focused controls and expanded pool addresses across polling', async () => {
		const page = await dashboard()
		const checkbox = page.window.document.querySelector('[data-record-key^="pool:"]')
		const details = page.window.document.querySelector('details[data-pool-address]')
		if (!(checkbox instanceof page.window.HTMLInputElement) || !(details instanceof page.window.HTMLDetailsElement)) throw new Error('Expected pool controls')
		const recordKey = checkbox.getAttribute('data-record-key')
		checkbox.focus()
		details.open = true

		page.setSnapshot(state())
		await page.refresh()
		await page.refresh()

		expect(page.window.document.activeElement?.getAttribute('data-record-key')).toBe(recordKey)
		const refreshedDetails = page.window.document.querySelector('details[data-pool-address]')
		expect(refreshedDetails instanceof page.window.HTMLDetailsElement && refreshedDetails.open).toBe(true)
	})

	test('does not repeat unchanged alerts and sanitizes mutation failures', async () => {
		const page = await dashboard()
		const globalError = page.window.document.getElementById('global-error')
		const operatorAlerts = page.window.document.getElementById('operator-alerts')
		if (globalError === null || operatorAlerts === null) throw new Error('Expected dashboard alerts')
		expect(operatorAlerts.getAttribute('role')).toBe('alert')
		expect(operatorAlerts.getAttribute('aria-live')).toBe('assertive')
		expect(globalError.textContent).toContain('Check the bot logs')
		expect(globalError.textContent).not.toContain('/api/internal')
		let mutations = 0
		const observer = new page.window.MutationObserver(records => {
			mutations += records.length
		})
		observer.observe(globalError, { attributes: true, childList: true, subtree: true })

		await page.refresh()
		await page.refresh()
		expect(mutations).toBe(0)
		page.setSnapshot(state(undefined, [{ message: 'Execution is blocked for recovery', severity: 'error' }]))
		await page.refresh()
		let alertMutations = 0
		const alertObserver = new page.window.MutationObserver(records => {
			alertMutations += records.length
		})
		alertObserver.observe(operatorAlerts, { attributes: true, childList: true, subtree: true })
		await page.refresh()
		expect(alertMutations).toBe(0)
		const testSources = page.window.document.getElementById('test-market-sources')
		if (!(testSources instanceof page.window.HTMLButtonElement)) throw new Error('Expected source test control')
		testSources.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		const sourceRows = page.window.document.getElementById('market-source-rows')
		expect(sourceRows?.textContent).toContain('Observed')
		expect(sourceRows?.textContent).toContain('admission still requires the persistence and consensus policy')
		expect(sourceRows?.textContent).not.toContain('Admitted')
		await page.refresh()
		expect(sourceRows?.textContent).toContain('Observed')
		expect(sourceRows?.textContent).not.toContain('Admitted')
		expect(page.window.document.getElementById('market-source-test-status')?.textContent).toBe('Source test completed at block 42')
		expect(page.window.document.getElementById('market-source-caption')?.textContent).toBe('Latest source probe (not admission)')
		const showAdmission = page.window.document.getElementById('show-active-admission')
		if (!(showAdmission instanceof page.window.HTMLButtonElement)) throw new Error('Expected active admission control')
		showAdmission.click()
		expect(sourceRows?.textContent).toContain('No market sources are configured.')
		expect(page.window.document.getElementById('market-source-caption')?.textContent).toBe('Configured source admission')
		expect(page.window.document.getElementById('market-source-test-status')?.textContent).toBe('Showing active admission from persisted consensus evidence')

		page.setSnapshot(state())
		await page.refresh()
		expect(globalError.classList.contains('hidden')).toBe(true)
		expect(globalError.textContent).toBe('')

		page.rejectPause(true)
		const pauseButton = page.window.document.getElementById('pause-button')
		if (!(pauseButton instanceof page.window.HTMLButtonElement)) throw new Error('Expected pause button')
		pauseButton.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		const pauseStatus = page.window.document.getElementById('pause-status')
		expect(pauseStatus?.textContent).toContain('Check the bot connection and retry')
		expect(pauseStatus?.textContent).not.toContain('/api/paused')
		expect(page.window.document.body.textContent).not.toContain('Fixture rejected')
	})

	test('links recovery blockers and confirms before resuming live execution', async () => {
		const page = await dashboard(configuration(['1'], { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }), state())
		const pending: PendingTransaction = {
			hash: `0x${'1'.repeat(64)}`,
			kind: 'liquidate',
			label: 'Liquidate pool',
			maxBlockNumber: '120',
			mode: 'private',
			nonce: '8',
			requiresMarketEvidence: true,
			submissionBlock: '100',
		}
		page.setSnapshot(state(undefined, [], { execute: true, pendingTransactions: [pending] }))
		await page.refresh()
		const recoveryGuidance = page.window.document.getElementById('recovery-guidance')
		if (!(recoveryGuidance instanceof page.window.HTMLElement)) throw new Error('Expected recovery guidance')
		expect(recoveryGuidance.hidden).toBe(false)
		expect(recoveryGuidance.textContent).toContain('Pause the bot')

		page.setSnapshot(state(undefined, [], { execute: true, paused: true, pendingTransactions: [pending] }))
		await page.refresh()
		expect(recoveryGuidance.hidden).toBe(true)

		const recoveryLink = page.window.document.querySelector('#operator-alerts a[href="/operations#recovery"]')
		expect(recoveryLink?.textContent).toBe('Review recovery')
		if (!(recoveryLink instanceof page.window.HTMLAnchorElement)) throw new Error('Expected recovery link')
		expect(page.window.document.getElementById('attention-badge')?.textContent).toContain('action')
		const pauseButton = page.window.document.getElementById('pause-button')
		if (!(pauseButton instanceof page.window.HTMLButtonElement)) throw new Error('Expected pause button')
		expect(pauseButton.textContent).toBe('Resume')
		expect(page.window.document.getElementById('mode-badge')?.textContent).toBe('Live')
		expect(page.pauseRequests).toHaveLength(0)
		pauseButton.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		const dialog = page.window.document.getElementById('resume-dialog')
		expect(page.pauseRequests).toHaveLength(0)
		expect(dialog?.hasAttribute('open')).toBe(true)
		expect(page.window.document.getElementById('resume-preflight')?.textContent).toContain('Recovery work')

		page.setSnapshot(
			state(undefined, [{ message: '1 staged operation requires outcome recovery', severity: 'error' }], {
				pendingStagedOperations: [
					{
						coordinator: '0x1111111111111111111111111111111111111111',
						historicalRecoveryComplete: false,
						latestRecoveryBlock: '110',
						operationId: '7',
						queuedBlock: '100',
						target: '0x2222222222222222222222222222222222222222',
					},
				],
			}),
		)
		await page.refresh()
		expect(page.window.document.getElementById('recovery-list')?.textContent).toContain('Staged operation 7')
		expect(page.window.document.getElementById('attention-badge')?.textContent).toContain('action')

		const confirm = page.window.document.getElementById('confirm-resume')
		if (!(confirm instanceof page.window.HTMLButtonElement)) throw new Error('Expected resume confirmation')
		confirm.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.pauseRequests.length).toBeGreaterThan(0)
		expect(page.pauseRequests).toEqual(page.pauseRequests.map(() => ({ paused: false })))
	})
})
