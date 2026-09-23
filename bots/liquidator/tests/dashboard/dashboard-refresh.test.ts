import { decodeSnapshot } from '../../src/dashboard/api-validation.ts'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Browser } from 'happy-dom'
import type { PoolCatalogPage } from '../../src/monitoring/pool-catalog.ts'
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
	connectivity?: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string; rpcQuorum: 1 | 2 }
	desiredPools: unknown[]
	network?: { chainId: number; explorerUrl: string; name: 'mainnet' | 'sepolia' }
	networkConfigured?: boolean
	runtime: { execute: boolean; historicalLogRecovery: boolean; logLookbackBlocks: number }
	selectedPools: string[]
	strategy: Record<string, string | number | boolean>
	submission: { minimumBundleRelaySuccesses: number; mode: 'private' | 'public'; relayUrls: string[] }
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
		runtime: { execute: false, historicalLogRecovery: false, logLookbackBlocks: 256 },
		selectedPools: ['0x1111111111111111111111111111111111111111'],
		strategy: {},
		submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
	}
}

function mainnetConfiguration(approvedUniverses = ['1']) {
	return configuration(approvedUniverses, { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' })
}

function state(
	error?: string,
	alerts: { message: string; severity: 'error' | 'warning' }[] = [],
	options: {
		deploymentCheckedBlock?: string
		deploymentMissingName?: string
		execute?: boolean
		lastScannedBlock?: string
		lastScannedTimestamp?: string
		network?: 'mainnet' | 'sepolia'
		paused?: boolean
		pendingStagedOperations?: { candidateBlock?: string; coordinator: string; historicalRecoveryComplete: boolean; latestRecoveryBlock?: string; nextHistoricalBlock?: string; operationId: string; queuedBlock: string; target: string }[]
		pendingTransactions?: PendingTransaction[]
		rpcEndpointHealth?: { consecutiveFailures: number; latencyMilliseconds?: number; status: string; target: string }[]
		universes?: DashboardUniverse[]
		wallet?: string
	} = {},
) {
	return {
		activities: [],
		operatorCapable: true,
		alerts,
		deploymentCheckedBlock: options.deploymentCheckedBlock,
		deploymentMissingName: options.deploymentMissingName,
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
				universeId: '1',
			},
		],
		scanning: false,
		status: 'running',
		marketSources: [],
		universes: options.universes ?? [universe('1')],
		wallet: options.wallet,
	}
}

async function dashboard(initialConfiguration = mainnetConfiguration(), initialState = state('rpc secret at /api/internal'), initialStateRequestFailure = false, initialConfigurationRequestFailure = false, poolCatalog = false) {
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
	page.content = (await (await fetch(new URL(poolCatalog ? '/pools' : '/', server.url))).text()).replace('<script type="module" src="/dashboard.js"></script>', '')
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
	let catalogOverride: PoolCatalogPage | undefined
	let catalogRevision = 0
	let catalogFailure = false
	let selectionFailure = false
	const catalogRequests: string[] = []
	const catalogSearches: (string | null)[] = []
	let snapshot = initialState
	let stateResponseOverride: unknown
	let currentConfiguration = initialConfiguration
	let pendingProfileConfiguration: DashboardConfiguration | undefined
	let staleProfilePolls = 0
	let configurationRequestFailure = initialConfigurationRequestFailure
	let hangNextConfigurationRequest = false
	let hangNextProfileResponse = false
	let rejectPause = false
	let networkConnectivityFailureMessage: string | undefined
	const pauseRequests: unknown[] = []
	const executionRequests: unknown[] = []
	const submissionRequests: unknown[] = []
	let rejectExecution: string | undefined
	let loseExecutionResponse = false
	const approvedUniverseRequests: string[][] = []
	const selectedPoolRequests: string[][] = []
	const supportedPoolRequests: unknown[] = []
	let stateRequestCount = 0
	let stateRequestFailure = initialStateRequestFailure
	let hangNextStateRequest = false
	let releaseStateRequest: (() => void) | undefined
	let releasePauseRequest: (() => void) | undefined
	let releaseMarketSourceRequest: (() => void) | undefined
	let releaseApprovedUniverseRequest: (() => void) | undefined
	let releaseSelectedPoolRequest: (() => void) | undefined
	let releaseSubmissionRequest: (() => void) | undefined
	window.fetch = async (input, init) => {
		const inputUrl = typeof input === 'string' || input instanceof window.URL ? input.toString() : Reflect.get(input, 'url')
		if (typeof inputUrl !== 'string') throw new Error('Unexpected request URL')
		const url = new URL(inputUrl, server.url)
		if (url.pathname === '/api/pool-catalog') {
			if (catalogFailure) return new window.Response('{}', { status: 503 })
			if (catalogOverride !== undefined) {
				catalogRequests.push(url.searchParams.get('page') ?? '0')
				catalogSearches.push(url.searchParams.get('address'))
				return new window.Response(JSON.stringify(catalogOverride))
			}
			if (url.searchParams.get('scope') === 'monitored') {
				const address = url.searchParams.get('address')
				const pools = snapshot.pools
					.filter(pool => address === null || pool.address.toLowerCase() === address.toLowerCase())
					.map(pool => ({ ...pool, parent: '0x0000000000000000000000000000000000000000', universeId: '7', metrics: { systemState: pool.systemState, totalPoolHeldRep: pool.totalPoolHeldRep, vaultCount: pool.knownVaultCount } }))
				const page = Number(url.searchParams.get('page'))
				return new window.Response(JSON.stringify({ chainId: currentConfiguration.network?.chainId, snapshotTimestamp: '1789560000', page, pageCount: String(Math.ceil(pools.length / 12)), total: String(pools.length), pools: pools.slice(page * 12, (page + 1) * 12) }))
			}

			catalogRequests.push(url.searchParams.get('page') ?? '0')
			const address = url.searchParams.get('address')
			catalogSearches.push(address)
			const found = address === null || /^0xa{40}$/i.test(address)
			return new window.Response(
				JSON.stringify(
					catalogFailure
						? { error: 'RPC failed' }
						: {
								chainId: currentConfiguration.network?.chainId,
								page: Number(url.searchParams.get('page')),
								pageCount: address === null ? '2' : String(Number(found)),
								total: address === null ? String(13 + catalogRevision) : String(Number(found)),
								snapshotTimestamp: String(1789560000 + catalogRevision * 60),
								pools: found
									? [
											{
												address: address ?? '0x2222222222222222222222222222222222222222',
												parent: '0x0000000000000000000000000000000000000000',
												questionId: String(42 + catalogRevision),
												universeId: '7',
												multiplierBps: '12500',
												metrics: { systemState: '0', totalPoolHeldRep: String(2 + catalogRevision), vaultCount: String(3 + catalogRevision) },
												deploymentDate: '1789560000',
												questionDates: { startTime: '1789473600', endTime: '1792065600' },
											},
										]
									: [],
							},
				),
				{ status: catalogFailure ? 503 : 200 },
			)
		}
		if (url.pathname === '/api/supported-pool') {
			supportedPoolRequests.push(JSON.parse(String(init?.body)))
			if (releaseSelectedPoolRequest !== undefined) await new Promise<void>(resolve => (releaseSelectedPoolRequest = resolve))
			if (selectionFailure) return new window.Response('{}', { status: 400 })
			const value = JSON.parse(String(init?.body))
			currentConfiguration = { ...currentConfiguration, selectedPools: value.supported ? [...currentConfiguration.selectedPools, value.address] : currentConfiguration.selectedPools.filter(address => address !== value.address) }
			return new window.Response(JSON.stringify(currentConfiguration))
		}
		if (url.pathname === '/api/configuration') {
			if (hangNextConfigurationRequest) {
				hangNextConfigurationRequest = false
				return await new Promise<InstanceType<typeof window.Response>>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new Error('fixture configuration request aborted')), { once: true })
				})
			}
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
			const capturedSnapshot = stateResponseOverride ?? snapshot
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
			if (networkConnectivityFailureMessage !== undefined) {
				return new window.Response(JSON.stringify({ error: networkConnectivityFailureMessage }), { headers: { 'content-type': 'application/json' }, status: 400 })
			}
			currentConfiguration = {
				...currentConfiguration,
				connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'https://sepolia.example', rpcQuorum: 1 },
				network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
				networkConfigured: true,
			}
			return new window.Response(JSON.stringify(currentConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/network-profile') {
			snapshot = { ...snapshot, network: 'sepolia' }
			pendingProfileConfiguration = {
				...currentConfiguration,
				connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: '', rpcQuorum: 1 },
				network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
				networkConfigured: false,
			}
			if (hangNextProfileResponse) {
				hangNextProfileResponse = false
				return await new Promise<InstanceType<typeof window.Response>>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(new Error('fixture profile request aborted')), { once: true })
				})
			}
			return new window.Response(JSON.stringify(pendingProfileConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/paused') {
			const request: unknown = JSON.parse(String(init?.body))
			pauseRequests.push(request)
			if (releasePauseRequest !== undefined) await new Promise<void>(resolve => (releasePauseRequest = resolve))
		}
		if (url.pathname === '/api/execution') {
			const request: unknown = JSON.parse(String(init?.body))
			executionRequests.push(request)
			if (rejectExecution !== undefined) return new window.Response(JSON.stringify({ error: rejectExecution }), { headers: { 'content-type': 'application/json' }, status: 400 })
			const execute = typeof request === 'object' && request !== null && Reflect.get(request, 'execute') === true
			currentConfiguration = { ...currentConfiguration, runtime: { ...currentConfiguration.runtime, execute } }
			if (execute) snapshot = { ...snapshot, paused: true }
			// The change committed, but the response never reaches the dashboard.
			if (loseExecutionResponse) throw new TypeError('fetch failed')
			return new window.Response(JSON.stringify(currentConfiguration), { headers: { 'content-type': 'application/json' } })
		}
		if (url.pathname === '/api/submission') {
			const request: unknown = JSON.parse(String(init?.body))
			submissionRequests.push(request)
			if (releaseSubmissionRequest !== undefined) await new Promise<void>(resolve => (releaseSubmissionRequest = resolve))
			if (typeof request !== 'object' || request === null) throw new Error('Unexpected submission request')
			currentConfiguration = { ...currentConfiguration, submission: { minimumBundleRelaySuccesses: Number(Reflect.get(request, 'minimumBundleRelaySuccesses')), mode: Reflect.get(request, 'mode') === 'private' ? 'private' : 'public', relayUrls: [...(Reflect.get(request, 'relayUrls') ?? [])].map(String) } }
			return new window.Response(JSON.stringify(currentConfiguration), { headers: { 'content-type': 'application/json' } })
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
		openMonitoredPools: async () => {
			const link = window.document.querySelector('.section-nav a[href="/pools"]')
			if (!(link instanceof window.HTMLAnchorElement)) throw new Error('Missing pool navigation')
			link.click()
			await page.waitUntilComplete()
			const tab = window.document.querySelector('#pool-tab-monitored')
			if (!(tab instanceof window.HTMLButtonElement)) throw new Error('Missing monitored tab')
			tab.click()
			await page.waitUntilComplete()
		},
		setCatalog: (catalog: PoolCatalogPage) => {
			catalogOverride = catalog
		},
		advanceCatalog: () => {
			catalogRevision += 1
		},
		catalogRequests,
		catalogSearches,
		setCatalogFailure: (failed: boolean) => {
			catalogFailure = failed
		},
		setSelectionFailure: (failed: boolean) => {
			selectionFailure = failed
		},
		blockTick,
		refresh: async () => {
			await refresh()
			await page.waitUntilComplete()
		},
		rejectPause: (reject: boolean) => {
			rejectPause = reject
		},
		setStateResponse: (value: unknown) => {
			stateResponseOverride = value
		},
		setSnapshot: (next: ReturnType<typeof state>) => {
			snapshot = next
		},
		approvedUniverseRequests,
		selectedPoolRequests,
		supportedPoolRequests,
		pauseRequests,
		executionRequests,
		submissionRequests,
		rejectExecution: (message: string | undefined) => {
			rejectExecution = message
		},
		loseExecutionResponse: (lose: boolean) => {
			loseExecutionResponse = lose
		},
		setConfiguration: (next: DashboardConfiguration) => {
			currentConfiguration = next
		},
		stateRequestCount: () => stateRequestCount,
		setStateRequestFailure: (failed: boolean) => {
			stateRequestFailure = failed
		},
		setConfigurationRequestFailure: (failed: boolean) => {
			configurationRequestFailure = failed
		},
		setNetworkConnectivityFailureMessage: (message: string | undefined) => {
			networkConnectivityFailureMessage = message
		},
		setStaleProfilePolls: (count: number) => {
			staleProfilePolls = count
		},
		hangNextConfigurationRequest: () => {
			hangNextConfigurationRequest = true
		},
		hangNextProfileResponse: () => {
			hangNextProfileResponse = true
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
		suspendNextSubmissionRequest: () => {
			releaseSubmissionRequest = () => undefined
		},
		releaseSubmissionRequest: () => {
			const release = releaseSubmissionRequest
			releaseSubmissionRequest = undefined
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
		const clock = spyOn(page.window.Date, 'now').mockReturnValue(nowSeconds * 1_000)
		try {
			await page.refresh()
			await page.blockTick()
			expect(page.window.document.getElementById('block-status')?.textContent).toBe('Block 12345678 · seen 12s ago')
		} finally {
			clock.mockRestore()
		}
	})

	test('shows the missing deployment and checked block instead of generic readiness guidance', async () => {
		const waiting = { ...state(), operatorCapable: false, deploymentMissingName: 'Zoltar', deploymentCheckedBlock: '11662177', deploymentCheckedTimestamp: '123' }
		const page = await dashboard(mainnetConfiguration(), waiting)
		expect(page.window.document.getElementById('global-error')?.textContent).toContain('Zoltar is not deployed at block 11662177')
		expect(page.window.document.getElementById('global-error')?.textContent).not.toContain('logs')
		expect(page.window.document.getElementById('global-error')?.getAttribute('role')).toBe('status')
		expect(page.window.document.getElementById('attention-badge')?.textContent).toBe('Not deployed')
		expect(page.window.document.getElementById('attention-badge')?.getAttribute('href')).toBe('/overview#global-error')
		expect(page.window.document.getElementById('run-status-badge')?.textContent).toBe('Waiting')
		page.setSnapshot({ ...waiting, error: 'RPC timed out', status: 'connectivity-degraded' })
		await page.refresh()
		expect(page.window.document.getElementById('global-error')?.getAttribute('role')).toBe('alert')
		expect(page.window.document.getElementById('global-error')?.textContent).toContain('RPC connectivity is degraded')
		page.setSnapshot({ ...state(), operatorCapable: true })
		await page.refresh()
		expect(page.window.document.getElementById('global-error')?.classList.contains('hidden')).toBe(true)
	})

	for (const [label, snapshot, guidance] of [
		['startup', { ...state(), operatorCapable: false }, 'first scan has not completed'],
		['scanning', { ...state(), scanning: true, operatorCapable: false }, 'Scan in progress'],
		['paused', { ...state(undefined, [], { paused: true }), operatorCapable: false }, 'Use Resume'],
		['missing signer', { ...state(undefined, [], { execute: true }), operatorCapable: false }, 'Execution signer'],
	] as const) {
		test(`explains capability-only ${label} blockers`, async () => {
			const pending = label === 'startup' || label === 'scanning'
			const page = await dashboard(mainnetConfiguration(), snapshot)
			const pendingBadge = label === 'scanning' ? 'Scanning pools' : 'Awaiting first scan'
			expect(page.window.document.getElementById('attention-badge')?.textContent).toBe(pending ? pendingBadge : '1 action')
			expect(page.window.document.getElementById('attention-badge')?.getAttribute('href')).toBe(pending ? null : '/overview#global-error')
			expect(page.window.document.getElementById('global-error')?.classList.contains('warning')).toBe(!pending)
			if (pending) expect(page.window.document.getElementById('global-error')?.textContent).toContain('automatically')
			expect(page.window.document.getElementById('global-error')?.textContent).toContain(guidance)
			page.setSnapshot({ ...state(), operatorCapable: true })
			await page.refresh()
			expect(page.window.document.getElementById('global-error')?.classList.contains('hidden')).toBe(true)
			expect(page.window.document.getElementById('attention-badge')?.hasAttribute('hidden')).toBe(true)
		})
	}
	test('keeps polling automatically across success and failure', async () => {
		const page = await dashboard()
		expect(page.window.document.getElementById('refresh-button')).toBeNull()
		const before = page.stateRequestCount()

		await page.refresh()
		await Bun.sleep(1)
		expect(page.stateRequestCount()).toBe(before + 1)

		page.setStateRequestFailure(true)
		await page.refresh()
		await Bun.sleep(1)
		expect(page.stateRequestCount()).toBe(before + 2)
		expect(page.window.document.getElementById('run-status-badge')?.textContent).toBe('State stale')
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
		expect(initialFailure.window.document.getElementById('capability-badge')?.textContent).toBe('Capability unavailable')
		expect(initialFailure.window.document.getElementById('attention-badge')?.getAttribute('data-tone')).toBe('warning')
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
		expect(recovered.window.document.getElementById('run-status-badge')?.textContent).toBe('State stale')
		expect(recovered.window.document.getElementById('global-error')?.classList.contains('error')).toBe(true)
		expect(recovered.window.document.getElementById('capability-badge')?.textContent).toBe('Capability unavailable')
		expect(recovered.window.document.getElementById('attention-badge')?.getAttribute('data-tone')).toBe('warning')
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
		expect(recovered.window.document.getElementById('attention-badge')?.hasAttribute('hidden')).toBe(true)
		expect(recovered.window.document.getElementById('capability-badge')?.hasAttribute('hidden')).toBe(true)
		expect(recovered.window.document.getElementById('attention-badge')?.getAttribute('data-tone')).toBe('ok')
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
		for (const id of ['network-fields', 'market-configuration-fields', 'strategy-fields', 'submission-fieldset', 'execution-fieldset', 'clear-signer-button']) {
			const control = page.window.document.getElementById(id)
			expect(control?.hasAttribute('disabled')).toBe(true)
		}
		const signerInput = page.window.document.querySelector('#signer-form input[name="privateKey"]')
		const poolInput = page.window.document.querySelector('#pool-browser input[type=search]')
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
		expect(page.window.document.getElementById('clear-signer-button')?.hasAttribute('disabled')).toBe(false)
		expect(signerInput.disabled).toBe(false)
		await page.openMonitoredPools()
		const recoveredPoolInput = page.window.document.querySelector('#pool-browser input[type=search]')
		const recoveredUniverseInput = page.window.document.querySelector('#universe-rows input')
		if (!(recoveredPoolInput instanceof page.window.HTMLInputElement) || !(recoveredUniverseInput instanceof page.window.HTMLInputElement)) throw new Error('Expected recovered mutation controls')
		expect(recoveredPoolInput.disabled).toBe(false)
		expect(recoveredUniverseInput.disabled).toBe(false)
	})

	test('keeps network identity visible and updates it after configuration', async () => {
		const unconfigured = await dashboard(configuration(), { ...state(), operatorCapable: false })
		expect(unconfigured.window.document.getElementById('network-badge')?.textContent).toBe('Mainnet · RPC setup required')
		expect(unconfigured.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Ethereum mainnet profile')
		expect(unconfigured.window.document.getElementById('network-scope-summary')?.textContent).toContain('Ethereum mainnet profile')
		expect(unconfigured.window.document.getElementById('network-fields')?.hasAttribute('disabled')).toBe(false)
		for (const id of ['market-configuration-fields', 'strategy-fields']) expect(unconfigured.window.document.getElementById(id)?.hasAttribute('disabled')).toBe(true)
		const signerInput = unconfigured.window.document.querySelector('#signer-form input[name="privateKey"]')
		const poolInput = unconfigured.window.document.querySelector('#pool-browser input[type=search]')
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
		unconfigured.setSnapshot({ ...state(), operatorCapable: true })
		networkForm.dispatchEvent(new unconfigured.window.Event('submit', { bubbles: true, cancelable: true }))
		await unconfigured.waitUntilComplete()
		await unconfigured.refresh()
		await Bun.sleep(1)
		expect({
			attention: unconfigured.window.document.getElementById('attention-badge')?.hasAttribute('hidden'),
			badge: unconfigured.window.document.getElementById('network-badge')?.textContent,
			status: unconfigured.window.document.getElementById('network-status')?.textContent,
		}).toEqual({ attention: true, badge: 'Sepolia · chain 11155111', status: 'Chain and RPCs passed validation, were saved, and apply to the next scan.' })
		expect(unconfigured.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Sepolia profile')
		expect(unconfigured.window.document.getElementById('network-scope-summary')?.textContent).toBe('Sepolia profile · switchable')
		expect(networkName.disabled).toBe(false)
		for (const id of ['market-configuration-fields', 'strategy-fields']) expect(unconfigured.window.document.getElementById(id)?.hasAttribute('disabled')).toBe(false)
		expect(signerInput.disabled).toBe(false)

		const mainnet = await dashboard(configuration(['1'], { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }), state())
		expect(mainnet.window.document.getElementById('network-badge')?.textContent).toBe('Mainnet · chain 1')
	})

	test('keeps the active chain visible and locked while a requested profile loads', async () => {
		const page = await dashboard(
			{ ...mainnetConfiguration(), connectivity: { publicRpcUrls: ['https://mainnet-public.example'], quorumRpcUrls: ['https://mainnet-quorum-a.example', 'https://mainnet-quorum-b.example'], readRpcUrl: 'https://mainnet-read.example', rpcQuorum: 2 } },
			state(undefined, [], { rpcEndpointHealth: [{ consecutiveFailures: 0, latencyMilliseconds: 84, status: 'healthy', target: 'https://mainnet.example' }] }),
		)
		page.setStaleProfilePolls(3)
		page.hangNextProfileResponse()
		page.hangNextConfigurationRequest()
		const networkName = page.window.document.getElementById('network-name')
		const networkFields = page.window.document.getElementById('network-fields')
		const strategyFields = page.window.document.getElementById('strategy-fields')
		const rpcQuorum = page.window.document.getElementById('rpc-quorum')
		const readRpcUrl = page.window.document.getElementById('read-rpc-url')
		if (!(networkName instanceof page.window.HTMLSelectElement) || !(networkFields instanceof page.window.HTMLFieldSetElement) || !(strategyFields instanceof page.window.HTMLFieldSetElement) || !(rpcQuorum instanceof page.window.HTMLSelectElement) || !(readRpcUrl instanceof page.window.HTMLInputElement))
			throw new Error('Expected chain-profile controls')
		expect(rpcQuorum.value).toBe('2')
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
		expect(networkName.value).toBe('mainnet')
		expect(networkFields.disabled).toBe(true)
		expect(strategyFields.disabled).toBe(true)
		expect(page.window.document.getElementById('network-status')?.textContent).toBe('Switching to the Sepolia profile…')
		expect(page.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Ethereum mainnet profile')
		expect(page.window.document.getElementById('network-scope-summary')?.textContent).toBe('Ethereum mainnet profile · switching to Sepolia')
		expect(readRpcUrl.value).toBe('https://mainnet-read.example')
		expect(rpcQuorum.value).toBe('2')
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
		expect(networkName.value).toBe('mainnet')
		await staleStateRefresh
		await Bun.sleep(6_000)
		expect(networkName.value).toBe('sepolia')
		expect(networkFields.disabled).toBe(false)
		expect(strategyFields.disabled).toBe(true)
		expect(page.window.document.getElementById('settings-chain-scope')?.textContent).toContain('Editing the Sepolia profile')
		expect(page.window.document.getElementById('network-scope-summary')?.textContent).toBe('Sepolia profile · switchable')
		expect(page.window.document.getElementById('network-badge')?.textContent).toBe('Sepolia · RPC setup required')
		expect(page.window.document.getElementById('network-status')?.textContent).toBe('Sepolia profile loaded; RPC setup required.')
		expect(rpcQuorum.value).toBe('1')
		expect(page.window.document.getElementById('rpc-endpoint-health')?.children).toHaveLength(0)
	})

	test('shows the returned connectivity failure when saving RPC settings fails', async () => {
		const page = await dashboard(configuration(), state())
		page.setNetworkConnectivityFailureMessage('RPC http://reth:8545 failed while calling eth_chainId: The operation timed out. The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.')
		const networkForm = page.window.document.getElementById('network-form')
		const readRpcUrl = page.window.document.getElementById('read-rpc-url')
		const publicRpcUrls = page.window.document.getElementById('public-rpc-urls')
		if (!(networkForm instanceof page.window.HTMLFormElement) || !(readRpcUrl instanceof page.window.HTMLInputElement) || !(publicRpcUrls instanceof page.window.HTMLTextAreaElement)) {
			throw new Error('Expected network configuration controls')
		}

		readRpcUrl.value = 'http://reth:8545'
		publicRpcUrls.value = 'http://reth:8545'
		networkForm.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		await Bun.sleep(1)

		const networkStatus = page.window.document.getElementById('network-status')
		expect(networkStatus?.textContent).toBe('RPC http://reth:8545 failed while calling eth_chainId: The operation timed out. The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.')
		expect(networkStatus?.classList.contains('error')).toBe(true)
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
		expect(siblingPage.window.document.querySelector('.ue-detail-title')?.textContent).toBe('Root universe')
		const sibling = siblingPage.window.document.querySelector('input[value="3"]')
		if (!(sibling instanceof siblingPage.window.HTMLInputElement)) throw new Error('Expected sibling truth control')
		sibling.click()
		await siblingPage.waitUntilComplete()
		await Bun.sleep(1)
		expect(siblingPage.approvedUniverseRequests.at(-1)?.sort()).toEqual(['1', '3'])

		const nonePage = await dashboard(mainnetConfiguration(['1', '2', '4']), state(undefined, [], { universes }))
		const none = nonePage.window.document.querySelector('input[value="2"]')
		if (!(none instanceof nonePage.window.HTMLInputElement)) throw new Error('Expected no-child truth control')
		none.click()
		await nonePage.waitUntilComplete()
		await Bun.sleep(1)
		expect(nonePage.approvedUniverseRequests.at(-1)).toEqual(['1'])
	})

	test('switches a nested truth selection across the complete ancestor path', async () => {
		const universes = [universe('1'), universe('2', '1', '1'), universe('3', '1', '2'), universe('4', '2', '1'), universe('5', '3', '1')]
		const page = await dashboard(mainnetConfiguration(['1', '2', '4']), state(undefined, [], { universes }))
		const expand = page.window.document.querySelector('button[data-universe-focus="expand:3"]')
		if (!(expand instanceof page.window.HTMLButtonElement)) throw new Error('Expected branch expansion')
		expand.click()
		const destination = page.window.document.querySelector('input[value="5"]')
		if (!(destination instanceof page.window.HTMLInputElement)) throw new Error('Expected nested truth control')

		destination.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)

		expect(page.approvedUniverseRequests.at(-1)?.sort()).toEqual(['1', '3', '5'])
	})

	test('serializes universe selection and pool support mutations', async () => {
		const universes = [universe('1'), universe('2', '1', '1'), universe('3', '1', '2')]
		const universePage = await dashboard(mainnetConfiguration(['1']), state(undefined, [], { universes }))
		universePage.suspendNextApprovedUniverseRequest()
		const firstUniverse = universePage.window.document.querySelector('input[value="2"]')
		const secondUniverse = universePage.window.document.querySelector('input[value="3"]')
		if (!(firstUniverse instanceof universePage.window.HTMLInputElement) || !(secondUniverse instanceof universePage.window.HTMLInputElement)) throw new Error('Expected universe controls')
		firstUniverse.click()
		await Bun.sleep(1)
		const pendingSecondUniverse = universePage.window.document.querySelector('input[value="3"]')
		if (!(pendingSecondUniverse instanceof universePage.window.HTMLInputElement)) throw new Error('Expected pending universe control')
		expect(pendingSecondUniverse.disabled).toBe(true)
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
		await poolPage.openMonitoredPools()
		poolPage.suspendNextSelectedPoolRequest()
		const firstPoolControl = poolPage.window.document.querySelector('button[data-record-key="pool:0x1111111111111111111111111111111111111111"]')
		const secondPoolControl = poolPage.window.document.querySelector('button[data-record-key="pool:0x2222222222222222222222222222222222222222"]')
		if (!(firstPoolControl instanceof poolPage.window.HTMLButtonElement) || !(secondPoolControl instanceof poolPage.window.HTMLButtonElement)) throw new Error('Expected pool controls')
		firstPoolControl.click()
		await Bun.sleep(1)
		const pendingSecondPool = poolPage.window.document.querySelector('button[data-record-key="pool:0x2222222222222222222222222222222222222222"]')
		if (!(pendingSecondPool instanceof poolPage.window.HTMLButtonElement)) throw new Error('Expected pending pool control')
		expect(pendingSecondPool.disabled).toBe(true)
		secondPoolControl.click()
		expect(poolPage.supportedPoolRequests).toHaveLength(1)
		poolPage.releaseSelectedPoolRequest()
		await poolPage.waitUntilComplete()
		await Bun.sleep(1)
		expect(poolPage.supportedPoolRequests).toEqual([{ address: firstPool.address, supported: false, chainId: 1 }])
	})

	test('turns a scan-only error into an actionable blocker', async () => {
		const page = await dashboard(configuration(['1'], { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' }), { ...state('read RPC stalled'), operatorCapable: false })
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
		expect(page.window.document.getElementById('run-status-badge')?.textContent).toBe('State stale')
		expect(page.window.document.getElementById('pause-button')?.hasAttribute('disabled')).toBe(false)
		expect(page.window.document.getElementById('resume-dialog')?.hasAttribute('open')).toBe(false)
	})

	test('preserves focused controls and expanded monitoring details across polling', async () => {
		const page = await dashboard()
		await page.openMonitoredPools()
		const checkbox = page.window.document.querySelector('[data-record-key^="pool:"]')
		const details = page.window.document.querySelector('details[data-pool-address]')
		if (!(checkbox instanceof page.window.HTMLButtonElement) || !(details instanceof page.window.HTMLDetailsElement)) throw new Error('Expected pool controls')
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
		page.setSnapshot({ ...state(undefined, [], { execute: true, pendingTransactions: [pending] }), operatorCapable: false })
		await page.refresh()
		expect(page.window.document.getElementById('attention-badge')?.textContent).toBe('1 action')
		expect(page.window.document.getElementById('attention-badge')?.getAttribute('href')).toBe('/operations#recovery')
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
		expect(page.window.document.getElementById('mode-badge')?.textContent).toBe('Live armed')
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

describe('liquidator go-live settings', () => {
	const readiness = (page: Awaited<ReturnType<typeof dashboard>>) =>
		Array.from(page.window.document.querySelectorAll('#execution-checklist li'), item => `${item.getAttribute('data-ready') ?? ''}${item.getAttribute('data-advisory') === 'true' ? '~' : ''}:${item.querySelector('.readiness-label')?.textContent ?? ''}=${item.querySelector('strong')?.textContent ?? ''}`)

	test('groups Settings into numbered steps with a jump bar and shared panels', async () => {
		const page = await dashboard()
		expect(Array.from(page.window.document.querySelectorAll('#settings-nav a'), chip => chip.textContent)).toEqual(['1Connect', '2Markets', '3Liquidation policy', '4Go live'])
		expect(Array.from(page.window.document.querySelectorAll('.settings-section'), section => section.id)).toEqual(['settings-connect', 'settings-markets', 'settings-policy', 'settings-go-live'])
		expect(Array.from(page.window.document.querySelectorAll('#settings-go-live .settings-group > summary strong'), title => title.textContent)).toEqual(['Execution wallet', 'Submission', 'Execution mode'])
		expect(page.window.document.querySelector('#settings-nav a[aria-current="true"]')?.getAttribute('data-settings-target')).toBe('settings-connect')
		expect(page.window.document.querySelector('.settings-badges[data-form="strategy-form"]')).not.toBeNull()
		const strategySave = page.window.document.querySelector('#strategy-form button[type="submit"]')
		if (!(strategySave instanceof page.window.HTMLButtonElement)) throw new Error('Expected strategy save button')
		expect(strategySave.disabled).toBe(true)
		const reserve = page.window.document.querySelector('#strategy-form input[name="walletReserveRep"]')
		if (!(reserve instanceof page.window.HTMLInputElement)) throw new Error('Expected strategy input')
		reserve.value = '250'
		reserve.dispatchEvent(new page.window.Event('input', { bubbles: true }))
		expect(strategySave.disabled).toBe(false)
		expect(Array.from(page.window.document.querySelectorAll('.settings-badges[data-form="strategy-form"] .settings-badge'), badge => badge.textContent)).toEqual(['Unsaved changes'])
	})

	test('lists every live-execution prerequisite and locks the switch until they hold', async () => {
		const page = await dashboard(configuration(), state(undefined, [], { lastScannedBlock: '120' }))
		expect(readiness(page)).toEqual([
			'false:Execution signer=Set one under Execution wallet',
			'false:Chain and RPC endpoints=Save the chain and RPC endpoints under Connect',
			'true:Independent quorum RPCs=0 configured · 0 required',
			'true:Canonical contracts=Verified at block 120',
			'true:Delivery=Public mempool',
			'true~:Approved universes=1 approved',
			'true~:Monitored pools=1 selected · 1 eligible',
			'false~:Market evidence=No market sources configured · optional',
		])
		const toggle = page.window.document.getElementById('execution-enabled')
		if (!(toggle instanceof page.window.HTMLInputElement)) throw new Error('Expected execution switch')
		expect(toggle.disabled).toBe(true)
		expect(page.window.document.getElementById('execution-mode-summary')?.textContent).toBe('Dry run · prerequisites missing')

		// The configuration only reloads through a save, so the delivery form carries each connectivity change into the checklist.
		const saveDelivery = async (mode: 'private' | 'public', relays: string) => {
			const form = page.window.document.getElementById('submission-form')
			const modeSelect = page.window.document.getElementById('submission-mode')
			const relayInput = page.window.document.getElementById('relay-urls')
			if (!(form instanceof page.window.HTMLFormElement) || !(modeSelect instanceof page.window.HTMLSelectElement) || !(relayInput instanceof page.window.HTMLTextAreaElement)) throw new Error('Expected submission controls')
			modeSelect.value = mode
			relayInput.value = relays
			form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
			await page.waitUntilComplete()
			await Bun.sleep(1)
		}
		page.setConfiguration({ ...mainnetConfiguration(), connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: ['https://one.example'], readRpcUrl: 'https://read.example', rpcQuorum: 2 } })
		page.setSnapshot(state(undefined, [], { deploymentCheckedBlock: '121', deploymentMissingName: 'Security pool factory', lastScannedBlock: '120', wallet: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }))
		await page.refresh()
		await saveDelivery('private', '')
		expect(readiness(page)).toEqual([
			'true:Execution signer=0xabcdef…efabcd',
			'true:Chain and RPC endpoints=Ethereum mainnet · chain 1',
			'false:Independent quorum RPCs=1 configured · 2 required',
			'false:Canonical contracts=Missing Security pool factory at block 121',
			'false:Delivery=Private · 0 relays',
			'true~:Approved universes=1 approved',
			'true~:Monitored pools=1 selected · 1 eligible',
			'false~:Market evidence=No market sources configured · optional',
		])
		expect(toggle.disabled).toBe(true)

		page.setConfiguration({ ...mainnetConfiguration(), connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: ['https://one.example', 'https://two.example'], readRpcUrl: 'https://read.example', rpcQuorum: 2 } })
		page.setSnapshot(state(undefined, [], { lastScannedBlock: '122', wallet: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }))
		await page.refresh()
		await saveDelivery('private', 'https://relay.example')
		expect(readiness(page).slice(0, 5)).toEqual(['true:Execution signer=0xabcdef…efabcd', 'true:Chain and RPC endpoints=Ethereum mainnet · chain 1', 'true:Independent quorum RPCs=2 configured · 2 required', 'true:Canonical contracts=Verified at block 122', 'true:Delivery=Private · 1 relay'])
		expect(toggle.disabled).toBe(false)
		expect(page.window.document.getElementById('execution-mode-summary')?.textContent).toBe('Dry run · ready to go live')
	})

	test('arms live execution through the readiness-gated switch and returns to the saved mode when the bot rejects it', async () => {
		const ready = { ...mainnetConfiguration(), connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 as const }, networkConfigured: true }
		const page = await dashboard(ready, state(undefined, [], { lastScannedBlock: '120', wallet: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }))
		const form = page.window.document.getElementById('execution-form')
		const toggle = page.window.document.getElementById('execution-enabled')
		const save = page.window.document.querySelector('#execution-form button[type="submit"]')
		if (!(form instanceof page.window.HTMLFormElement) || !(toggle instanceof page.window.HTMLInputElement) || !(save instanceof page.window.HTMLButtonElement)) throw new Error('Expected execution mode controls')
		expect(toggle.disabled).toBe(false)
		expect(save.disabled).toBe(true)
		toggle.checked = true
		toggle.dispatchEvent(new page.window.Event('change', { bubbles: true }))
		expect(save.disabled).toBe(false)
		// Another form's save reloads the configuration without discarding the unsaved switch.
		const submissionForm = page.window.document.getElementById('submission-form')
		if (!(submissionForm instanceof page.window.HTMLFormElement)) throw new Error('Expected submission form')
		submissionForm.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.submissionRequests).toHaveLength(1)
		expect(toggle.checked).toBe(true)
		expect(save.disabled).toBe(false)
		expect(Array.from(page.window.document.querySelectorAll('.settings-badges[data-form="execution-form"] .settings-badge'), badge => badge.textContent)).toEqual(['Unsaved changes'])
		page.rejectExecution('Live execution requires an active signer')
		form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.executionRequests).toEqual([{ execute: true }])
		expect(toggle.checked).toBe(false)
		expect(page.window.document.getElementById('execution-status')?.textContent).toBe('Live execution requires an active signer')
		expect(page.window.document.getElementById('execution-status')?.classList.contains('error')).toBe(true)

		page.rejectExecution(undefined)
		toggle.checked = true
		toggle.dispatchEvent(new page.window.Event('change', { bubbles: true }))
		form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.executionRequests).toEqual([{ execute: true }, { execute: true }])
		expect(toggle.checked).toBe(true)
		expect(page.window.document.getElementById('execution-status')?.textContent).toContain('Live execution armed')
		expect(page.window.document.getElementById('execution-mode-summary')?.textContent).toBe('Dry run · ready to go live')
		expect(Array.from(page.window.document.querySelectorAll('.settings-badges[data-form="execution-form"] .settings-badge'), badge => badge.textContent)).toEqual([])
		page.setSnapshot(state(undefined, [], { execute: true, lastScannedBlock: '120', paused: true, wallet: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }))
		await page.refresh()
		expect(page.window.document.getElementById('execution-mode-summary')?.textContent).toBe('Live')
		expect(page.window.document.getElementById('mode-badge')?.textContent).toBe('Live armed')
	})

	test('keeps a delivery save locked across polls until the bot answers', async () => {
		const page = await dashboard()
		const form = page.window.document.getElementById('submission-form')
		const fieldset = page.window.document.getElementById('submission-fieldset')
		const relays = page.window.document.getElementById('relay-urls')
		const save = page.window.document.querySelector('#submission-form button[type="submit"]')
		if (!(form instanceof page.window.HTMLFormElement) || !(fieldset instanceof page.window.HTMLFieldSetElement) || !(relays instanceof page.window.HTMLTextAreaElement) || !(save instanceof page.window.HTMLButtonElement)) throw new Error('Expected submission controls')
		relays.value = 'https://relay.example'
		relays.dispatchEvent(new page.window.Event('input', { bubbles: true }))
		page.suspendNextSubmissionRequest()
		form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.submissionRequests).toHaveLength(1)
		expect(fieldset.disabled).toBe(true)
		// A poll re-derives every control's state; the in-flight save must stay locked and must not be sent again.
		await page.refresh()
		expect(fieldset.disabled).toBe(true)
		expect(save.disabled).toBe(true)
		form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		expect(page.submissionRequests).toHaveLength(1)
		page.releaseSubmissionRequest()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(fieldset.disabled).toBe(false)
		expect(save.disabled).toBe(true)
		expect(page.window.document.getElementById('submission-status')?.textContent).toContain('saved')
	})

	test('reloads the saved execution mode when an arming response is lost and keeps the switch locked until it can', async () => {
		const ready = { ...mainnetConfiguration(), connectivity: { publicRpcUrls: ['https://public.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 as const }, networkConfigured: true }
		const page = await dashboard(ready, state(undefined, [], { lastScannedBlock: '120', wallet: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }))
		const form = page.window.document.getElementById('execution-form')
		const fieldset = page.window.document.getElementById('execution-fieldset')
		const toggle = page.window.document.getElementById('execution-enabled')
		const status = page.window.document.getElementById('execution-status')
		if (!(form instanceof page.window.HTMLFormElement) || !(fieldset instanceof page.window.HTMLFieldSetElement) || !(toggle instanceof page.window.HTMLInputElement) || status === null) throw new Error('Expected execution mode controls')
		const submit = async () => {
			form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
			await page.waitUntilComplete()
			await Bun.sleep(1)
		}
		// The bot arms, but the response is lost while the configuration cannot be reloaded either: the panel stays locked.
		page.loseExecutionResponse(true)
		page.setConfigurationRequestFailure(true)
		toggle.checked = true
		toggle.dispatchEvent(new page.window.Event('change', { bubbles: true }))
		await submit()
		expect(page.executionRequests).toEqual([{ execute: true }])
		expect(status.textContent).toContain('could not be reloaded')
		expect(fieldset.disabled).toBe(true)
		await page.refresh()
		expect(fieldset.disabled).toBe(true)
		// Retrying the configuration load resolves the outcome: the switch shows the armed mode the bot actually holds.
		page.setConfigurationRequestFailure(false)
		const retry = page.window.document.querySelector('#configuration-status button')
		if (!(retry instanceof page.window.HTMLButtonElement)) throw new Error('Expected configuration retry')
		retry.click()
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(toggle.checked).toBe(true)
		expect(fieldset.disabled).toBe(false)
		expect(Array.from(page.window.document.querySelectorAll('.settings-badges[data-form="execution-form"] .settings-badge'), badge => badge.textContent)).toEqual([])
		expect(page.window.document.getElementById('execution-mode-summary')?.textContent).toBe('Dry run · ready to go live')
		// A lost disarm response reloads immediately when the configuration is reachable.
		toggle.checked = false
		toggle.dispatchEvent(new page.window.Event('change', { bubbles: true }))
		await submit()
		expect(page.executionRequests).toEqual([{ execute: true }, { execute: false }])
		expect(status.textContent).toContain('saved execution mode was reloaded')
		expect(toggle.checked).toBe(false)
		expect(fieldset.disabled).toBe(false)
		// A refused change still restores the previous mode without a reload.
		page.loseExecutionResponse(false)
		page.rejectExecution('Live execution requires an active signer')
		toggle.checked = true
		toggle.dispatchEvent(new page.window.Event('change', { bubbles: true }))
		await submit()
		expect(toggle.checked).toBe(false)
		expect(status.textContent).toBe('Live execution requires an active signer')
	})

	test('saves transaction delivery settings from the Submission panel', async () => {
		const page = await dashboard()
		const form = page.window.document.getElementById('submission-form')
		const mode = page.window.document.getElementById('submission-mode')
		const relays = page.window.document.getElementById('relay-urls')
		const minimum = page.window.document.getElementById('minimum-bundle-relay-successes')
		if (!(form instanceof page.window.HTMLFormElement) || !(mode instanceof page.window.HTMLSelectElement) || !(relays instanceof page.window.HTMLTextAreaElement) || !(minimum instanceof page.window.HTMLInputElement)) throw new Error('Expected submission controls')
		expect(mode.value).toBe('public')
		expect(minimum.value).toBe('1')
		mode.value = 'private'
		relays.value = 'https://relay-one.example\nhttps://relay-two.example\n'
		minimum.value = '2'
		form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		await Bun.sleep(1)
		expect(page.submissionRequests).toEqual([{ minimumBundleRelaySuccesses: 2, mode: 'private', relayUrls: ['https://relay-one.example', 'https://relay-two.example'] }])
		expect(page.window.document.getElementById('submission-status')?.textContent).toContain('saved')
		expect(relays.value).toBe('https://relay-one.example\nhttps://relay-two.example')
		expect(readiness(page)).toContain('true:Delivery=Private · 2 relays')
	})
})

test('keeps a large universe registry compact and finds collapsed descendants with their lineage', async () => {
	const universes = [universe('0'), ...Array.from({ length: 5000 }, (_, index) => universe(String(index + 1), '0', String(index + 1))), universe('6000', '1', '2'), universe('6001', '5000', '1')]
	const page = await dashboard(mainnetConfiguration(['0']), state(undefined, [], { universes }))
	expect(page.window.document.querySelectorAll('.ue-row')).toHaveLength(60)
	const more = page.window.document.querySelector('.ue-more')
	if (!(more instanceof page.window.HTMLButtonElement)) throw new Error('Expected universe pagination')
	more.click()
	expect(page.window.document.querySelectorAll('.ue-row')).toHaveLength(120)
	const search = page.window.document.querySelector('.ue-search')
	if (!(search instanceof page.window.HTMLInputElement)) throw new Error('Expected universe search')
	search.value = '5000'
	search.dispatchEvent(new page.window.Event('input'))
	const distant = page.window.document.querySelector('.ue-node')
	if (!(distant instanceof page.window.HTMLButtonElement)) throw new Error('Expected distant parent')
	distant.click()
	const children = Array.from(page.window.document.querySelectorAll('.ue-parent-link')).find(button => button.textContent?.startsWith('View 1 child'))
	if (!(children instanceof page.window.HTMLButtonElement)) throw new Error('Expected child navigation')
	children.click()
	expect(page.window.document.querySelector('input[value="6001"]')).not.toBeNull()
	expect(page.window.document.querySelectorAll('.ue-row').length).toBeLessThanOrEqual(60)
	search.value = '6000'
	search.dispatchEvent(new page.window.Event('input'))
	expect(page.window.document.querySelectorAll('.ue-row')).toHaveLength(1)
	const inspect = page.window.document.querySelector('.ue-node')
	if (!(inspect instanceof page.window.HTMLButtonElement)) throw new Error('Expected matching universe')
	inspect.click()
	expect(page.window.document.querySelector('.ue-lineage')?.textContent).toBe('Root universe › Outcome 1 › Outcome 2')
	const approval = page.window.document.querySelector('.ue-approve')
	if (!(approval instanceof page.window.HTMLInputElement)) throw new Error('Expected approval control')
	approval.click()
	await page.waitUntilComplete()
	await Bun.sleep(1)
	expect(page.approvedUniverseRequests.at(-1)).toEqual(['0', '1', '6000'])
})

test('all-pools browser automatically discovers, paginates, persists support, and recovers from errors', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	const root = page.window.document.querySelector('#pool-browser')
	if (root === null) throw new Error('Missing all-pools browser')
	const button = (text: string) => {
		const result = [...root.querySelectorAll('button')].find(candidate => candidate.textContent === text)
		if (result === undefined) throw new Error(`Missing button ${text}`)
		return result
	}
	expect(page.catalogRequests).toEqual(['0'])
	expect(root.textContent).toContain('Universe approval required')
	expect(root.textContent).not.toContain('Block ')
	expect(root.textContent).not.toContain('Created date')
	expect(root.querySelectorAll('.catalog-dates .timestamp-value-relative')).toHaveLength(3)
	expect([...root.querySelectorAll('.catalog-dates .timestamp-value-relative')].every(value => /\((in .+|.+ ago|now)\)/.test(value.textContent ?? ''))).toBe(true)
	expect([...root.querySelectorAll('.catalog-dates dt')].map(label => label.textContent)).toEqual(['Pool deployment date', 'Question start date', 'Question end date'])
	expect([...root.querySelectorAll('.catalog-dates time')].map(time => time.getAttribute('datetime'))).toEqual(['2026-09-16T12:00:00.000Z', '2026-09-15T12:00:00.000Z', '2026-10-15T12:00:00.000Z'])
	button('Add to supported').click()
	await page.waitUntilComplete()
	expect(button('Remove from supported').disabled).toBe(false)
	await page.refresh()
	expect(button('Remove from supported').disabled).toBe(false)
	page.setSelectionFailure(true)
	button('Remove from supported').click()
	await page.waitUntilComplete()
	expect(root.textContent).toContain('Could not save pool selection')
	page.setSelectionFailure(false)
	button('Remove from supported').click()
	await page.waitUntilComplete()
	expect(button('Add to supported').disabled).toBe(false)
	page.setCatalogFailure(true)
	button('Next').click()
	await page.waitUntilComplete()
	expect(root.textContent).toContain('Pool discovery failed')
	page.setCatalogFailure(false)
	button('Refresh').click()
	await page.waitUntilComplete()
	expect(root.textContent).toContain('Page 2 of 2')
	expect(button('Next').disabled).toBe(true)
})

test('discovers pools when navigating from Overview without a page reload', async () => {
	const page = await dashboard(mainnetConfiguration(), state())
	expect(page.catalogRequests).toEqual([])
	const link = page.window.document.querySelector('.section-nav a[href="/pools"]')
	if (!(link instanceof page.window.HTMLAnchorElement)) throw new Error('Missing pools navigation')
	link.click()
	await page.waitUntilComplete()
	expect(page.catalogRequests).toEqual(['0'])
	expect(page.window.document.querySelector('#pool-browser')?.textContent).toContain('Question 42')
})

test('searches an address in All pools and adds it through the matching card', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	const root = page.window.document.querySelector('#pool-browser')
	const search = root?.querySelector('input[type="search"]')
	if (root === null || root === undefined || !(search instanceof page.window.HTMLInputElement)) throw new Error('Missing pool search')
	const enter = async (value: string) => {
		search.value = value
		search.dispatchEvent(new page.window.Event('input'))
		await page.waitUntilComplete()
	}
	expect(page.window.document.querySelector('#pool-address-form')).toBeNull()
	expect(page.window.document.querySelector('#pool-rows')).toBeNull()
	await enter('0x123')
	expect(root.textContent).toContain('Enter a complete pool address')
	expect(page.catalogSearches).toEqual([null])
	const address = `0x${'a'.repeat(40)}`
	await enter(` ${address} `)
	expect(page.catalogSearches.at(-1)).toBe(address)
	expect(root.querySelectorAll('.catalog-record')).toHaveLength(1)
	const action = () => {
		const result = root.querySelector('.catalog-record button')
		if (!(result instanceof page.window.HTMLButtonElement)) throw new Error('Missing pool action')
		return result
	}
	page.setSelectionFailure(true)
	action().click()
	await page.waitUntilComplete()
	expect(root.textContent).toContain('Could not save pool selection')
	page.setSelectionFailure(false)
	action().click()
	await page.waitUntilComplete()
	expect(action().textContent).toBe('Remove from supported')
	expect(page.supportedPoolRequests.at(-1)).toEqual({ address, supported: true, chainId: 1 })
	await page.refresh()
	expect(action().textContent).toBe('Remove from supported')
	await enter(`0x${'b'.repeat(40)}`)
	expect(root.textContent).toContain('No matching pool on this chain.')
	expect(root.querySelectorAll('.catalog-record')).toHaveLength(0)
	await enter('')
	expect(page.catalogSearches.at(-1)).toBeNull()
	expect(root.textContent).toContain('13 pools · Page 1 of 2')
})

test('uses one card component and search across keyboard-accessible monitored and all tabs', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	const root = page.window.document.querySelector('#pool-browser')
	const all = root?.querySelector('#pool-tab-all')
	const monitored = root?.querySelector('#pool-tab-monitored')
	const search = root?.querySelector('input[type=search]')
	if (!(all instanceof page.window.HTMLButtonElement) || !(monitored instanceof page.window.HTMLButtonElement) || !(search instanceof page.window.HTMLInputElement)) throw new Error('Missing pool tabs')
	expect(all.getAttribute('aria-selected')).toBe('true')
	expect(page.window.document.querySelectorAll('#pools #pool-browser')).toHaveLength(1)
	all.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
	await page.waitUntilComplete()
	expect(monitored.getAttribute('aria-selected')).toBe('true')
	expect(page.window.document.activeElement).toBe(monitored)
	expect(root?.querySelector('.catalog-record')?.textContent).toContain('0x1111111111111111111111111111111111111111')
	expect(root?.querySelector('.catalog-monitoring')?.textContent).toContain('Vault backing')
	search.value = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	search.dispatchEvent(new page.window.Event('input'))
	await page.waitUntilComplete()
	expect(root?.textContent).toContain('No matching monitored pool.')
	all.click()
	await page.waitUntilComplete()
	expect(search.value).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
	expect(root?.querySelector('.catalog-record')?.textContent).toContain(search.value)
	expect(root?.querySelectorAll('[role=tabpanel]')).toHaveLength(1)
})

test('refreshes monitored card metrics from snapshots without membership changes', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	await page.openMonitoredPools()
	const next = state()
	next.pools = next.pools.map(pool => ({ ...pool, systemState: '1', totalPoolHeldRep: '987.65', knownVaultCount: '19' }))
	page.setSnapshot(next)
	await page.refresh()
	const card = page.window.document.querySelector('.catalog-record')
	expect(card?.querySelector('.catalog-badges')?.textContent).toContain('Inactive')
	expect(card?.querySelector('.catalog-balance')?.textContent).toContain('987.65')
	expect(card?.querySelector('.catalog-metrics')?.textContent).toContain('Vaults19')
})

test('resets monitored pagination when the last page disappears', async () => {
	const snapshot = state()
	const template = snapshot.pools[0]
	if (template === undefined) throw new Error('Missing fixture pool')
	snapshot.pools = Array.from({ length: 13 }, (_, index) => ({ ...template, address: `0x${(index + 1).toString(16).padStart(40, '0')}` }))
	const page = await dashboard(mainnetConfiguration(), snapshot, false, false, true)
	await page.openMonitoredPools()
	const next = [...page.window.document.querySelectorAll('#pool-browser button')].find(button => button.textContent === 'Next')
	if (!(next instanceof page.window.HTMLButtonElement)) throw new Error('Missing next page')
	next.click()
	await page.waitUntilComplete()
	expect(page.window.document.querySelector('#pool-browser')?.textContent).toContain('Page 2 of 2')
	page.setSnapshot({ ...snapshot, pools: snapshot.pools.slice(0, 12) })
	await page.refresh()
	expect(page.window.document.querySelector('#pool-browser')?.textContent).toContain('12 pools · Page 1 of 1')
	expect(page.window.document.querySelectorAll('.catalog-record')).toHaveLength(12)
})

test('refreshes monitored membership after an in-flight support save', async () => {
	const snapshot = state()
	const template = snapshot.pools[0]
	if (template === undefined) throw new Error('Missing fixture pool')
	snapshot.pools = Array.from({ length: 13 }, (_, index) => ({ ...template, address: `0x${(index + 1).toString(16).padStart(40, '0')}` }))
	const page = await dashboard(mainnetConfiguration(), snapshot, false, false, true)
	await page.openMonitoredPools()
	const next = [...page.window.document.querySelectorAll('#pool-browser button')].find(button => button.textContent === 'Next')
	if (!(next instanceof page.window.HTMLButtonElement)) throw new Error('Missing next page')
	next.click()
	await page.waitUntilComplete()
	page.suspendNextSelectedPoolRequest()
	const action = page.window.document.querySelector('.catalog-record button')
	if (!(action instanceof page.window.HTMLButtonElement)) throw new Error('Missing support action')
	action.click()
	await Bun.sleep(1)
	page.setSnapshot({ ...snapshot, pools: snapshot.pools.slice(0, 12) })
	const refresh = page.refresh()
	await Bun.sleep(10)
	page.releaseSelectedPoolRequest()
	await refresh
	await page.waitUntilComplete()
	expect(page.window.document.querySelector('#pool-browser')?.textContent).toContain('12 pools · Page 1 of 1')
	expect(page.window.document.querySelectorAll('.catalog-record')).toHaveLength(12)
})

test('keeps known monitored cards and live details when catalog discovery fails', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	page.setCatalogFailure(true)
	await page.openMonitoredPools()
	const root = page.window.document.querySelector('#pool-browser')
	expect(root?.textContent).toContain('Pool discovery failed')
	expect(root?.querySelectorAll('.catalog-record')).toHaveLength(1)
	expect(root?.querySelector('.catalog-monitoring')?.textContent).toContain('OracleFresh')
	const snapshot = state()
	snapshot.pools = snapshot.pools.map(pool => ({ ...pool, lastPrice: '9', totalPoolHeldRep: '123' }))
	page.setSnapshot(snapshot)
	await page.refresh()
	expect(root?.querySelector('.catalog-monitoring')?.textContent).toContain('9 REP / ETH')
	expect(root?.querySelector('.catalog-balance')?.textContent).toContain('123')
	const action = root?.querySelector('.catalog-record button')
	if (!(action instanceof page.window.HTMLButtonElement)) throw new Error('Missing support action')
	expect(action.disabled).toBe(false)
	action.click()
	await page.waitUntilComplete()
	expect(page.supportedPoolRequests).toHaveLength(1)
})

test('refreshes all-pool listings counts metrics and snapshot age on demand', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	const root = page.window.document.querySelector('#pool-browser')
	const refresh = [...page.window.document.querySelectorAll('#pool-browser button')].find(button => button.textContent === 'Refresh')
	expect(refresh).toBeDefined()
	if (!(refresh instanceof page.window.HTMLButtonElement)) throw new Error('Missing catalog refresh')
	expect(refresh.hidden).toBe(false)
	const oldTime = root?.querySelector('.catalog-snapshot time')?.getAttribute('datetime')
	expect(oldTime).toBeDefined()
	page.advanceCatalog()
	refresh.click()
	await page.waitUntilComplete()
	expect(root?.textContent).toContain('14 pools')
	expect(root?.textContent).toContain('Question 43')
	expect(root?.querySelector('.catalog-balance')?.textContent).toContain('3')
	expect(root?.querySelector('.catalog-metrics')?.textContent).toContain('Vaults4')
	expect(root?.querySelector('.catalog-snapshot time')?.getAttribute('datetime')).not.toBe(oldTime)
	expect(root?.querySelector('.catalog-snapshot .timestamp-value-relative')).not.toBeNull()
	page.setCatalogFailure(true)
	refresh.click()
	await page.waitUntilComplete()
	expect(root?.textContent).toContain('Question 43')
	expect(root?.textContent).toContain('Pool discovery failed')
})

test('retains expanded monitored details after failed catalog requests and tab changes', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	await page.openMonitoredPools()
	const details = page.window.document.querySelector('.catalog-monitoring')
	if (!(details instanceof page.window.HTMLDetailsElement)) throw new Error('Missing monitoring details')
	details.open = true
	page.setCatalogFailure(true)
	const all = page.window.document.querySelector('#pool-tab-all')
	if (!(all instanceof page.window.HTMLButtonElement)) throw new Error('Missing all pools tab')
	all.click()
	await page.waitUntilComplete()
	const snapshot = state()
	snapshot.pools = snapshot.pools.map(pool => ({ ...pool, lastPrice: '12', totalPoolHeldRep: '456' }))
	page.setSnapshot(snapshot)
	await page.refresh()
	await page.openMonitoredPools()
	const returned = page.window.document.querySelector('.catalog-monitoring')
	expect(returned?.textContent).toContain('12 REP / ETH')
	expect(page.window.document.querySelector('.catalog-balance')?.textContent).toContain('456')
	if (!(returned instanceof page.window.HTMLDetailsElement)) throw new Error('Monitoring details disappeared')
	expect(returned.open).toBe(true)
	returned.open = false
	await page.refresh()
	expect(page.window.document.querySelector('.catalog-monitoring')?.hasAttribute('open')).toBe(false)
})

test('refreshes new pools and balances while retaining page search scope and support selection', async () => {
	const existing = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	const created = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
	const config = mainnetConfiguration()
	config.selectedPools = [existing]
	const page = await dashboard(config, state(), false, false, true)
	const pool = { address: existing, questionId: '42', universeId: '1', multiplierBps: '10000', metrics: { systemState: '0', totalPoolHeldRep: '2', vaultCount: '1' } }
	const before = { chainId: 1, page: 1, pageCount: '2', total: '13', snapshotTimestamp: '1789560000', pools: [pool] }
	page.setCatalog(before)
	const button = (label: string) => {
		const match = [...page.window.document.querySelectorAll('#pool-browser button')].find(candidate => candidate.textContent === label)
		if (!(match instanceof page.window.HTMLButtonElement)) throw new Error(`Missing ${label}`)
		return match
	}
	button('Next').click()
	await page.waitUntilComplete()
	expect(page.catalogRequests.at(-1)).toBe('1')
	const changed = { ...pool, metrics: { ...pool.metrics, totalPoolHeldRep: '9' } }
	page.setCatalog({ ...before, total: '14', snapshotTimestamp: '1789560060', pools: [changed, { ...pool, address: created, questionId: '43' }] })
	button('Refresh').click()
	await page.waitUntilComplete()
	const root = page.window.document.querySelector('#pool-browser')
	expect(root?.textContent).toContain('14 pools · Page 2 of 2')
	expect(root?.textContent).toContain(created)
	expect(root?.querySelector('.catalog-balance')?.textContent).toContain('9')
	expect(button('Remove from supported').getAttribute('aria-label')).toContain(existing)
	expect(page.catalogRequests.at(-1)).toBe('1')
	const search = root?.querySelector('input[type=search]')
	if (!(search instanceof page.window.HTMLInputElement)) throw new Error('Missing search')
	page.setCatalog({ ...before, page: 0, pageCount: '1', total: '1', pools: [changed] })
	search.value = existing
	search.dispatchEvent(new page.window.Event('input'))
	await page.waitUntilComplete()
	page.setCatalog({ ...before, page: 0, pageCount: '1', total: '1', snapshotTimestamp: '1789560120', pools: [{ ...changed, metrics: { ...changed.metrics, totalPoolHeldRep: '10' } }] })
	button('Refresh').click()
	await page.waitUntilComplete()
	expect(search.value).toBe(existing)
	expect(page.catalogSearches.at(-1)).toBe(existing)
	expect(root?.querySelector('#pool-tab-all')?.getAttribute('aria-selected')).toBe('true')
	expect(root?.querySelector('.catalog-balance')?.textContent).toContain('10')
	expect(button('Remove from supported').getAttribute('aria-label')).toContain(existing)
	expect(page.supportedPoolRequests).toHaveLength(0)
})

test('presents pool errors as shared error notices and restores neutral status on retry', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	page.setCatalogFailure(true)
	await page.openMonitoredPools()
	const root = page.window.document.querySelector('#pool-browser')
	const status = root?.querySelector('[role=alert]')
	expect(status?.classList.contains('notice')).toBe(true)
	expect(status?.classList.contains('error')).toBe(true)
	expect(status?.textContent).toContain('Pool discovery failed')
	expect(status?.getAttribute('aria-live')).toBe('assertive')
	const text = status?.firstChild
	const snapshot = state()
	snapshot.pools = snapshot.pools.map(pool => ({ ...pool, totalPoolHeldRep: '123' }))
	page.setSnapshot(snapshot)
	await page.refresh()
	expect(status?.firstChild).toBe(text)
	const refresh = [...page.window.document.querySelectorAll('#pool-browser button')].find(button => button.textContent === 'Refresh')
	if (!(refresh instanceof page.window.HTMLButtonElement)) throw new Error('Missing refresh')
	page.setCatalogFailure(false)
	refresh.click()
	expect(status?.getAttribute('role')).toBe('status')
	expect(status?.classList.contains('error')).toBe(false)
	await page.waitUntilComplete()
	expect(status?.hasAttribute('hidden')).toBe(true)
	const search = root?.querySelector('input[type=search]')
	if (!(search instanceof page.window.HTMLInputElement)) throw new Error('Missing search')
	search.value = '0x123'
	search.dispatchEvent(new page.window.Event('input'))
	search.dispatchEvent(new page.window.Event('blur'))
	expect(status?.classList.contains('notice')).toBe(true)
	expect(status?.classList.contains('error')).toBe(true)
	expect(status?.textContent).toContain('Enter a complete pool address')
	search.value = ''
	search.dispatchEvent(new page.window.Event('input'))
	await page.waitUntilComplete()
	page.setSelectionFailure(true)
	const action = root?.querySelector('.catalog-record button')
	if (!(action instanceof page.window.HTMLButtonElement)) throw new Error('Missing support action')
	action.click()
	await page.waitUntilComplete()
	expect(status?.classList.contains('error')).toBe(true)
	expect(status?.getAttribute('role')).toBe('alert')
	expect(status?.textContent).toContain('Could not save pool selection')
})

test('reports a missing catalog snapshot in the error notice and retains real snapshot age on refresh failure', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	page.setCatalogFailure(true)
	await page.openMonitoredPools()
	const root = page.window.document.querySelector('#pool-browser')
	const snapshot = root?.querySelector('.catalog-snapshot')
	expect(root?.querySelector('.notice.error')?.textContent).toContain('Catalog snapshot unavailable')
	expect(snapshot?.hasAttribute('hidden')).toBe(true)
	expect(snapshot?.querySelector('.timestamp-value.unavailable')).toBeNull()
	expect([...page.window.document.querySelectorAll('.catalog-dates dd')].every(value => value.textContent === '—')).toBe(true)
	const refresh = [...page.window.document.querySelectorAll('#pool-browser button')].find(button => button.textContent === 'Refresh')
	if (!(refresh instanceof page.window.HTMLButtonElement)) throw new Error('Missing refresh')
	page.setCatalogFailure(false)
	refresh.click()
	await page.waitUntilComplete()
	expect(snapshot?.hasAttribute('hidden')).toBe(false)
	const date = snapshot?.querySelector('time')?.getAttribute('datetime')
	expect(date).toBeDefined()
	page.setCatalogFailure(true)
	refresh.click()
	await page.waitUntilComplete()
	expect(snapshot?.hasAttribute('hidden')).toBe(false)
	expect(snapshot?.querySelector('time')?.getAttribute('datetime')).toBe(date)
	expect(root?.querySelector('.notice.error')?.textContent).not.toContain('Catalog snapshot unavailable')
})

test('groups unavailable optional pool data in a warning without blocking support actions', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	const pool = { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', questionId: '42', universeId: '1', multiplierBps: '10000' }
	const catalog = { chainId: 1, page: 0, total: '1', pageCount: '1', snapshotTimestamp: '1789560000', pools: [pool] }
	page.setCatalog(catalog)
	const refresh = [...page.window.document.querySelectorAll('#pool-browser button')].find(button => button.textContent === 'Refresh')
	if (!(refresh instanceof page.window.HTMLButtonElement)) throw new Error('Missing refresh')
	refresh.click()
	await page.waitUntilComplete()
	const card = page.window.document.querySelector('.catalog-record')
	expect(card?.querySelector('.notice.warning')?.getAttribute('role')).toBe('status')
	expect(card?.querySelector('.notice.warning')?.textContent).toContain('deployment date')
	expect(card?.querySelector('.notice.warning')?.textContent).toContain('question dates')
	expect(card?.querySelector('.notice.warning')?.textContent).toContain('metrics')
	expect(card?.querySelector('.catalog-badges')?.textContent).not.toContain('Metrics unavailable')
	expect(card?.querySelector('button')?.disabled).toBe(false)
	expect([...page.window.document.querySelectorAll('.catalog-dates dd')].every(value => value.textContent === '—')).toBe(true)
	page.setCatalog({ ...catalog, pools: [{ ...pool, deploymentDate: '1789387200', questionDates: { startTime: '1789473600', endTime: '1792065600' }, metrics: { systemState: '0', totalPoolHeldRep: '1', vaultCount: '2' } }] })
	refresh.click()
	await page.waitUntilComplete()
	expect(page.window.document.querySelector('.catalog-record .notice.warning')).toBeNull()
	expect(page.window.document.querySelectorAll('.catalog-dates time')).toHaveLength(3)
})

test('waits for an address typing pause or blur before reporting validation errors', async () => {
	const page = await dashboard(mainnetConfiguration(), state(), false, false, true)
	const root = page.window.document.querySelector('#pool-browser')
	const search = root?.querySelector('input[type=search]')
	if (!(search instanceof page.window.HTMLInputElement)) throw new Error('Missing pool search')
	const enter = (value: string) => {
		search.value = value
		search.dispatchEvent(new page.window.Event('input'))
	}
	enter('0x1')
	expect(search.getAttribute('aria-invalid')).toBe('false')
	expect(root?.querySelector('.notice.error')).toBeNull()
	expect(page.catalogSearches).toEqual([null])
	await page.waitUntilComplete()
	expect(search.getAttribute('aria-invalid')).toBe('true')
	enter('0x12')
	expect(search.getAttribute('aria-invalid')).toBe('false')
	search.dispatchEvent(new page.window.Event('blur'))
	expect(search.getAttribute('aria-invalid')).toBe('true')
	enter('0x123')
	const address = `0x${'a'.repeat(40)}`
	enter(address)
	await page.waitUntilComplete()
	expect(search.getAttribute('aria-invalid')).toBe('false')
	expect(page.catalogSearches).toEqual([null, address])
	enter('0x1')
	enter('')
	await page.waitUntilComplete()
	expect(search.getAttribute('aria-invalid')).toBe('false')
	expect(page.catalogSearches).toEqual([null, address, null])
	search.value = 'bad pasted address'
	search.dispatchEvent(new page.window.InputEvent('input', { inputType: 'insertFromPaste' }))
	expect(search.getAttribute('aria-invalid')).toBe('true')
	expect(page.catalogSearches).toEqual([null, address, null])
})

test('rejects malformed successful state responses before rendering and recovers on a valid response', async () => {
	const page = await dashboard(mainnetConfiguration(), state())
	page.setStateResponse({ ...state(), execute: 'false' })
	await page.refresh()
	expect(page.window.document.querySelector('#run-status-badge')?.textContent).toContain('State stale')
	expect(page.window.document.querySelector('#strategy-fields')?.hasAttribute('disabled')).toBe(true)
	page.setStateResponse(undefined)
	await page.refresh()
	expect(page.window.document.querySelector('#run-status-badge')?.textContent).not.toContain('Disconnected')
})

test('rejects malformed numeric pool fields before they reach monitored pool rendering', () => {
	const valid = state()
	const pool = valid.pools[0]
	if (pool === undefined) throw new Error('Missing pool fixture')
	for (const badPool of [
		{ ...pool, multiplierBps: 'invalid' },
		{ ...pool, parent: 'invalid' },
		{ ...pool, botVault: { ...pool.botVault, healthBps: 'invalid' } },
	]) {
		expect(() => decodeSnapshot({ ...valid, pools: [badPool] })).toThrow('invalid state snapshot')
	}
})

test('uses informational dry run, warning live and pending, and error failure badges', async () => {
	const page = await dashboard(mainnetConfiguration(), state())
	expect(page.window.document.getElementById('mode-badge')?.className).toBe('badge info')
	page.setStateResponse({
		...state('Execution failed', [], { execute: true }),
		activities: [
			{ at: '2026-09-17T00:00:00.000Z', message: 'Planned', status: 'dry-run' },
			{ at: '2026-09-17T00:00:00.000Z', message: 'Submitted', status: 'pending' },
			{ at: '2026-09-17T00:00:00.000Z', message: 'Rejected', status: 'failed' },
		],
	})
	await page.refresh()
	expect(page.window.document.getElementById('mode-badge')?.className).toBe('badge warning')
	expect(page.window.document.getElementById('run-status-badge')?.className).toBe('badge error')
	for (const [status, tone] of [
		['dry-run', 'info'],
		['pending', 'warning'],
		['failed', 'error'],
	]) {
		const badge = [...page.window.document.querySelectorAll('.badge')].find(element => element.textContent === status)
		expect(badge?.className).toBe(`badge ${tone}`)
	}
})
