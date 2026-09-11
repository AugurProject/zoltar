import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { useLiveTradingController } from '../../features/liveTradingController.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { shareBalanceScope, type LiveBalances, type LiveMarket } from '../../protocol/live.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const secondPool = `0x${'23'.repeat(20)}` as Address
const secondShareToken = `0x${'45'.repeat(20)}` as Address
const factory = `0x${'55'.repeat(20)}` as Address
const router = `0x${'66'.repeat(20)}` as Address
const securityPoolFactory = `0x${'77'.repeat(20)}` as Address

type Controller = ReturnType<typeof useLiveTradingController>

function deferred<T>() {
	let resolvePromise: (value: T) => void = () => undefined
	let rejectPromise: (reason: Error) => void = () => undefined
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve
		rejectPromise = reject
	})
	return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function flush() {
	await act(async () => {
		await Bun.sleep(5)
	})
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 1n,
	questionId: 2n,
	title: 'First market',
	description: 'Balance selection fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 2_000_000_000n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 100n * 10n ** 18n,
	settlementCollateralAttoEth: 10n * 10n ** 18n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 2n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 50n * 10n ** 18n,
	noReserve: 50n * 10n ** 18n,
	lpTotalSupply: 50n * 10n ** 18n,
}
const secondMarket: LiveMarket = { ...market, pool: secondPool, shareToken: secondShareToken, questionId: 3n, title: 'Second market' }
const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory, factory, router, feeBps: 30 }

function balancesFor(selectedMarket: LiveMarket, multiplier: bigint): LiveBalances {
	return { scope: shareBalanceScope(selectedMarket), invalid: multiplier * 10n ** 18n, yes: multiplier * 10n ** 18n, no: multiplier * 10n ** 18n, lp: multiplier * 10n ** 18n }
}

describe('live balance selection', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/?demo=0#/market',
	})

	async function renderController(initialRoute: string) {
		const pendingBalanceLoads: Array<{ pool: Address; resolve: (balances: LiveBalances) => void }> = []
		const walletListeners = new Map<string, (...args: unknown[]) => void>()
		Reflect.set(window, 'ethereum', {
			request: async () => undefined,
			on: (eventName: string, listener: (...args: unknown[]) => void) => walletListeners.set(eventName, listener),
			removeListener: (eventName: string) => walletListeners.delete(eventName),
		})
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				throw new Error('Addressed routes must not run universe-only discovery')
			},
			discoverTradingMarketPage: async () => {
				throw new Error('Addressed routes must not page through markets')
			},
			discoverAddressedMarket: async (_client: unknown, _configuration: unknown, address: Address) => {
				const found = [market, secondMarket].find(candidate => candidate.pool.toLowerCase() === address.toLowerCase())
				if (found === undefined) throw new Error(`Unknown pool ${address}`)
				// Live discovery always builds fresh market objects; the balance read must key on the pool, not object identity.
				return { start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [{ ...found }], universeIds: [1n], selectedUniverseId: 1n }
			},
			walletChainId: async () => configuration.chainId,
			connectWallet: async () => account,
			createTradingWalletClient: () => ({}),
			loadWalletHeaderBalances: async () => ({ ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, repToken: `0x${'47'.repeat(20)}` as Address }),
			loadLiveBalances: async (_client: unknown, selectedMarket: LiveMarket) => {
				const load = deferred<LiveBalances>()
				pendingBalanceLoads.push({ pool: selectedMarket.pool, resolve: load.resolve })
				return await load.promise
			},
		}
		let controller: Controller | undefined
		const Harness = ({ route }: { route: string }) => {
			controller = useLiveTradingController({
				route,
				configuration,
				configurationError: undefined,
				selectedUniverseId: '1',
				onUniversesChange: () => undefined,
				onWorkflowLockChange: () => undefined,
				onWalletSummaryChange: () => undefined,
				walletSummaryRetryNonce: 0,
				defaultSlippage: '0.5',
				defaultValidityMinutes: '20',
				refreshIntervalMilliseconds: 60_000,
				services,
			})
			return null
		}
		const rendered = await renderIntoDocument(<Harness route={initialRoute} />)
		cleanupRendered = rendered.cleanup
		await flush()
		const current = () => {
			if (controller === undefined) throw new Error('Controller has not rendered')
			return controller
		}
		const setRoute = async (route: string) => {
			await act(() => render(<Harness route={route} />, rendered.container))
			await flush()
		}
		await act(async () => {
			await current().wallet.connect()
		})
		await flush()
		expect(current().wallet.account).toBe(account)
		expect(current().discovery.selected?.pool).toBe(pool)
		return { current, pendingBalanceLoads, setRoute }
	}

	async function resolveBalanceLoad(pendingBalanceLoads: Array<{ pool: Address; resolve: (balances: LiveBalances) => void }>, index: number, multiplier: bigint) {
		const load = pendingBalanceLoads[index]
		if (load === undefined) throw new Error(`Missing balance load ${index.toString()}`)
		const loadedMarket = load.pool === pool ? market : secondMarket
		await act(async () => load.resolve(balancesFor(loadedMarket, multiplier)))
		await flush()
	}

	test('re-rendering the current market route while balances load still completes with fresh balances', async () => {
		const { current, pendingBalanceLoads, setRoute } = await renderController(`market/${pool}`)
		expect(current().balances.selectedBalanceState).toBe('loading')
		expect(pendingBalanceLoads.map(load => load.pool)).toEqual([pool])

		await setRoute(`market/${pool}`)
		expect(current().balances.selectedBalanceState).toBe('loading')
		expect(pendingBalanceLoads.map(load => load.pool)).toEqual([pool])
		await resolveBalanceLoad(pendingBalanceLoads, 0, 1n)

		expect(current().balances.selectedBalanceState).toBe('ready')
		expect(current().balances.selectedBalances?.yes).toBe(10n ** 18n)
		expect(current().balances.selectedBalances?.scope.pool).toBe(pool)
	})

	test('re-rendering the current market route after balances are ready leaves balances ready', async () => {
		const { current, pendingBalanceLoads, setRoute } = await renderController(`market/${pool}`)
		await resolveBalanceLoad(pendingBalanceLoads, 0, 1n)
		expect(current().balances.selectedBalanceState).toBe('ready')

		await setRoute(`market/${pool}`)

		expect(pendingBalanceLoads.map(load => load.pool)).toEqual([pool])
		expect(current().balances.selectedBalanceState).toBe('ready')
		expect(current().balances.selectedBalances?.scope.pool).toBe(pool)
		expect(current().balances.selectedBalances?.yes).toBe(10n ** 18n)
	})

	test('switching market routes discards balances that resolve for the previous market', async () => {
		const { current, pendingBalanceLoads, setRoute } = await renderController(`market/${pool}`)
		expect(pendingBalanceLoads.map(load => load.pool)).toEqual([pool])

		await setRoute(`market/${secondPool}`)
		expect(current().discovery.selected?.pool).toBe(secondPool)
		expect(current().balances.selectedBalanceState).toBe('loading')
		expect(pendingBalanceLoads.map(load => load.pool)).toEqual([pool, secondPool])

		await resolveBalanceLoad(pendingBalanceLoads, 0, 1n)
		expect(current().balances.selectedBalanceState).toBe('loading')
		expect(current().balances.selectedBalances).toBeUndefined()

		await resolveBalanceLoad(pendingBalanceLoads, 1, 4n)
		expect(current().balances.selectedBalanceState).toBe('ready')
		expect(current().balances.selectedBalances?.scope.pool).toBe(secondPool)
		expect(current().balances.selectedBalances?.yes).toBe(4n * 10n ** 18n)
	})
})
