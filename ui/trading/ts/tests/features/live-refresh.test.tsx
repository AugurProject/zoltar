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

function actionFeedback() {
	return document.querySelector('[role="tabpanel"] .tx-action-feedback')?.textContent ?? ''
}

function walletMetric(label: string) {
	const term = Array.from(document.querySelectorAll('.metric-label')).find(candidate => candidate.textContent === label)
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
		// The lookup instruction belongs to the landing list, not to an opened market.
		expect(document.body.textContent).not.toContain('Open a market by SecurityPool address')
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
		const amountInput = document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')
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
		expect(actionFeedback()).toContain('Use no more than 18 decimal places')
		expect(button('Preview trade').getAttribute('aria-describedby')).toBe(document.querySelector('[role="tabpanel"] .tx-action-notice')?.id ?? null)
		expect(button('Preview trade').disabled).toBeTrue()
		// Guards resolve in priority order: an exit above the wallet balance is reported before the tighter insured-exit limit.
		await act(() => {
			amountInput.value = '9'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(actionFeedback()).toContain('Insufficient YES balance.')
		expect(button('Preview trade').disabled).toBeTrue()
		await act(() => {
			amountInput.value = '2.5'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(actionFeedback()).toContain('long-share balance and pair liquidity support an insured exit of at most')
		expect(document.querySelectorAll('[role="tabpanel"] .tx-action-notice')).toHaveLength(1)
		expect(button('Preview trade').disabled).toBeTrue()

		// Simulation failures stay beside the action instead of only at the top of the route.
		failExitSimulation = true
		await act(() => {
			amountInput.value = '0.25'
			amountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await act(async () => button('Preview trade').click())
		await waitForDom(() => document.querySelector('[role="tabpanel"] .notice.error') !== null, 'simulation failure beside the action')
		expect(document.querySelector('[role="tabpanel"] .notice.error')?.textContent).toContain('receiver rejected tokens')
		// The failure is announced once beside the action; no route-level or status duplicate repeats it.
		expect(Array.from(document.querySelectorAll('[role="alert"]')).filter(candidate => candidate.textContent?.includes('receiver rejected tokens') === true)).toHaveLength(1)
		expect(document.body.textContent).not.toContain('Transaction workflow needs attention')
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
		gate = new Promise<void>(resolve => {
			releaseDiscovery = resolve
		})
		const rendered = await renderIntoDocument(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' refreshIntervalMilliseconds={30} onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		// While discovery is still running the route shows one live loading state and no terminal empty state.
		await waitForDom(() => document.body.textContent?.includes('Discovering SecurityPools…') === true, 'portfolio discovery status')
		expect(document.body.querySelector('.empty-state[role="status"]')?.textContent).toContain('Discovering SecurityPools…')
		expect(document.body.textContent).not.toContain('No YES, NO, INVALID, or LP balance was found')
		gate = undefined
		releaseDiscovery()
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

	test('lookup routes list the same candidates as their browse alias above the address lookup', async () => {
		let universeDiscoveries = 0
		const pagedRoutes: string[] = []
		const page = (markets: LiveMarket[]) => ({ start: 0n, count: BigInt(markets.length), total: BigInt(markets.length), previousStart: undefined, nextStart: undefined, markets, universeIds: [1n, 2n], selectedUniverseId: 1n })
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				universeDiscoveries += 1
				return page([])
			},
			discoverTradingMarketPage: async () => {
				pagedRoutes.push('markets')
				return page([{ ...market }])
			},
			discoverLiveUniverseMarketPage: async () => {
				pagedRoutes.push('security-pools')
				return page([{ ...market, pair: undefined }])
			},
			discoverAddressedMarket: async () => {
				throw new Error('Lookup routes have no address to discover')
			},
		}
		for (const [route, listRoute] of [
			['market', 'markets'],
			['liquidity', 'markets'],
			['create-market', 'security-pools'],
		] as const) {
			const universes: Array<readonly bigint[]> = []
			const rendered = await renderIntoDocument(<LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} onUniversesChange={ids => universes.push(ids)} controllerServices={services} refreshIntervalMilliseconds={20} />)
			cleanupRendered = rendered.cleanup
			await waitForDom(() => rendered.container.querySelectorAll('.market-record').length === 1, `${route} candidate list`)
			expect(universes.length).toBeGreaterThan(0)
			expect(pagedRoutes.at(-1)).toBe(listRoute)
			expect(rendered.container.querySelector('form.open-pool-form')).not.toBeNull()
			expect(rendered.container.querySelector(`.market-record a[href="#/${route === 'create-market' ? 'create-market' : 'market'}/${pool}"]`)).not.toBeNull()
			// The primary row action follows the workflow the landing names.
			expect(rendered.container.querySelector('.market-record .button-link.primary')?.getAttribute('href')).toBe(`#/${route}/${pool}`)
			expect(universeDiscoveries).toBe(0)
			await rendered.cleanup()
			cleanupRendered = undefined
			pagedRoutes.length = 0
		}
	})
})
