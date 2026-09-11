import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory: `0x${'77'.repeat(20)}`, factory: `0x${'55'.repeat(20)}`, router: `0x${'66'.repeat(20)}`, feeBps: 30 }

// One attoETH of collateral is worth 10^18 attoShares, mirroring the SecurityPool genesis rate that makes raw share counts unreadable.
const market: LiveMarket = {
	pool,
	pair,
	shareToken,
	universeId: 1n,
	questionId: 2n,
	title: 'Background fixture market',
	description: 'Background refresh fixture',
	endTime: 2n ** 255n,
	statoblastSecurityMultiplierBps: 20_000n,
	initialReportPriorityFeeAttoEthPerGas: 1n,
	systemState: 0,
	awaitingForkContinuation: false,
	universeForkTime: 0n,
	vaultCount: 1n,
	shareTokenSupplyAttoShares: 10n * 10n ** 36n,
	settlementCollateralAttoEth: 10n * 10n ** 18n,
	currentRetentionRate: 10n ** 18n,
	totalCapacityOwnershipAttoRep: 1n,
	feeEligibleCapacityOwnershipAttoRep: 1n,
	mintingCapacityCeilingAttoEth: 2n,
	availableMintingCapacityAttoEth: 1n,
	feeBps: 30n,
	tradingStatus: 0,
	questionOutcome: 3,
	yesReserve: 50n * 10n ** 36n,
	noReserve: 50n * 10n ** 36n,
	lpTotalSupply: 50n * 10n ** 36n,
}

async function settle(milliseconds = 10) {
	await act(async () => {
		await Bun.sleep(milliseconds)
	})
}

async function waitForDom(predicate: () => boolean, description: string) {
	for (let attempt = 0; attempt < 200; attempt++) {
		await settle()
		if (predicate()) return
	}
	throw new Error(`Timed out waiting for ${description}. Rendered text: ${document.body.textContent}`)
}

function button(label: string) {
	const match = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}. Rendered text: ${document.body.textContent}`)
	return match
}

function walletMetric(label: string) {
	const term = Array.from(document.querySelectorAll('dt')).find(candidate => candidate.textContent === label)
	return term?.nextElementSibling?.textContent ?? undefined
}

describe('live market refresh', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: `http://localhost/?demo=0#/market/${pool}`,
	})

	test('refreshes market data in the background without hiding loaded balances, retires stale quotes, and prices exits by collateral value', async () => {
		let discoveredMarket = market
		let discoveries = 0
		let balanceLoads = 0
		let yesBalance = 3n * 10n ** 36n
		const exitRequests: bigint[] = []
		let failExitSimulation = false
		Reflect.set(window, 'ethereum', { request: async () => undefined, on: () => undefined, removeListener: () => undefined })
		const walletClient = { waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
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
			discoverAddressedMarket: async () => {
				discoveries += 1
				// Live discovery always builds fresh market objects, which is what lets dependent balance reads revalidate.
				return { start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [{ ...discoveredMarket }], universeIds: [1n], selectedUniverseId: 1n }
			},
			walletChainId: async () => configuration.chainId,
			connectWallet: async () => account,
			createTradingWalletClient: () => walletClient,
			loadWalletHeaderBalances: async () => ({ ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, repToken: `0x${'47'.repeat(20)}` as Address }),
			loadLiveBalances: async (_client: unknown, selected: LiveMarket) => {
				balanceLoads += 1
				return { scope: shareBalanceScope(selected), invalid: 3n * 10n ** 36n, yes: yesBalance, no: 3n * 10n ** 36n, lp: 0n }
			},
			simulateEntry: async () => ({
				blockNumber: 1n,
				blockHash: `0x${'aa'.repeat(32)}` as const,
				amount: 10n ** 16n,
				side: 'YES' as const,
				market: discoveredMarket,
				deadline: 2n ** 40n,
				slippageBps: 50n,
				minimumLongShares: 1n,
				result: { completeSetShares: 10n ** 34n, oppositeSharesSwapped: 10n ** 34n, additionalLongShares: 10n ** 34n, totalLongShares: 2n * 10n ** 34n, invalidInsurance: 10n ** 34n, feeAmount: 1n, conditionalYesBpsBefore: 5_000n, conditionalYesBpsAfter: 5_001n },
			}),
			simulateExit: async (_client: unknown, _configuration: unknown, selected: LiveMarket, _account: unknown, _side: unknown, completeSets: bigint) => {
				exitRequests.push(completeSets)
				if (failExitSimulation) throw new Error('execution reverted: ERC1155: receiver rejected tokens during batch-transfer acceptance check')
				return {
					blockNumber: 1n,
					blockHash: `0x${'aa'.repeat(32)}` as const,
					completeSets,
					side: 'YES' as const,
					market: selected,
					deadline: 2n ** 40n,
					slippageBps: 50n,
					maximumLongShares: 2n * completeSets,
					minimumEth: 1n,
					result: { completeSetShares: completeSets, longSharesSwapped: completeSets, totalLongShares: 2n * completeSets, invalidInsurance: completeSets, ethOut: 10n ** 15n, feeAmount: 1n },
				}
			},
		}
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' refreshIntervalMilliseconds={40} onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => button('Connect wallet').click())
		await waitForDom(() => walletMetric('Wallet YES') === '3 YES', 'wallet balances shown as collateral value')
		expect(document.body.textContent).toContain('3 INVALID')
		expect(document.body.textContent).toContain('Conditional YES 50.0%')
		expect(document.body.textContent).not.toContain('Current spot price')
		expect(document.body.textContent).not.toContain('Refresh')
		expect(document.body.textContent).not.toContain('Loading balances')

		// Background refreshes keep the loaded balances on screen and pick up market changes.
		const discoveriesBeforeBackgroundRefresh = discoveries
		const balanceLoadsBeforeBackgroundRefresh = balanceLoads
		discoveredMarket = { ...market, yesReserve: 25n * 10n ** 36n, noReserve: 75n * 10n ** 36n }
		const observedBalanceLabels = new Set<string | undefined>()
		await waitForDom(() => {
			observedBalanceLabels.add(walletMetric('Wallet YES'))
			return document.body.textContent?.includes('YES 75.0%') === true && balanceLoads > balanceLoadsBeforeBackgroundRefresh
		}, 'background market refresh')
		expect(discoveries).toBeGreaterThan(discoveriesBeforeBackgroundRefresh)
		expect([...observedBalanceLabels]).toEqual(['3 YES'])
		expect(document.querySelector('[aria-busy="true"]')).toBeNull()

		// A quote survives refreshes that do not change its basis and is retired when reserves move.
		await act(async () => button('Preview trade').click())
		await waitForDom(() => document.querySelector('.transaction-review-primary') !== null, 'entry quote')
		expect(document.body.textContent).toContain('0.02 YES')
		await settle(120)
		expect(document.querySelector('.transaction-review-primary')).not.toBeNull()
		discoveredMarket = { ...discoveredMarket, yesReserve: 30n * 10n ** 36n }
		await waitForDom(() => document.querySelector('.transaction-review-primary') === null, 'quote retired after reserve change')
		expect(document.body.textContent).toContain('Preview trade')

		// Exits are entered as collateral value and converted to the share amount the router redeems.
		await act(async () => button('Exit').click())
		const amountInput = document.querySelector<HTMLInputElement>('.operation-block .amount-input input')
		if (amountInput === null) throw new Error('Amount input is unavailable')
		await act(() => {
			amountInput.value = '0.5'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(document.body.textContent).toContain('Maximum insured YES exit')
		await act(async () => button('Preview trade').click())
		await waitForDom(() => document.querySelector('.transaction-review-primary') !== null, 'exit quote')
		expect(exitRequests).toEqual([5n * 10n ** 35n])
		expect(document.body.textContent).toContain('0.5 complete sets')
		await act(() => {
			amountInput.value = '0.0000000000000000001'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(document.body.textContent).toContain('Use no more than 18 decimal places')
		expect(button('Preview trade').disabled).toBeTrue()
		await act(() => {
			amountInput.value = '9'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(document.body.textContent).toContain('long-share balance and pair liquidity support an insured exit of at most')
		expect(button('Preview trade').disabled).toBeTrue()

		// Simulation failures stay beside the action instead of only at the top of the route.
		failExitSimulation = true
		await act(() => {
			amountInput.value = '0.25'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(async () => button('Preview trade').click())
		await waitForDom(() => document.querySelector('.operation-block .notice.error') !== null, 'simulation failure beside the action')
		expect(document.querySelector('.operation-block .notice.error')?.textContent).toContain('receiver rejected tokens')
		expect(document.body.textContent).toContain('Transaction workflow needs attention')
		yesBalance = 4n * 10n ** 36n
		await waitForDom(() => walletMetric('Wallet YES') === '4 YES', 'refreshed balance after failure')
	})

	test('lets a balance read slower than the refresh interval finish instead of restarting it every cycle', async () => {
		let balanceLoads = 0
		let releaseBalances: () => void = () => undefined
		const gate = new Promise<void>(resolve => {
			releaseBalances = resolve
		})
		Reflect.set(window, 'ethereum', { request: async () => undefined, on: () => undefined, removeListener: () => undefined })
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverAddressedMarket: async () => ({ start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [{ ...market }], universeIds: [1n], selectedUniverseId: 1n }),
			walletChainId: async () => configuration.chainId,
			connectWallet: async () => account,
			createTradingWalletClient: () => ({}),
			loadWalletHeaderBalances: async () => ({ ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, repToken: `0x${'47'.repeat(20)}` as Address }),
			loadLiveBalances: async (_client: unknown, selected: LiveMarket) => {
				balanceLoads += 1
				await gate
				return { scope: shareBalanceScope(selected), invalid: 2n * 10n ** 36n, yes: 2n * 10n ** 36n, no: 2n * 10n ** 36n, lp: 0n }
			},
		}
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' refreshIntervalMilliseconds={30} onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => button('Connect wallet').click())
		await waitForDom(() => walletMetric('Wallet YES') === 'Loading balances…' && balanceLoads > 0, 'first balance read in flight')
		await settle(150)
		expect(balanceLoads).toBe(1)
		releaseBalances()
		await waitForDom(() => walletMetric('Wallet YES') === '2 YES', 'slow balance read completes')
		await waitForDom(() => balanceLoads > 1, 'revalidation resumes after the read completes')
		expect(walletMetric('Wallet YES')).toBe('2 YES')
	})

	test('lets a background discovery slower than the refresh interval finish instead of starting another each tick', async () => {
		let discoveries = 0
		let releaseDiscovery: () => void = () => undefined
		let gate: Promise<void> | undefined
		const page = (markets: LiveMarket[]) => ({ start: 0n, count: BigInt(markets.length), total: BigInt(markets.length), previousStart: undefined, nextStart: undefined, markets, universeIds: [1n], selectedUniverseId: 1n })
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverAllLiveMarketsInUniverse: async () => {
				discoveries += 1
				if (gate !== undefined) await gate
				return page([{ ...market, title: `Portfolio market ${discoveries.toString()}` }])
			},
		}
		const rendered = await renderIntoDocument(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' refreshIntervalMilliseconds={30} onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.body.textContent?.includes('Portfolio market 1') === true, 'initial portfolio discovery')
		// Gate the next background discovery for several ticks; only one may be in flight.
		gate = new Promise<void>(resolve => {
			releaseDiscovery = resolve
		})
		await waitForDom(() => discoveries === 2, 'background discovery started')
		await settle(150)
		expect(discoveries).toBe(2)
		expect(document.body.textContent).toContain('Portfolio market 1')
		gate = undefined
		releaseDiscovery()
		await waitForDom(() => document.body.textContent?.includes('Portfolio market 2') === true, 'slow background discovery commits')
		await waitForDom(() => discoveries > 2, 'refresh cadence resumes')
	})

	test('lookup routes wait for an address and only discover universes', async () => {
		let universeDiscoveries = 0
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				universeDiscoveries += 1
				return { start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [1n, 2n], selectedUniverseId: 1n }
			},
			discoverTradingMarketPage: async () => {
				throw new Error('Lookup routes must not page through markets')
			},
			discoverLiveUniverseMarketPage: async () => {
				throw new Error('Lookup routes must not page through SecurityPools')
			},
			discoverAddressedMarket: async () => {
				throw new Error('Lookup routes have no address to discover')
			},
		}
		const universes: Array<readonly bigint[]> = []
		for (const route of ['market', 'liquidity', 'create-market'] as const) {
			const rendered = await renderIntoDocument(<LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} onUniversesChange={ids => universes.push(ids)} controllerServices={services} refreshIntervalMilliseconds={20} />)
			cleanupRendered = rendered.cleanup
			await waitForDom(() => universes.length > 0, `${route} universe discovery`)
			await settle(60)
			expect(rendered.container.querySelector('.market-lookup')).not.toBeNull()
			expect(rendered.container.querySelector('.market-row')).toBeNull()
			expect(rendered.container.querySelector(`.market-lookup a[href="#/${route === 'create-market' ? 'security-pools' : 'markets'}"]`)).not.toBeNull()
			expect(rendered.container.querySelector('form.open-pool-form')).not.toBeNull()
			// Static guidance has nothing to refresh, so the background timer stays idle here.
			expect(universeDiscoveries).toBe(1)
			await rendered.cleanup()
			cleanupRendered = undefined
			universeDiscoveries = 0
			universes.length = 0
		}
		expect(universes).toHaveLength(0)
	})
})
