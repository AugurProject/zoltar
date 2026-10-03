import { setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { marketDownloadStore } from '../../lib/favoriteMarkets.js'
import type { discoverSavedMarkets } from '../../protocol/marketDiscovery.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { useLiveTradingController } from '../../features/liveTradingController.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { shareBalanceScope, type LiveMarket } from '../../protocol/live.js'
import { appBlockWatcher, invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import { largestExitForLongShares } from '@zoltar/trading-shared/trading/positions'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { buttonByLabel, waitForDom } from '../support/dom.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'
import { connectedWalletServices, discoveryPage, installSilentInjectedWallet, offlineControllerServices } from '../support/liveTradingServices.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const configuration = deploymentConfigurationFixture()

// One attoETH of collateral is worth 10^18 attoShares, mirroring the SecurityPool genesis rate that makes raw share counts unreadable.
const market = etherScaleMarketFixture({ pool, pair, shareToken, title: 'Background fixture market', description: 'Background refresh fixture' })

// Stands in for the chain: reports a new block every interval so the block-driven background refresh runs.
function produceBlocks(milliseconds: number) {
	let block = (appBlockWatcher.getLatestBlockNumber() ?? 0n) + 1n
	appBlockWatcher.reportBlock(block)
	const timer = setInterval(() => {
		block += 1n
		appBlockWatcher.reportBlock(block)
	}, milliseconds)
	return () => clearInterval(timer)
}

async function settle(milliseconds = 10) {
	await act(async () => {
		await Bun.sleep(milliseconds)
	})
}

function actionFeedback() {
	return document.querySelector('[role="tabpanel"] .tx-action-feedback')?.textContent ?? ''
}

function walletHolding(label: string) {
	return document.querySelector(`.market-holdings [data-outcome="${label.replace('Wallet ', '').toLowerCase()}"] .holding-quantity`)?.textContent ?? ''
}

async function renderDiscoveryController(
	services: Parameters<typeof useLiveTradingController>[0]['services'],
	initialRoute = 'portfolio',
	onRender?: (route: string, discovery: ReturnType<typeof useLiveTradingController>['discovery']) => void,
	onUniversesChange: Parameters<typeof useLiveTradingController>[0]['onUniversesChange'] = () => undefined,
) {
	let controller: ReturnType<typeof useLiveTradingController> | undefined
	function Harness({ route = initialRoute }: { route?: string }) {
		controller = useLiveTradingController({
			route,
			configuration,
			configurationError: undefined,
			selectedUniverseId: '1',
			onUniversesChange,
			onWorkflowLockChange: () => undefined,
			onWalletSummaryChange: () => undefined,
			walletSummaryRetryNonce: 0,
			defaultSlippage: '0.5',
			defaultValidityMinutes: '20',
			services,
		})
		onRender?.(route, controller.discovery)
		return (
			<div>
				{controller.discovery.visibleMarkets.map(market => (
					<div key={market.pool}>{market.title}</div>
				))}
			</div>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	return {
		...rendered,
		navigate: async (route: string) => await act(() => render(<Harness route={route} />, rendered.container)),
		state: () => {
			if (controller === undefined) throw new Error('Controller has not rendered')
			return controller
		},
	}
}

describe('live market refresh', () => {
	let cleanupRendered: (() => Promise<void>) | undefined
	let stopBlocks: (() => void) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			stopBlocks?.()
			stopBlocks = undefined
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: `http://localhost/?demo=0#/market/${pool}`,
	})

	test('an empty saved portfolio checks only the saved list, including manual refreshes', async () => {
		const snapshots: Array<readonly { pool: Address }[]> = []
		const rendered = await renderDiscoveryController({
			...offlineControllerServices,
			discoverSavedMarkets: async (_client, _configuration, _universe, saved) => {
				snapshots.push(saved)
				return discoveryPage([])
			},
		})
		cleanupRendered = rendered.cleanup
		await waitForDom(() => rendered.state().discovery.discoveryState === 'ready', 'empty portfolio')
		await act(() => rendered.state().discovery.refresh())
		expect(snapshots).toEqual([[], []])
	})

	test('portfolio discovery follows saved pools and markets, excluding unfavorited cache entries', async () => {
		const other = { ...market, pool: '0x8888888888888888888888888888888888888888' as const }
		const unrelated = { ...market, pool: '0x9999999999999999999999999999999999999999' as const }
		const poolScope = getLocalEntityScope('trading', 'pool')
		const marketScope = getLocalEntityScope('trading', 'market')
		marketDownloadStore.record(
			poolScope,
			[market, other, unrelated].map(data => ({ id: data.pool, data })),
		)
		marketDownloadStore.record(marketScope, [{ id: market.pool, data: market }])
		setEntityFavorite(poolScope, market.pool, true)
		setEntityFavorite(poolScope, other.pool, true)
		setEntityFavorite(marketScope, market.pool, true)
		const snapshots: Array<readonly Address[]> = []
		const rendered = await renderDiscoveryController({
			...offlineControllerServices,
			discoverSavedMarkets: async (_client, _configuration, _universe, saved) => {
				snapshots.push(saved.map(entry => entry.pool))
				return discoveryPage([])
			},
		})
		cleanupRendered = rendered.cleanup
		await waitForDom(() => snapshots.length === 1, 'saved pools')
		expect(snapshots[0]).toEqual([other.pool, market.pool])
		await act(() => setEntityFavorite(poolScope, other.pool, false))
		await waitForDom(() => snapshots.length === 2, 'removed saved pool')
		expect(snapshots[1]).toEqual([market.pool])
	})

	test('unmounting cancels queued portfolio discovery reads', async () => {
		const firstRead = createDeferred<void>()
		let started = false
		let laterReads = 0
		let universeUpdates = 0
		const rendered = await renderDiscoveryController(
			{
				...offlineControllerServices,
				discoverSavedMarkets: async (_client, _configuration, _universe, _saved, _progress, isCurrent) => {
					started = true
					await firstRead.promise
					if (isCurrent?.()) laterReads += 1
					return discoveryPage([market])
				},
			},
			'portfolio',
			undefined,
			() => {
				universeUpdates += 1
			},
		)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => started, 'first portfolio read')
		await rendered.cleanup()
		cleanupRendered = undefined
		firstRead.resolve()
		await settle()
		expect(laterReads).toBe(0)
		expect(universeUpdates).toBe(0)
	})

	test('caching a saved market summary does not restart portfolio discovery', async () => {
		setEntityFavorite(getLocalEntityScope('trading', 'market'), market.pool, true)
		let reads = 0
		const rendered = await renderIntoDocument(
			<LiveTrading
				route='portfolio'
				configuration={configuration}
				configurationError={undefined}
				selectedUniverseId='1'
				onWorkflowLockChange={() => undefined}
				controllerServices={{
					...offlineControllerServices,
					discoverSavedMarkets: async () => {
						reads += 1
						return discoveryPage([{ ...market }])
					},
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => marketDownloadStore.read(getLocalEntityScope('trading', 'market')).length === 1, 'saved summary cache')
		await settle()
		expect(reads).toBe(1)
	})

	test('does not carry a missing pool result into another addressed route', async () => {
		const nextPool = getAddress('0x00000000000000000000000000000000000000a2')
		const pending = createDeferred<ReturnType<typeof discoveryPage>>()
		const oldRoute = `security-pool/${pool}`
		const nextRoute = `market/${nextPool}`
		const observations: string[] = []
		const harness = await renderDiscoveryController(
			{
				...offlineControllerServices,
				discoverAddressedMarket: async (_client, _config, address) => {
					if (address === pool) throw Object.assign(new Error('Security pool does not exist.'), { name: 'SecurityPoolNotFoundError' })
					return await pending.promise
				},
			},
			oldRoute,
			(route, discovery) => {
				if (route === nextRoute) observations.push(discovery.discoveryState)
			},
		)
		cleanupRendered = harness.cleanup
		await waitForDom(() => harness.state().discovery.discoveryState === 'not-found')
		await harness.navigate(nextRoute)
		expect(observations[0]).toBe('loading')
		expect(observations).not.toContain('not-found')
		await act(async () => pending.resolve(discoveryPage([{ ...market, pool: nextPool }])))
		await waitForDom(() => harness.state().discovery.selected?.pool === nextPool)
	})

	test('explicit invalidation retains first-load rows and reruns foreground progress', async () => {
		const finish = createDeferred<void>()
		const progress = createDeferred<void>()
		let reads = 0
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Later row' }
		const discover: typeof discoverSavedMarkets = async (_client, _configuration, _universe, _saved, onProgress) => {
			const read = ++reads
			if (read === 2) await progress.promise
			onProgress?.(discoveryPage(read === 1 ? [market] : [market, second]))
			await finish.promise
			return discoveryPage([market, second])
		}
		const rendered = await renderDiscoveryController({ ...offlineControllerServices, discoverSavedMarkets: discover })
		cleanupRendered = rendered.cleanup
		try {
			await waitForDom(() => rendered.state().discovery.visibleMarkets.length === 1, 'first row')
			await act(() => invalidateAppData())
			await waitForDom(() => reads === 2, 'foreground rerun')
			expect(rendered.state().discovery.visibleMarkets).toEqual([market])
			progress.resolve()
			await waitForDom(() => rendered.state().discovery.visibleMarkets.length === 2, 'rerun progress')
			expect(rendered.state().discovery.discoveryState).toBe('loading')
		} finally {
			progress.resolve()
			finish.resolve()
		}
	})

	test('explicit invalidation supersedes a pending manual refresh without another block', async () => {
		appBlockWatcher.reportBlock(appBlockWatcher.getLatestBlockNumber() ?? 0n)
		const older = createDeferred<void>()
		let reads = 0
		const services = {
			...offlineControllerServices,
			discoverSavedMarkets: async () => {
				const read = ++reads
				if (read === 2) await older.promise
				return discoveryPage([{ ...market, title: read >= 3 ? 'Explicitly refreshed' : 'Old state' }])
			},
		}
		const rendered = await renderDiscoveryController(services)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => rendered.state().discovery.discoveryState === 'ready', 'initial discovery')
		await act(() => {
			appBlockWatcher.reportBlock(appBlockWatcher.getLatestBlockNumber() ?? 0n)
			appBlockWatcher.reportBlock((appBlockWatcher.getLatestBlockNumber() ?? 0n) + 1n)
		})
		await settle()
		expect(reads).toBe(1)
		await act(() => {
			void rendered.state().discovery.refresh()
		})
		await waitForDom(() => reads === 2, 'manual refresh')
		try {
			await act(() => invalidateAppData())
			await waitForDom(() => reads === 3, 'explicit refresh')
			await waitForDom(() => document.body.textContent?.includes('Explicitly refreshed') === true, 'new state')
			await act(async () => {
				older.resolve()
				await Bun.sleep(0)
			})
			expect(document.body.textContent).toContain('Explicitly refreshed')
		} finally {
			older.resolve()
		}
	})

	for (const supersede of [false, true])
		for (const outcome of ['success', 'error'])
			test(`restores the initial list when a workflow blocks partial discovery ${outcome} (superseded: ${supersede})`, async () => {
				const finish = createDeferred<void>()
				let reads = 0
				const discover: typeof discoverSavedMarkets = async (_client, _configuration, _universe, _saved, onProgress) => {
					reads += 1
					onProgress?.(discoveryPage([market]))
					await finish.promise
					if (outcome === 'error') throw new Error('Read failed')
					return discoveryPage([market])
				}
				const rendered = await renderDiscoveryController({ ...offlineControllerServices, discoverSavedMarkets: discover })
				cleanupRendered = rendered.cleanup
				try {
					await waitForDom(() => rendered.state().discovery.visibleMarkets.length === 1, 'partial row')
					if (supersede) {
						await act(() => invalidateAppData())
						await waitForDom(() => reads === 2, 'replacement discovery')
					}
					await act(() => rendered.state().workflow.updateLiquidityWorkflowLock(true))
					await act(async () => {
						finish.resolve()
						await Bun.sleep(0)
					})
					await waitForDom(() => rendered.state().discovery.discoveryState === 'ready', 'blocked discovery settled')
					expect(rendered.state().discovery.visibleMarkets).toEqual([])
					expect(rendered.state().discovery.marketPage.total).toBe(0n)
				} finally {
					finish.resolve()
				}
			})

	test('preserves every loaded market when a partial foreground refresh later times out', async () => {
		const timeout = createDeferred<void>()
		const first = { ...market, title: 'Fast market' }
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Slow market' }
		const page = (markets: LiveMarket[]) => ({ start: 0n, count: 2n, total: 2n, previousStart: undefined, nextStart: undefined, markets, universeIds: [1n], selectedUniverseId: 1n })
		let reads = 0
		const discover: typeof discoverSavedMarkets = async (_client, _configuration, _universe, _saved, onProgress) => {
			if (++reads === 1) return page([first, second])
			onProgress?.(page([first]))
			await timeout.promise
			throw new Error('RPC read timed out. Retry loading data.')
		}
		const services = { ...offlineControllerServices, discoverSavedMarkets: discover }
		let controller: ReturnType<typeof useLiveTradingController> | undefined
		function Harness() {
			controller = useLiveTradingController({
				route: 'portfolio',
				configuration,
				configurationError: undefined,
				selectedUniverseId: '1',
				onUniversesChange: () => undefined,
				onWorkflowLockChange: () => undefined,
				onWalletSummaryChange: () => undefined,
				walletSummaryRetryNonce: 0,
				defaultSlippage: '0.5',
				defaultValidityMinutes: '20',
				services,
			})
			return (
				<div>
					{controller.discovery.visibleMarkets.map(market => (
						<div key={market.pool}>{market.title}</div>
					))}
				</div>
			)
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.body.textContent?.includes('Slow market') === true, 'initial markets')
		if (controller === undefined) throw new Error('Controller has not rendered')
		let refresh: Promise<void> | undefined
		await act(() => {
			refresh = controller?.discovery.refresh()
		})
		try {
			await waitForDom(() => reads === 2, 'partial refresh after deployment validation')
			expect(document.body.textContent).toContain('Slow market')
			await act(async () => {
				timeout.resolve()
				await refresh
			})
			expect(controller.discovery.discoveryState).toBe('error')
			expect(document.body.textContent).toContain('Fast market')
			expect(document.body.textContent).toContain('Slow market')
		} finally {
			timeout.resolve()
			await refresh
		}
	})

	test('refreshes market data in the background without hiding loaded balances, re-prices the live estimate, and stops a submission the chain prices differently', async () => {
		let discoveredMarket = market
		let discoveries = 0
		let balanceLoads = 0
		const walletSummaries: WalletSummaryState[] = []
		const observeWallet = (summary: WalletSummaryState) => walletSummaries.push(summary)
		let yesBalance = 3n * 10n ** 18n
		const exitRequests: bigint[] = []
		let failExitSimulation = false
		installSilentInjectedWallet()
		const walletClient = { waitForTransactionReceipt: async () => ({ status: 'success' as const }) }
		const services = {
			...offlineControllerServices,
			discoverUniverses: async () => {
				throw new Error('Addressed routes must not run universe-only discovery')
			},
			discoverTradingMarketPage: async () => {
				throw new Error('Addressed routes must not page through markets')
			},
			discoverAddressedMarket: async () => {
				discoveries += 1
				// Live discovery always builds fresh market objects, which is what lets dependent balance reads revalidate.
				return discoveryPage([{ ...discoveredMarket }])
			},
			...connectedWalletServices(account, configuration.chainId),
			createTradingWalletClient: () => walletClient,
			loadLiveBalances: async (_client: unknown, selected: LiveMarket) => {
				balanceLoads += 1
				return { scope: shareBalanceScope(selected), invalid: 3n * 10n ** 18n, yes: yesBalance, no: 3n * 10n ** 18n, lp: 0n }
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
				result: { completeSetShares: 10n ** 16n, oppositeSharesSwapped: 10n ** 16n, additionalLongShares: 10n ** 16n, totalLongShares: 2n * 10n ** 16n, invalidInsurance: 10n ** 16n, feeAmount: 1n, conditionalYesBpsBefore: 5_000n, conditionalYesBpsAfter: 5_001n },
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
		stopBlocks?.()
		stopBlocks = produceBlocks(40)
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} onWalletSummaryChange={observeWallet} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => buttonByLabel('Connect wallet').click())
		await waitForDom(() => walletHolding('Wallet Yes') === '3 Yes', 'wallet balances shown as collateral value')
		// The lookup instruction belongs to the landing list, not to an opened market.
		expect(document.body.textContent).not.toContain('Open a market by security pool address')
		expect(document.body.textContent).toContain('3 Invalid')
		expect(document.body.textContent).toContain('Conditional Yes 50.0%')
		expect(document.body.textContent).not.toContain('Current spot price')
		expect(document.body.textContent).not.toContain('Refresh')
		expect(document.body.textContent).not.toContain('Loading balances')

		// Background refreshes keep the loaded balances on screen and pick up market changes.
		await waitForDom(() => walletSummaries.at(-1)?.ethAttoEth === 5n * 10n ** 18n, 'wallet ETH balance')
		walletSummaries.length = 0
		const discoveriesBeforeBackgroundRefresh = discoveries
		const balanceLoadsBeforeBackgroundRefresh = balanceLoads
		discoveredMarket = { ...market, yesReserve: 25n * 10n ** 18n, noReserve: 75n * 10n ** 18n }
		const observedBalanceLabels = new Set<string | undefined>()
		await waitForDom(() => {
			observedBalanceLabels.add(walletHolding('Wallet Yes'))
			return document.body.textContent?.includes('Yes 75.0%') === true && balanceLoads > balanceLoadsBeforeBackgroundRefresh
		}, 'background market refresh')
		expect(discoveries).toBeGreaterThan(discoveriesBeforeBackgroundRefresh)
		expect([...observedBalanceLabels]).toEqual(['3 Yes'])
		expect(walletSummaries.length).toBeGreaterThan(0)
		expect(walletSummaries.every(summary => summary.ethAttoEth === 5n * 10n ** 18n)).toBeTrue()
		expect(document.querySelector('[aria-busy="true"]')).toBeNull()

		// The estimate needs no preview step: it follows the typed amount and re-prices when the reserves move.
		const amountInput = document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')
		if (amountInput === null) throw new Error('Amount input is unavailable')
		expect(amountInput.value).toBe('')
		const typeAmount = async (value: string) => {
			await act(() => {
				amountInput.value = value
				amountInput.dispatchEvent(new Event('input', { bubbles: true }))
			})
			await settle(300)
		}
		await typeAmount('0.01')
		await waitForDom(() => document.querySelector('.transaction-review-primary') !== null, 'entry estimate')
		expect(buttonByLabel('Buy Yes').disabled).toBeFalse()
		const estimateBeforeMove = document.querySelector('.transaction-review-primary')?.textContent
		discoveredMarket = { ...discoveredMarket, yesReserve: 30n * 10n ** 18n }
		await waitForDom(() => document.querySelector('.transaction-review-primary')?.textContent !== estimateBeforeMove, 'estimate re-priced after reserve change')

		// Sells are entered in shares, with shortcuts, and priced locally before the chain is asked.
		await act(async () => buttonByLabel('Sell').click())
		expect(amountInput.value).toBe('')
		expect(document.body.textContent).toContain('You hold 3 Yes')
		expect(['25%', '50%', 'Max'].every(label => buttonByLabel(label) instanceof HTMLButtonElement)).toBeTrue()
		await typeAmount('0.5')
		await waitForDom(() => document.querySelector('.transaction-review-primary')?.textContent?.includes('You sell') === true, 'exit estimate')
		const expectedCompleteSets = largestExitForLongShares({ ...discoveredMarket, longOutcome: 'YES', longShares: 5n * 10n ** 17n })
		// The chain prices this exit well above the estimate, so the submission stops before the wallet opens.
		const discoveriesBeforeSubmit = discoveries
		await act(async () => buttonByLabel('Sell Yes').click())
		await waitForDom(() => document.querySelector('[role="tabpanel"] .notice.warning') !== null, 'price-moved notice')
		expect(exitRequests).toEqual([expectedCompleteSets])
		// A re-quote is a prompt to review, not a failure.
		expect(document.querySelector('[role="tabpanel"] .notice.warning')?.textContent).toContain('The price moved since your estimate')
		expect(document.querySelector('[role="tabpanel"] .notice.error')).toBeNull()
		expect(discoveries).toBeGreaterThan(discoveriesBeforeSubmit)
		await typeAmount('0.0000000000000000001')
		expect(actionFeedback()).toContain('Enter a share amount with at most 18 decimal places.')
		expect(buttonByLabel('Sell Yes').getAttribute('aria-describedby')).toBe(document.querySelector('[role="tabpanel"] .tx-action-feedback .tx-action-notice')?.id ?? null)
		expect(buttonByLabel('Sell Yes').disabled).toBeTrue()
		await typeAmount('9')
		expect(actionFeedback()).toContain('Insufficient Yes balance.')
		expect(document.querySelectorAll('[role="tabpanel"] .tx-action-feedback .tx-action-notice')).toHaveLength(1)
		expect(buttonByLabel('Sell Yes').disabled).toBeTrue()

		// Simulation failures stay beside the action instead of only at the top of the route.
		failExitSimulation = true
		await typeAmount('0.25')
		await act(async () => buttonByLabel('Sell Yes').click())
		await waitForDom(() => document.querySelector('[role="tabpanel"] .notice.error')?.textContent?.includes('receiver rejected tokens') === true, 'simulation failure beside the action')
		// The failure is announced once beside the action; no route-level or status duplicate repeats it.
		expect(Array.from(document.querySelectorAll('[role="alert"]')).filter(candidate => candidate.textContent?.includes('receiver rejected tokens') === true)).toHaveLength(1)
		yesBalance = 4n * 10n ** 18n
		await waitForDom(() => walletHolding('Wallet Yes') === '4 Yes', 'refreshed balance after failure')
	})

	test('lets a balance read slower than the block interval finish instead of restarting it every cycle', async () => {
		let balanceLoads = 0
		let releaseBalances: () => void = () => undefined
		const gate = new Promise<void>(resolve => {
			releaseBalances = resolve
		})
		installSilentInjectedWallet()
		const services = {
			...offlineControllerServices,
			discoverAddressedMarket: async () => discoveryPage([{ ...market }]),
			...connectedWalletServices(account, configuration.chainId),
			createTradingWalletClient: () => ({}),
			loadLiveBalances: async (_client: unknown, selected: LiveMarket) => {
				balanceLoads += 1
				await gate
				return { scope: shareBalanceScope(selected), invalid: 2n * 10n ** 18n, yes: 2n * 10n ** 18n, no: 2n * 10n ** 18n, lp: 0n }
			},
		}
		stopBlocks?.()
		stopBlocks = produceBlocks(30)
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await act(async () => buttonByLabel('Connect wallet').click())
		await waitForDom(() => walletHolding('Wallet Yes') === 'Loading balances…' && balanceLoads > 0, 'first balance read in flight')
		await settle(150)
		expect(balanceLoads).toBe(1)
		releaseBalances()
		await waitForDom(() => walletHolding('Wallet Yes') === '2 Yes', 'slow balance read completes')
		await waitForDom(() => balanceLoads > 1, 'revalidation resumes after the read completes')
		expect(walletHolding('Wallet Yes')).toBe('2 Yes')
	})

	test('portfolio ignores new blocks and refreshes only when requested', async () => {
		let discoveries = 0
		const services = {
			...offlineControllerServices,
			discoverSavedMarkets: async () => {
				discoveries += 1
				return discoveryPage([{ ...market, title: `Portfolio market ${discoveries.toString()}` }])
			},
		}
		stopBlocks = produceBlocks(30)
		const rendered = await renderIntoDocument(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.body.textContent?.includes('Portfolio market 1') === true, 'initial portfolio discovery')
		await settle(150)
		expect(discoveries).toBe(1)
		await act(() => buttonByLabel('Refresh portfolio').click())
		await waitForDom(() => document.body.textContent?.includes('Portfolio market 2') === true, 'manual refresh')
		await settle(150)
		expect(discoveries).toBe(2)
	})

	test('retrying a saved pool whose market read failed reloads its details before balances', async () => {
		installSilentInjectedWallet()
		let discoveries = 0
		let failMarketRead = true
		const rendered = await renderDiscoveryController({
			...offlineControllerServices,
			...connectedWalletServices(account, configuration.chainId),
			createTradingWalletClient: () => ({}),
			discoverSavedMarkets: async () => {
				discoveries += 1
				return discoveryPage([{ ...market, loadError: failMarketRead ? 'Pool read failed' : undefined }])
			},
			loadLiveBalances: async (_client, selected) => ({ scope: shareBalanceScope(selected), invalid: 1n, yes: 1n, no: 0n, lp: 0n }),
		})
		cleanupRendered = rendered.cleanup
		await waitForDom(() => rendered.state().discovery.discoveryState === 'ready', 'failed pool snapshot')
		await act(() => rendered.state().wallet.connect())
		await waitForDom(() => rendered.state().balances.portfolioBalanceState === 'ready', 'failed pool balance state')
		const beforeRetry = discoveries
		failMarketRead = false
		await act(() => rendered.state().balances.retryPortfolioBalances())
		expect(discoveries).toBe(beforeRetry + 1)
		await waitForDom(() => rendered.state().balances.visiblePortfolioEntries[0]?.balances?.yes === 1n, 'recovered pool balances')
	})

	test('manual portfolio refresh updates completed rows while preserving rows still waiting', async () => {
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Previous second pool' }
		const scope = getLocalEntityScope('trading', 'pool')
		marketDownloadStore.record(
			scope,
			[market, second].map(data => ({ id: data.pool, data })),
		)
		setEntityFavorite(scope, second.pool, true)
		setEntityFavorite(scope, market.pool, true)
		const finish = createDeferred<void>()
		let reads = 0
		const rendered = await renderIntoDocument(
			<LiveTrading
				route='portfolio'
				configuration={configuration}
				configurationError={undefined}
				selectedUniverseId='1'
				onWorkflowLockChange={() => undefined}
				controllerServices={{
					...offlineControllerServices,
					discoverSavedMarkets: async (_client, _configuration, _universe, _saved, onProgress) => {
						if (++reads === 1) return discoveryPage([market, second])
						const first = { ...market, title: 'Refreshed first pool' }
						onProgress?.({ ...discoveryPage([first, second]), markets: [first, undefined] })
						await finish.promise
						return discoveryPage([first, { ...second, title: 'Refreshed second pool' }])
					},
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		try {
			await waitForDom(() => document.body.textContent?.includes('Previous second pool') === true, 'initial portfolio')
			await act(() => buttonByLabel('Refresh portfolio').click())
			await waitForDom(() => document.body.textContent?.includes('Refreshed first pool') === true, 'first refresh result')
			expect(document.body.textContent).toContain('Previous second pool')
			expect(buttonByLabel('Refreshing…').disabled).toBe(true)
			finish.resolve()
			await waitForDom(() => document.body.textContent?.includes('Refreshed second pool') === true, 'completed refresh')
		} finally {
			finish.resolve()
		}
	})

	test('lookup routes use saved favorites without scanning pool or pair registries, including block refreshes', async () => {
		let scans = 0
		let universeReads = 0
		const services = {
			...offlineControllerServices,
			discoverUniverses: async () => {
				universeReads += 1
				return discoveryPage([])
			},
			discoverTradingMarketPage: async () => {
				scans += 1
				return discoveryPage([market])
			},
			discoverLiveUniverseMarketPage: async () => {
				scans += 1
				return discoveryPage([market])
			},
		}
		for (const route of ['market', 'liquidity', 'create-market'] as const) {
			const rendered = await renderIntoDocument(<LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
			cleanupRendered = rendered.cleanup
			await waitForDom(() => universeReads > 0, 'universe discovery')
			await settle(50)
			await act(() => appBlockWatcher.reportBlock((appBlockWatcher.getLatestBlockNumber() ?? 0n) + 1n))
			await settle(50)
			expect(scans).toBe(0)
			expect(rendered.container.querySelector('form.market-list-search')).not.toBeNull()
			expect(rendered.container.querySelector('.discovery-control')).toBeNull()
			await rendered.cleanup()
			cleanupRendered = undefined
			universeReads = 0
		}
	})

	test('opening an address saves it for local browsing; unfavoriting removes it without scanning', async () => {
		const unrelated = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Unfavorited cache entry' }
		marketDownloadStore.record(getLocalEntityScope('trading', 'market'), [{ id: unrelated.pool, data: unrelated }])
		const services = { ...offlineControllerServices, discoverUniverses: async () => discoveryPage([]), discoverAddressedMarket: async () => discoveryPage([{ ...market }]) }
		const view = (route: 'market' | `market/${Address}`, universe = '1') => <LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId={universe} onWorkflowLockChange={() => undefined} controllerServices={services} />
		const rendered = await renderIntoDocument(view(`market/${pool}`))
		cleanupRendered = rendered.cleanup
		await waitForDom(() => marketDownloadStore.read(getLocalEntityScope('trading', 'market')).some(entry => entry.id === pool.toLowerCase()), 'opened market cached')
		await act(() => render(view('market'), rendered.container))
		await waitForDom(() => document.querySelectorAll('.market-record').length === 1, 'favorite market')
		expect(document.body.textContent).not.toContain(unrelated.title)
		expect(document.querySelector('.market-record .freshness-indicator')).not.toBeNull()
		await act(() => render(view('market', '2'), rendered.container))
		expect(document.querySelectorAll('.market-record')).toHaveLength(0)
		await act(() => render(view('market'), rendered.container))
		const star = document.querySelector<HTMLButtonElement>('.market-record .favorite-toggle')
		if (star === null) throw new Error('Favorite control missing')
		await act(() => star.click())
		expect(document.querySelectorAll('.market-record')).toHaveLength(0)
		expect(document.body.textContent).toContain('No favorite markets.')
	})

	test('pool favorites are searchable, stay separate from markets, and retain ended pools for details', async () => {
		const ended = { ...market, pair: undefined, endTime: 1n, title: 'Ended pool' }
		const scope = getLocalEntityScope('trading', 'pool')
		marketDownloadStore.record(scope, [{ id: ended.pool, data: ended }])
		setEntityFavorite(scope, ended.pool, true)
		const services = { ...offlineControllerServices, discoverUniverses: async () => discoveryPage([]) }
		const rendered = await renderIntoDocument(<LiveTrading route='create-market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.querySelector('.market-record') !== null, 'saved pool')
		expect(document.querySelector('.market-record')?.textContent).toContain('Ended pool')
		const input = document.querySelector<HTMLInputElement>('input[type="search"]')
		if (input === null) throw new Error('Pool search missing')
		await act(() => {
			input.value = 'unmatched'
			input.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(document.querySelector('.market-record')).toBeNull()
	})

	test('market sort settings do not leak into the pool directory', async () => {
		for (const kind of ['pool', 'market'] as const) {
			const scope = getLocalEntityScope('trading', kind)
			marketDownloadStore.record(scope, [{ id: market.pool, data: { ...market, pair: kind === 'pool' ? undefined : market.pair } }])
			setEntityFavorite(scope, market.pool, true)
		}
		const services = { ...offlineControllerServices, discoverUniverses: async () => discoveryPage([]) }
		const view = (route: 'market' | 'create-market') => <LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />
		const rendered = await renderIntoDocument(view('market'))
		cleanupRendered = rendered.cleanup
		await act(() => document.querySelector<HTMLButtonElement>('.enum-dropdown-trigger')?.click())
		await act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent === 'Liquidity')?.click())
		expect(document.querySelector('.enum-dropdown-trigger')?.textContent).toBe('Liquidity')
		await act(() => render(view('create-market'), rendered.container))
		expect(document.querySelector('.enum-dropdown-trigger')?.textContent).toBe('Recently saved')
	})

	test('the liquidity route exposes its controls on narrow screens without opening a dialog', async () => {
		window.location.hash = `#/liquidity/${pool}?simulate=1`
		const originalMatchMedia = window.matchMedia
		Reflect.set(window, 'matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
		const services = { ...offlineControllerServices, discoverAddressedMarket: async () => discoveryPage([market]) }
		const rendered = await renderIntoDocument(<LiveTrading route={`liquidity/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = async () => {
			await rendered.cleanup()
			Reflect.set(window, 'matchMedia', originalMatchMedia)
		}
		await waitForDom(() => document.querySelector('.liquidity-controls') !== null, 'liquidity controls')
		expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Liquidity')
		expect(document.querySelector('.market-ticket__panel')?.hasAttribute('hidden')).toBe(false)
		expect(document.querySelector('.market-ticket-bar')).toBeNull()
		expect(document.querySelector('[role="dialog"]')).toBeNull()
		expect(document.querySelector('input[name="amount"]')).not.toBeNull()
	})

	test('a ticket link opens the ticket on its direction and side and keeps them in the hash', async () => {
		window.location.hash = `#/market/${pool}?simulate=1&ticket=sell-no`
		const services = {
			...offlineControllerServices,
			discoverAddressedMarket: async () => discoveryPage([{ ...market, description: 'Resolves YES when the bridge opens.\n<b>not markup</b>' }]),
		}
		// The desktop layout keeps the ticket beside the market, so the compact-ticket media query must not match.
		const originalMatchMedia = window.matchMedia
		Reflect.set(window, 'matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
		cleanupRendered = async () => {
			Reflect.set(window, 'matchMedia', originalMatchMedia)
		}
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = async () => {
			await rendered.cleanup()
			Reflect.set(window, 'matchMedia', originalMatchMedia)
		}
		await waitForDom(() => document.querySelector('.outcome-picker') !== null, 'trade ticket')
		expect(document.querySelector('.outcome-picker button[aria-pressed="true"]')?.textContent).toBe('No 50%')
		expect(document.querySelector('.trade-ticket-switchers .view-tabs:not(.outcome-picker) button[aria-pressed="true"]')?.textContent).toBe('Sell')
		// The selection stays in the hash, so a refresh restores it.
		expect(window.location.hash).toBe(`#/market/${pool}?simulate=1&ticket=sell-no`)
		await act(async () => buttonByLabel('Yes 50%').click())
		expect(window.location.hash).toBe(`#/market/${pool}?simulate=1&ticket=sell-yes`)
		await act(async () => buttonByLabel('Buy').click())
		expect(window.location.hash).toBe(`#/market/${pool}?simulate=1`)
		// The reading column carries the question description as text, with contract addresses behind a disclosure.
		expect(document.querySelector('.market-description__text')?.textContent).toBe('Resolves YES when the bridge opens.\n<b>not markup</b>')
		expect(document.querySelector('.market-description b')).toBeNull()
		expect(document.querySelector('details.read-only-detail-accordion')?.textContent).toContain(shareToken)
		expect(document.querySelector('.market-ticket__panel')?.getAttribute('aria-label')).toBe('Trade ticket')
	})

	test('a closed market restores its chosen view from the hash and its ticket points to Settlement', async () => {
		window.location.hash = `#/market/${pool}?simulate=1&view=trade`
		const services = { ...offlineControllerServices, discoverAddressedMarket: async () => discoveryPage([{ ...market, endTime: 1n }]) }
		const originalMatchMedia = window.matchMedia
		Reflect.set(window, 'matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
		const rendered = await renderIntoDocument(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = async () => {
			await rendered.cleanup()
			Reflect.set(window, 'matchMedia', originalMatchMedia)
		}
		await waitForDom(() => document.querySelector('.trade-ticket-closed') !== null, 'closed trade ticket')
		expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Trade')
		expect(document.querySelector('.trade-ticket-closed')?.textContent).toContain('Trading has ended for this market.')
		await act(async () => buttonByLabel('Open settlement').click())
		expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Settlement')
		expect(window.location.hash).toBe(`#/market/${pool}?simulate=1&view=settlement`)
	})

	test('a side request for a market that never loads does not leak into the next visible ticket', async () => {
		const originalMatchMedia = window.matchMedia
		Reflect.set(window, 'matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
		try {
			const unavailablePool = `0x${'88'.repeat(20)}` as Address
			window.location.hash = `#/market/${unavailablePool}?ticket=buy-yes`
			const addressedMarket = (address: Address) => (address.toLowerCase() === unavailablePool ? { ...market, pool: unavailablePool, loadError: 'market RPC unavailable' } : { ...market })
			const services = {
				...offlineControllerServices,
				discoverAddressedMarket: async (_client: unknown, _configuration: unknown, address: Address) => discoveryPage([addressedMarket(address)]),
			}
			const rendered = await renderIntoDocument(<LiveTrading route={`market/${unavailablePool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
			cleanupRendered = rendered.cleanup
			await waitForDom(() => document.body.textContent?.includes('This security pool could not be loaded') === true, 'unavailable market')
			window.location.hash = `#/market/${pool}`
			await act(() => render(<LiveTrading route={`market/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />, rendered.container))
			await waitForDom(() => document.querySelector('.market-ticket__panel') !== null, 'visible ticket')
			expect(document.querySelector('.market-ticket__panel')?.hasAttribute('hidden')).toBe(false)
			expect(document.querySelector('.outcome-picker button[aria-pressed="true"]')?.textContent).toBe('Yes 50%')
			expect(document.querySelector('.trade-ticket-switchers .view-tabs:not(.outcome-picker) button[aria-pressed="true"]')?.textContent).toBe('Buy')
			expect(document.querySelector('[role="dialog"]')).toBeNull()
		} finally {
			Reflect.set(window, 'matchMedia', originalMatchMedia)
		}
	})
})
