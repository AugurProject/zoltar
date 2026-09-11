import { expect, spyOn, test } from 'bun:test'
import { parseCentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { networkConfiguration } from '#config/network'
import { createOperatorHeadWatcher, createScanWakeGate, startCentralizedMarketSampler } from '../../src/runtime/background-observers.ts'
import type { OperatorState } from '#state/operator-state'

const network = networkConfiguration('sepolia', {})

function operatorState(): OperatorState {
	return {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		endpointChecks: [],
		executionHistory: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		operationLog: [],
		opportunities: [],
		paused: false,
		positions: [],
		priceHistory: [],
		reportPaths: [],
		status: 'syncing',
		tokenAddresses: [],
		tokenMarkets: [],
		transactionActivity: [],
	}
}

function centralizedMarkets(assetAddress: `0x${string}`, sources: readonly { exchangeId: string; repMarket: string }[] = []) {
	return parseCentralizedMarketSettings({
		assetAddress,
		assetChainId: network.chain.id,
		assetSymbol: 'REP',
		depthBps: 500,
		maximumDexDeviationBps: 1_000,
		maximumObservationAgeMilliseconds: 30_000,
		maximumVenueDispersionBps: 500,
		minimumAskDepthEth: '0',
		minimumBidDepthEth: '0',
		minimumSourceCount: 1,
		orderBookLimit: 20,
		requestTimeoutMilliseconds: 5_000,
		requiredForExecution: false,
		sources,
	})
}

test('head watcher logs each observed block with its age and any gap, and dedupes repeated failures', async () => {
	const logged = spyOn(console, 'log').mockImplementation(() => {})
	const errors = spyOn(console, 'error').mockImplementation(() => {})
	try {
		let blockNumber = 10n
		let fail = false
		const now = BigInt(Math.floor(Date.now() / 1_000))
		const watcher = createOperatorHeadWatcher({
			config: { networkConfigured: true },
			intervalMilliseconds: 5,
			isStopping: () => false,
			readClient: () => ({
				getBlock: async ({ blockNumber: requested }) => ({ hash: `0x${'ab'.repeat(32)}`, number: requested, timestamp: now - 11n }),
				getBlockNumber: async () => {
					if (fail) throw new Error('RPC unavailable')
					return blockNumber
				},
			}),
		})
		watcher.start()
		expect(await watcher.waitForNewHead(undefined, 1_000)).toBe('head')
		blockNumber = 13n
		expect(await watcher.waitForNewHead({ hash: `0x${'ab'.repeat(32)}`, number: 10n }, 1_000)).toBe('head')
		expect(logged.mock.calls.map(call => String(call[0]))).toEqual(['observedBlock=10 blockAgeSeconds=11', 'observedBlock=13 blockAgeSeconds=11 unobservedBlocks=2'])
		fail = true
		await Bun.sleep(30)
		expect(errors).toHaveBeenCalledTimes(1)
		expect(String(errors.mock.calls[0]?.[0])).toContain('headWatchFailed=')
		await watcher.stop()
	} finally {
		logged.mockRestore()
		errors.mockRestore()
	}
})

test('head watcher stays idle until the network is configured', async () => {
	let reads = 0
	const watcher = createOperatorHeadWatcher({
		config: { networkConfigured: false },
		isStopping: () => false,
		readClient: () => ({
			getBlock: async () => {
				throw new Error('unexpected')
			},
			getBlockNumber: async () => {
				reads += 1
				return 1n
			},
		}),
	})
	watcher.start()
	expect(await watcher.waitForNewHead(undefined, 15)).toBe('timeout')
	expect(reads).toBe(0)
	await watcher.stop()
})

test('centralized market sampler records a misconfiguration once and stops promptly', async () => {
	const errors = spyOn(console, 'error').mockImplementation(() => {})
	try {
		let stopping = false
		const state = operatorState()
		const sampler = startCentralizedMarketSampler({
			config: { centralizedMarkets: centralizedMarkets('0x0000000000000000000000000000000000000001', [{ exchangeId: 'binance', repMarket: 'REP/ETH' }]), network, networkConfigured: true, pollMilliseconds: 1_000 },
			isStopping: () => stopping,
			state,
		})
		await sampler.ready
		expect(state.centralizedMarket).toBeUndefined()
		expect(state.operationLog.map(entry => entry.message)).toEqual(['Centralized market sampling failed'])
		expect(errors).toHaveBeenCalledTimes(1)
		const startedAt = Date.now()
		stopping = true
		await sampler.stop()
		// The one-second sampling wait is interrupted instead of running out.
		expect(Date.now() - startedAt).toBeLessThan(500)
	} finally {
		errors.mockRestore()
	}
})

test('centralized market sampler publishes an empty estimate when no sources are configured', async () => {
	let stopping = false
	const state = operatorState()
	state.centralizedMarket = { assetId: network.rep, askDepthAttoEth: 0n, bidDepthAttoEth: 0n, chainId: network.chain.id, maximumPriceRepPerEth: 0n, minimumPriceRepPerEth: 0n, observations: [], priceRepPerEth: 0n, reasons: [], reliable: false }
	const sampler = startCentralizedMarketSampler({ config: { centralizedMarkets: centralizedMarkets(network.rep), network, networkConfigured: true, pollMilliseconds: 1_000 }, isStopping: () => stopping, state })
	await sampler.ready
	expect(state.centralizedMarket).toBeUndefined()
	expect(state.operationLog).toEqual([])
	stopping = true
	await sampler.stop()
})

test('centralized market sampler becomes ready only once a configured network was sampled, or when its loop ends', async () => {
	let stopping = false
	const config = { centralizedMarkets: centralizedMarkets(network.rep), network, networkConfigured: false, pollMilliseconds: 1_000 }
	const unconfigured = startCentralizedMarketSampler({ config, isStopping: () => stopping, state: operatorState() })
	expect(await Promise.race([unconfigured.ready.then(() => 'ready'), Bun.sleep(20).then(() => 'pending')])).toBe('pending')
	// Configuring the network and waking the sampler produces the first sample without waiting a full interval.
	config.networkConfigured = true
	unconfigured.wake()
	expect(await Promise.race([unconfigured.ready.then(() => 'ready'), Bun.sleep(200).then(() => 'pending')])).toBe('ready')
	stopping = true
	await unconfigured.stop()

	// A stop request observed through the shutdown-aware wait ends the loop and settles readiness without stop().
	let requested = false
	const waiters: (() => void)[] = []
	const wait = (milliseconds: number) =>
		requested
			? Promise.resolve()
			: new Promise<void>(resolve => {
					const timer = setTimeout(resolve, milliseconds)
					waiters.push(() => {
						clearTimeout(timer)
						resolve()
					})
				})
	const stoppedEarly = startCentralizedMarketSampler({ config: { ...config, networkConfigured: false }, isStopping: () => requested, state: operatorState(), wait })
	await Bun.sleep(5)
	requested = true
	for (const wake of waiters) wake()
	expect(await Promise.race([stoppedEarly.ready.then(() => 'ready'), Bun.sleep(200).then(() => 'pending')])).toBe('ready')
	await stoppedEarly.stop()
})

test('scan wake gate wakes only for heads the scan has not evaluated', async () => {
	const block = (number: bigint, suffix = 'aa') => ({ hash: `0x${suffix.repeat(32)}` as const, number, timestamp: number * 12n })
	let latest: ReturnType<typeof block> | undefined
	const waits: { scanned: unknown; timeout: number }[] = []
	const gate = createScanWakeGate({
		latest: () => latest,
		waitForNewHead: (scanned, timeout) => {
			waits.push({ scanned, timeout })
			return Promise.resolve(latest !== undefined && (scanned === undefined || latest.number > scanned.number) ? 'head' : 'timeout')
		},
	})
	// An early-returning poll waits relative to the head seen when it began, so it does not re-wake for it.
	latest = block(10n)
	gate.beginPoll()
	expect(await gate.wait(1_000, false)).toBe('timeout')
	expect(waits.at(-1)).toEqual({ scanned: block(10n), timeout: 1_000 })
	// A scan at the quorum head N while the watcher already reports N+1 waits for N+2 instead of spinning.
	latest = block(11n)
	gate.beginPoll()
	gate.headScanned(block(10n))
	expect(await gate.wait(1_000, false)).toBe('timeout')
	expect(waits.at(-1)?.scanned).toEqual(block(11n))
	latest = block(12n)
	expect(await gate.wait(1_000, false)).toBe('head')
	// A failed poll waits out its retry delay without a head wake.
	expect(gate.wait(1_000, true)).toBeUndefined()
	// A watcher still behind the scanned head waits on the scanned head itself.
	latest = block(9n)
	gate.headScanned(block(10n))
	expect(await gate.wait(1_000, false)).toBe('timeout')
	expect(waits.at(-1)?.scanned).toEqual(block(10n))
})
