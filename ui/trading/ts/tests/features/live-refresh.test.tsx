import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { marketDownloadStore } from '../../lib/favoriteMarkets.js'
import type { discoverTradingMarketPage } from '../../protocol/marketDiscovery.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { useLiveTradingController } from '../../features/liveTradingController.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
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

async function renderDiscoveryController(services: Parameters<typeof useLiveTradingController>[0]['services']) {
	let controller: ReturnType<typeof useLiveTradingController> | undefined
	function Harness({ route = 'market' }: { route?: string }) {
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

	test('explicit invalidation reruns navigation from the first page', async () => {
		const finish = createDeferred<void>()
		const starts: bigint[] = []
		const services = {
			...offlineControllerServices,
			discoverTradingMarketPage: async (_client: unknown, _configuration: unknown, _universe: unknown, start = 0n) => ({ ...discoveryPage([market]), start, total: 50n }),
			discoverLiveUniverseMarketPage: async (_client: unknown, _configuration: unknown, _universe: unknown, start = 0n) => {
				starts.push(start)
				await finish.promise
				return { ...discoveryPage([{ ...market, pair: undefined }]), start }
			},
		}
		const rendered = await renderDiscoveryController(services)
		cleanupRendered = rendered.cleanup
		try {
			await waitForDom(() => rendered.state().discovery.discoveryState === 'ready', 'initial discovery')
			await act(() => rendered.state().discovery.loadMarketPage(25n))
			await waitForDom(() => rendered.state().discovery.marketPage.start === 25n, 'second page')
			await rendered.navigate('create-market')
			await waitForDom(() => starts.length === 1, 'navigation discovery')
			await act(() => invalidateAppData())
			await waitForDom(() => starts.length === 2, 'replacement navigation')
			expect(starts).toEqual([0n, 0n])
			finish.resolve()
			await waitForDom(() => rendered.state().discovery.discoveryState === 'ready', 'navigation committed')
			expect(rendered.state().discovery.marketPage.start).toBe(0n)
		} finally {
			finish.resolve()
		}
	})

	test('explicit invalidation retains first-load rows and reruns foreground progress', async () => {
		const finish = createDeferred<void>()
		const progress = createDeferred<void>()
		let reads = 0
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Later row' }
		const discover: typeof discoverTradingMarketPage = async (_client, _configuration, _universe, _start, _size, _index, _isCurrent, onProgress) => {
			const read = ++reads
			if (read === 2) await progress.promise
			onProgress?.(discoveryPage(read === 1 ? [market] : [market, second]))
			await finish.promise
			return discoveryPage([market, second])
		}
		const rendered = await renderDiscoveryController({ ...offlineControllerServices, discoverTradingMarketPage: discover })
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

	test('explicit invalidation supersedes a pending block refresh without another block', async () => {
		appBlockWatcher.reportBlock(appBlockWatcher.getLatestBlockNumber() ?? 0n)
		const older = createDeferred<void>()
		let reads = 0
		const services = {
			...offlineControllerServices,
			discoverTradingMarketPage: async () => {
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
		await waitForDom(() => reads === 2, 'block refresh')
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
				const discover: typeof discoverTradingMarketPage = async (_client, _configuration, _universe, _start, _size, _index, _isCurrent, onProgress) => {
					reads += 1
					onProgress?.(discoveryPage([market]))
					await finish.promise
					if (outcome === 'error') throw new Error('Read failed')
					return discoveryPage([market])
				}
				const rendered = await renderDiscoveryController({ ...offlineControllerServices, discoverTradingMarketPage: discover })
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

	test('retains downloaded markets while a new discovery publishes placeholders', async () => {
		const saved = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Saved market' }
		marketDownloadStore.record(getLocalEntityScope('trading', 'market'), [{ id: saved.pool, data: saved }])
		const finish = createDeferred<void>()
		const discover: typeof discoverTradingMarketPage = async (_client, _configuration, _universe, _start, _size, _index, _isCurrent, onProgress) => {
			onProgress?.({ ...discoveryPage([market]), markets: [undefined, market] })
			await finish.promise
			return discoveryPage([market])
		}
		const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={{ ...offlineControllerServices, discoverTradingMarketPage: discover }} />)
		cleanupRendered = rendered.cleanup
		try {
			await waitForDom(() => document.body.textContent?.includes(market.title) === true, 'new partial row')
			expect(document.body.textContent).toContain('Saved market')
		} finally {
			finish.resolve()
		}
	})

	test('shows a later market in its fixed slot while the first market is pending', async () => {
		const finish = createDeferred<void>()
		const first = { ...market, title: 'Slow first market', endTime: market.endTime + 100n }
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Fast second market' }
		const discover: typeof discoverTradingMarketPage = async (_client, _configuration, _universe, _start, _size, _index, _isCurrent, onProgress) => {
			onProgress?.({ ...discoveryPage([first, second]), markets: [undefined, second] })
			await finish.promise
			return discoveryPage([first, second])
		}
		const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={{ ...offlineControllerServices, discoverTradingMarketPage: discover }} />)
		cleanupRendered = rendered.cleanup
		try {
			await waitForDom(() => document.body.textContent?.includes('Fast second market') === true, 'later completed row')
			const slots = () => [...document.querySelectorAll('[data-discovery-slot]')]
			expect(slots()).toHaveLength(2)
			expect(slots()[0]?.querySelector('.skeleton-list')).not.toBeNull()
			expect(slots()[1]?.textContent).toContain('Fast second market')
			const secondSlot = slots()[1]
			await settle(250)
			expect(marketDownloadStore.read(getLocalEntityScope('trading', 'market'))).toEqual([])
			finish.resolve()
			await waitForDom(() => document.body.textContent?.includes('Slow first market') === true, 'first row completed')
			expect(slots()[0]?.textContent).toContain('Slow first market')
			expect(slots()[1]).toBe(secondSlot)
			expect(slots()[1]?.textContent).toContain('Fast second market')
		} finally {
			finish.resolve()
		}
	})

	test('shows completed markets while the rest of discovery is still pending', async () => {
		let finish: () => void = () => undefined
		const pending = new Promise<void>(resolve => {
			finish = resolve
		})
		const first = { ...market, title: 'Fast market' }
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Slow market' }
		const page = (markets: LiveMarket[]) => ({ start: 0n, count: 2n, total: 2n, previousStart: undefined, nextStart: undefined, markets, universeIds: [1n], selectedUniverseId: 1n })
		const discover: typeof discoverTradingMarketPage = async (_client, _configuration, _universe, _start, _size, _index, _isCurrent, onProgress) => {
			onProgress?.(page([first]))
			await pending
			return page([first, second])
		}
		const services = { ...offlineControllerServices, discoverTradingMarketPage: discover }
		const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		try {
			await waitForDom(() => document.body.textContent?.includes('Fast market') === true, 'first completed market')
			expect(document.body.textContent).not.toContain('Slow market')
			expect(document.querySelector('.market-browser')?.getAttribute('aria-busy')).toBe('true')
			await settle(250)
			expect(marketDownloadStore.read(getLocalEntityScope('trading', 'market'))).toEqual([])
			finish()
			await waitForDom(() => document.body.textContent?.includes('Slow market') === true, 'remaining market')
			await waitForDom(() => marketDownloadStore.read(getLocalEntityScope('trading', 'market')).length === 2, 'completed discovery cached')
		} finally {
			finish()
		}
	})

	test('preserves every loaded market when a partial foreground refresh later times out', async () => {
		const timeout = createDeferred<void>()
		const first = { ...market, title: 'Fast market' }
		const second = { ...market, pool: '0x8888888888888888888888888888888888888888' as const, title: 'Slow market' }
		const page = (markets: LiveMarket[]) => ({ start: 0n, count: 2n, total: 2n, previousStart: undefined, nextStart: undefined, markets, universeIds: [1n], selectedUniverseId: 1n })
		let reads = 0
		const discover: typeof discoverTradingMarketPage = async (_client, _configuration, _universe, _start, _size, _index, _isCurrent, onProgress) => {
			if (++reads === 1) return page([first, second])
			onProgress?.(page([first]))
			await timeout.promise
			throw new Error('RPC read timed out. Retry loading data.')
		}
		const services = { ...offlineControllerServices, discoverTradingMarketPage: discover }
		let controller: ReturnType<typeof useLiveTradingController> | undefined
		function Harness() {
			controller = useLiveTradingController({
				route: 'market',
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
			expect(reads).toBe(2)
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
		await waitForDom(() => document.querySelector('[role="tabpanel"] .notice.error') !== null, 'price-moved notice')
		expect(exitRequests).toEqual([expectedCompleteSets])
		expect(document.querySelector('[role="tabpanel"] .notice.error')?.textContent).toContain('The price moved since your estimate')
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

	test('lets a background discovery slower than the block interval finish instead of starting another on each block', async () => {
		let discoveries = 0
		let releaseDiscovery: () => void = () => undefined
		let gate: Promise<void> | undefined
		const services = {
			...offlineControllerServices,
			discoverAllLiveMarketsInUniverse: async () => {
				discoveries += 1
				if (gate !== undefined) await gate
				return discoveryPage([{ ...market, title: `Portfolio market ${discoveries.toString()}` }])
			},
		}
		gate = new Promise<void>(resolve => {
			releaseDiscovery = resolve
		})
		stopBlocks?.()
		stopBlocks = produceBlocks(30)
		const rendered = await renderIntoDocument(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		// While discovery is still running the route shows one live loading state and no terminal empty state.
		await waitForDom(() => document.body.textContent?.includes('Discovering security pools…') === true, 'portfolio discovery status')
		expect(document.body.querySelector('.empty-state[role="status"]')?.textContent).toContain('Discovering security pools…')
		expect(document.body.textContent).not.toContain('No Yes, No, Invalid, or LP balance was found')
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
		const page = (markets: LiveMarket[]) => discoveryPage(markets, [1n, 2n])
		const services = {
			...offlineControllerServices,
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
			stopBlocks?.()
			stopBlocks = produceBlocks(20)
			const rendered = await renderIntoDocument(<LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} onUniversesChange={ids => universes.push(ids)} controllerServices={services} />)
			cleanupRendered = rendered.cleanup
			await waitForDom(() => rendered.container.querySelectorAll('.market-record').length === 1, `${route} candidate list`)
			expect(universes.length).toBeGreaterThan(0)
			expect(pagedRoutes.at(-1)).toBe(listRoute)
			// The market list's search opens a pasted pool address; the security-pool list keeps its address form.
			expect(rendered.container.querySelector(listRoute === 'markets' ? 'form.market-list-search' : 'form.open-pool-form')).not.toBeNull()
			expect(rendered.container.querySelector(`.market-record a[href="#/${route === 'create-market' ? 'create-market' : 'market'}/${pool}"]`)).not.toBeNull()
			// The primary row action follows the workflow the landing names: the trade landing leads with one-click outcome buttons.
			if (route === 'market') {
				expect(rendered.container.querySelector('.market-record .outcome-button--yes')?.getAttribute('href')).toBe(`#/market/${pool}?side=yes`)
				expect(rendered.container.querySelector('.market-record .outcome-button--no')?.getAttribute('href')).toBe(`#/market/${pool}?side=no`)
				expect(rendered.container.querySelector('.market-record .button-link.primary')).toBeNull()
			} else expect(rendered.container.querySelector('.market-record .button-link.primary')?.getAttribute('href')).toBe(`#/${route}/${pool}`)
			expect(universeDiscoveries).toBe(0)
			await rendered.cleanup()
			cleanupRendered = undefined
			pagedRoutes.length = 0
		}
	})

	test('the market list keeps discovered pages in the download cache, so Discover adds to the list and search spans every page', async () => {
		const firstPageMarket = { ...market, pool: `0x${'a1'.repeat(20)}` as Address, title: 'First page market' }
		const secondPageMarket = { ...market, pool: `0x${'a2'.repeat(20)}` as Address, title: 'Second page market' }
		const requestedStarts: bigint[] = []
		const services = {
			...offlineControllerServices,
			discoverTradingMarketPage: async (_client: unknown, _configuration: unknown, _universeId: unknown, start = 0n) => {
				requestedStarts.push(start)
				const firstPage = start === 0n
				return { start, count: 1n, total: 2n, previousStart: firstPage ? undefined : 0n, nextStart: firstPage ? 1n : undefined, markets: [{ ...(firstPage ? firstPageMarket : secondPageMarket) }], universeIds: [1n], selectedUniverseId: 1n }
			},
		}
		const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.querySelectorAll('.market-record').length === 1 && document.querySelector('.discovery-control')?.textContent?.includes('1 of 2 markets scanned') === true, 'first discovered page')
		await act(() => buttonByLabel('Discover more').click())
		await waitForDom(() => document.querySelectorAll('.market-record').length === 2, 'second page joins the downloaded list')
		expect(requestedStarts).toEqual([0n, 1n])
		expect(buttonByLabel('Scan again').disabled).toBe(false)
		expect(document.querySelector('.market-list-count')?.textContent).toBe('2 markets')
		const search = document.querySelector<HTMLInputElement>('input[type="search"]')
		if (search === null) throw new Error('Market search did not render')
		await act(() => {
			search.value = 'first page'
			search.dispatchEvent(new Event('input', { bubbles: true }))
		})
		// The first page is no longer the loaded page, yet its market is still searchable from the cache.
		expect([...document.querySelectorAll('.market-record h3')].map(heading => heading.textContent)).toEqual(['First page market'])
		expect(document.querySelector('.market-list-count')?.textContent).toBe('1 of 2 markets')
	})

	test('a market-card outcome link opens the ticket on that side and drops the one-shot side from the hash', async () => {
		window.location.hash = `#/market/${pool}?simulate=1&side=no`
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
		expect(document.querySelector('.outcome-picker button[aria-pressed="true"]')?.textContent).toBe('No')
		expect(window.location.hash).toBe(`#/market/${pool}?simulate=1`)
		// The reading column carries the question description as text, with contract addresses behind a disclosure.
		expect(document.querySelector('.market-description__text')?.textContent).toBe('Resolves YES when the bridge opens.\n<b>not markup</b>')
		expect(document.querySelector('.market-description b')).toBeNull()
		expect(document.querySelector('details.read-only-detail-accordion')?.textContent).toContain(shareToken)
		expect(document.querySelector('.market-ticket__panel')?.getAttribute('aria-label')).toBe('Trade ticket')
	})

	test('a side request for a market that never loads does not open the sheet on the next market', async () => {
		const originalMatchMedia = window.matchMedia
		Reflect.set(window, 'matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
		try {
			const unavailablePool = `0x${'88'.repeat(20)}` as Address
			window.location.hash = `#/market/${unavailablePool}?side=yes`
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
			await waitForDom(() => document.querySelector('.market-ticket-bar') !== null, 'collapsed ticket bar')
			expect(document.querySelector('.market-ticket__panel')?.hasAttribute('hidden')).toBe(true)
			expect(document.querySelector('[role="dialog"]')).toBeNull()
		} finally {
			Reflect.set(window, 'matchMedia', originalMatchMedia)
		}
	})
})
