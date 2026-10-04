import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { LiveTrading as ProductionLiveTrading } from '../../features/LiveTrading.js'
import { liveLiquidityServices } from '../../features/LiveLiquidityControls.js'
import { liveSettlementServices } from '../../features/LiveSettlementControls.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import * as actualLive from '../../protocol/live.js'
import type { LiveMarket } from '../../protocol/live.js'
import type { TradingRoute } from '../../lib/routing.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { transactionActivity } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import { isMarketTransactionPending } from '../../features/live/marketTransactionActivity.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { quoteEnterPosition } from '@zoltar/trading-shared/trading/positions'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { buttonByLabel, waitForDom } from '../support/dom.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'
import { offlineControllerServices } from '../support/liveTradingServices.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const secondPool = `0x${'23'.repeat(20)}` as Address
const secondShareToken = `0x${'45'.repeat(20)}` as Address
const childPool = `0x${'24'.repeat(20)}` as Address
const childShareToken = `0x${'46'.repeat(20)}` as Address
const transactionHash = `0x${'88'.repeat(32)}` as Hash
const replacementTransactionHash = `0x${'89'.repeat(32)}` as Hash
const secondMarketTransactionHash = `0x${'8a'.repeat(32)}` as Hash
const forbiddenLiveCopy = ['Binary shares for', 'INVALID is insurance', 'Canonical SecurityPools', 'In a live transaction', 'illustrative', 'Market signal', 'Exact identity', 'Preview ready']

async function flush() {
	await act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

async function settleAsyncWorkflow() {
	await act(async () => {
		await Bun.sleep(10)
	})
	await flush()
}

function hasButton(label: string) {
	return Array.from(document.querySelectorAll('button')).some(candidate => candidate.textContent?.trim() === label)
}

describe('live workflow safety boundary', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
			transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
		},
		url: `http://localhost/?demo=0#/market/${pool}`,
	})

	test('keeps the hash visible and every competing write locked after receipt polling and wallet context fail', async () => {
		let connectedAccount = account
		let positionReceipt = createDeferred<{ status: 'success' | 'reverted' }>()
		const secondMarketReceipt = createDeferred<{ status: 'success' | 'reverted' }>()
		let waitForPositionReceipt = false
		let repricePositionReceipt = false
		let positionBroadcast = createDeferred<undefined>()
		let positionWalletWrite = createDeferred<undefined>()
		let deferPositionBroadcast = false
		let deferredWalletChainRead: ReturnType<typeof createDeferred<number>> | undefined
		let walletChainReadStarted: ReturnType<typeof createDeferred<undefined>> | undefined
		const rejectBalanceRefresh = false
		let deferSecondPortfolioBalance = false
		const secondPortfolioBalance = createDeferred<undefined>()
		let deferChildDiscovery = false
		const childDiscovery = createDeferred<undefined>()
		let childBalanceStarted = createDeferred<undefined>()
		const discoveredUniverseIds: Array<bigint | undefined> = []
		const submittedEntries: Array<{ market: LiveMarket; minimumLongShares: bigint; result: { totalLongShares: bigint } }> = []
		const balancedPools: Address[] = []
		const walletSummaries: WalletSummaryState[] = []
		const recordWalletSummary = (summary: WalletSummaryState) => walletSummaries.push(summary)
		const walletListeners = new Map<string, (...args: unknown[]) => void>()
		const injectedProvider = {
			request: async () => undefined,
			on: (eventName: string, listener: (...args: unknown[]) => void) => walletListeners.set(eventName, listener),
			removeListener: (eventName: string) => walletListeners.delete(eventName),
		}
		Reflect.set(window, 'ethereum', injectedProvider)
		const walletClient = {
			waitForTransactionReceipt: async (parameters: Parameters<WalletClient['waitForTransactionReceipt']>[0]) => {
				if (parameters.hash === secondMarketTransactionHash) return await secondMarketReceipt.promise
				if (waitForPositionReceipt) {
					const receipt = await positionReceipt.promise
					if (repricePositionReceipt) {
						parameters.onReplaced?.({
							reason: 'repriced',
							replacedTransaction: { hash: transactionHash } as never,
							transaction: { hash: replacementTransactionHash } as never,
							transactionReceipt: receipt as never,
						})
					}
					return receipt
				}
				return { status: 'success' as const }
			},
		}
		const now = BigInt(Math.floor(Date.now() / 1_000))
		let discoveredEndTime = 2n ** 255n
		let discoveredLoadError: string | undefined
		let rejectDiscovery = false
		const market = etherScaleMarketFixture({
			pool,
			shareToken,
			title: 'Rendered workflow market',
			description: 'Receipt uncertainty fixture',
			endTime: discoveredEndTime,
			initialReportPriorityFeeAttoEthPerGas: 2_000_000_000n,
			shareTokenSupplyAttoShares: 100n * 10n ** 18n,
			settlementCollateralAttoEth: 100n * 10n ** 18n,
		})
		const secondMarket: LiveMarket = { ...market, pool: secondPool, shareToken: secondShareToken, questionId: 3n, title: 'Second rendered workflow market' }
		const childMarket: LiveMarket = { ...market, pool: childPool, shareToken: childShareToken, universeId: 2n, questionId: 4n, title: 'Child-universe workflow market' }
		const configuration = deploymentConfigurationFixture()
		const discoverMarkets = async () => {
			if (rejectDiscovery) throw new Error('registry RPC unavailable')
			return {
				start: 0n,
				count: 2n,
				total: 2n,
				previousStart: undefined,
				nextStart: undefined,
				markets: [
					{ ...market, endTime: discoveredEndTime, loadError: discoveredLoadError },
					{ ...secondMarket, endTime: discoveredEndTime },
				],
			}
		}
		const discoverSelectedUniverse = async (_client: unknown, _configuration: unknown, requestedUniverseId: bigint | undefined) => {
			discoveredUniverseIds.push(requestedUniverseId)
			if (requestedUniverseId === 2n) {
				if (deferChildDiscovery) await childDiscovery.promise
				return { start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [childMarket], universeIds: [1n, 2n], selectedUniverseId: 2n }
			}
			if (requestedUniverseId === 3n) return { start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [1n, 2n, 3n], selectedUniverseId: 3n }
			return { ...(await discoverMarkets()), universeIds: [1n, 2n], selectedUniverseId: 1n }
		}
		const controllerServices = {
			...offlineControllerServices,
			discoverLiveUniverseMarketPage: discoverSelectedUniverse,
			discoverTradingMarketPage: discoverSelectedUniverse,
			discoverUniverses: async (_client: unknown, _configuration: unknown, requestedUniverseId: bigint | undefined) => ({ ...(await discoverSelectedUniverse(undefined, undefined, requestedUniverseId)), markets: [] }),
			discoverAddressedMarket: async (_client: unknown, _configuration: unknown, address: Address) => {
				const discovered = await discoverSelectedUniverse(undefined, undefined, 1n)
				return { ...discovered, markets: discovered.markets.filter(candidate => candidate.pool.toLowerCase() === address.toLowerCase()) }
			},
			discoverSavedMarkets: discoverSelectedUniverse,
			walletChainId: async () => {
				if (deferredWalletChainRead !== undefined) {
					walletChainReadStarted?.resolve(undefined)
					return await deferredWalletChainRead.promise
				}
				return configuration.chainId
			},
			connectWallet: async () => {
				return connectedAccount
			},
			createTradingWalletClient: () => walletClient,
			loadWalletHeaderBalances: async () => {
				return { ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, repToken: `0x${'47'.repeat(20)}` as Address }
			},
			loadLiveBalances: async (_client: unknown, selectedMarket: LiveMarket) => {
				balancedPools.push(selectedMarket.pool)
				if (selectedMarket.pool === childPool) childBalanceStarted.resolve(undefined)
				if (rejectBalanceRefresh) throw new Error('balance RPC unavailable')
				if (deferSecondPortfolioBalance && selectedMarket.pool === secondPool) await secondPortfolioBalance.promise
				const multiplier = selectedMarket.pool === secondPool ? 4n : 1n
				return { scope: actualLive.shareBalanceScope(selectedMarket), invalid: multiplier * 10n ** 18n, yes: multiplier * 10n ** 18n, no: multiplier * 10n ** 18n, lp: multiplier * 10n ** 18n }
			},
			// Prices like the router so the pre-signing check agrees with the ticket's local estimate.
			simulateEntry: async (_client: unknown, _configuration: unknown, quotedMarket: LiveMarket, _account: unknown, side: 'YES' | 'NO', amount: bigint) => {
				const result = quoteEnterPosition(side, (amount * quotedMarket.shareTokenSupplyAttoShares) / quotedMarket.settlementCollateralAttoEth, quotedMarket)
				return { blockNumber: 1n, amount, side, market: quotedMarket, deadline: now + 1_200n, slippageBps: 50n, minimumLongShares: 1n, result }
			},
			submitFreshEntry: async (_client: unknown, _configuration: unknown, _account: unknown, quote: { market: LiveMarket; minimumLongShares: bigint; result: { totalLongShares: bigint } }, guardedWrite: <T>(write: () => Promise<T>) => Promise<T>) => {
				submittedEntries.push(quote)
				if (deferPositionBroadcast) await positionBroadcast.promise
				return await guardedWrite(async () => {
					if (deferPositionBroadcast) await positionWalletWrite.promise
					return quote.market.pool === secondPool ? secondMarketTransactionHash : transactionHash
				})
			},
		}
		const liquidityServices = liveLiquidityServices
		const LiveTrading = (props: Parameters<typeof ProductionLiveTrading>[0]) => <ProductionLiveTrading {...props} controllerServices={controllerServices} liquidityServices={liquidityServices} settlementServices={liveSettlementServices} />
		const workflowLocks: boolean[] = []
		type ViewOptions = { selectedUniverseId?: string; recordSummary?: boolean; walletConnectRequestNonce?: number }
		const liveTradingView = (route: TradingRoute, { selectedUniverseId = '1', recordSummary = true, walletConnectRequestNonce }: ViewOptions = {}) => (
			<LiveTrading
				route={route}
				configuration={configuration}
				configurationError={undefined}
				selectedUniverseId={selectedUniverseId}
				onWorkflowLockChange={locked => workflowLocks.push(locked)}
				{...(recordSummary ? { onWalletSummaryChange: recordWalletSummary } : {})}
				{...(walletConnectRequestNonce === undefined ? {} : { walletConnectRequestNonce })}
			/>
		)
		const startWalletChainRead = async (trigger: () => void) => {
			const read = createDeferred<number>()
			const started = createDeferred<undefined>()
			deferredWalletChainRead = read
			walletChainReadStarted = started
			await act(async () => {
				trigger()
				await started.promise
			})
			return read
		}
		const releaseWalletChainRead = () => {
			deferredWalletChainRead = undefined
			walletChainReadStarted = undefined
		}
		const expectOnlyUniverseTwoRefreshedSince = (discoveriesBefore: number) => {
			expect(discoveredUniverseIds.slice(discoveriesBefore)).not.toContain(1n)
			expect(discoveredUniverseIds.at(-1)).toBe(2n)
			expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, universeId: '2', status: 'ready', repAttoRep: 6n * 10n ** 18n })
		}
		const show = async (route: TradingRoute, options?: ViewOptions) => await act(() => render(liveTradingView(route, options), rendered.container))
		const marketRoute = `market/${pool}` as const
		const liquidityRoute = `liquidity/${pool}` as const
		// Manual refresh controls are gone; leaving and re-entering the addressed route runs an explicit refresh.
		const rerouteForRefresh = async (route: 'market' | 'portfolio' | typeof marketRoute | typeof liquidityRoute, selectedUniverse = '1') => {
			await show('create-market', { selectedUniverseId: selectedUniverse })
			await flush()
			await show(route, { selectedUniverseId: selectedUniverse })
			await flush()
		}
		let rendered = await renderIntoDocument(liveTradingView(marketRoute))
		cleanupRendered = rendered.cleanup
		await waitForDom(() => document.body.textContent?.includes('Invalid timestamp') === true, 'initial market details')
		for (const phrase of forbiddenLiveCopy) expect(document.body.textContent?.toLowerCase()).not.toContain(phrase.toLowerCase())
		expect(document.body.textContent).not.toContain('2\u00a0nanoETH per gas')
		expect(document.body.textContent).toContain('Invalid timestamp')
		expect(document.body.textContent).not.toContain('Invalid timestamp UTC')
		expect(document.body.textContent).not.toContain('Refresh')
		expect(document.body.textContent).not.toContain('Ready to simulate')
		expect(document.body.textContent).not.toContain('Pool and reserve details')
		expect(document.body.textContent).not.toContain('Current spot price')
		discoveredLoadError = 'market RPC unavailable'
		await rerouteForRefresh(marketRoute)
		await waitForDom(() => document.body.textContent?.includes('Market data unavailable') === true, 'market refresh failure')
		expect(document.body.textContent).toContain('Market data unavailable')
		expect(document.body.textContent).toContain(pool)
		expect(document.body.textContent).not.toContain(shareToken)
		expect(document.body.textContent).not.toContain('Question ID2')
		expect(document.body.textContent).not.toContain('Invalid 256 · Yes 257 · No 258')
		discoveredLoadError = undefined
		await rerouteForRefresh(marketRoute)
		await waitForDom(() => document.body.textContent?.includes('Invalid timestamp') === true, 'recovered market details')
		// Keep the wallet-uncertainty exercise outside the bounded submission cutoff.
		discoveredEndTime = now + 600n

		const unmountedConnectionChainRead = await startWalletChainRead(() => buttonByLabel('Connect wallet').click())
		const summariesBeforeUnmountedConnectionResolution = walletSummaries.length
		await rendered.cleanup()
		cleanupRendered = undefined
		unmountedConnectionChainRead.resolve(configuration.chainId)
		await settleAsyncWorkflow()
		expect(walletSummaries).toHaveLength(summariesBeforeUnmountedConnectionResolution)
		expect(walletListeners.size).toBe(0)
		releaseWalletChainRead()
		const poolRoute = `security-pool/${pool}` as const
		deferredWalletChainRead = createDeferred<number>()
		walletChainReadStarted = createDeferred<undefined>()
		rendered = await renderIntoDocument(liveTradingView(poolRoute, { recordSummary: false, walletConnectRequestNonce: 0 }))
		cleanupRendered = rendered.cleanup
		await flush()
		await show(poolRoute, { recordSummary: false, walletConnectRequestNonce: 1 })
		await walletChainReadStarted.promise
		await show('market', { recordSummary: false, walletConnectRequestNonce: 1 })
		// Only the market opened earlier in this test is saved; unrelated pools are not scanned.
		await waitForDom(() => document.querySelectorAll('.market-record').length === 1, 'browse rows')
		expect([...document.querySelectorAll('.market-list-heading')].map(heading => heading.textContent)).toEqual([])
		expect(document.querySelector(`.market-record a[href="#/market/${pool}"]`)).not.toBeNull()
		expect(document.querySelector(`.market-record a[href="#/liquidity/${pool}"]`)).not.toBeNull()
		deferredWalletChainRead.reject(new Error('Wallet request rejected after navigation'))
		await settleAsyncWorkflow()
		expect(document.body.textContent).not.toContain('Wallet request rejected after navigation')
		await show('portfolio', { recordSummary: false, walletConnectRequestNonce: 1 })
		await settleAsyncWorkflow()
		expect(document.body.textContent).not.toContain('Wallet request rejected after navigation')
		releaseWalletChainRead()
		await show('market')
		await settleAsyncWorkflow()
		await flush()
		// The lookup route is list-first: the search that also opens a pool address sits above the same rows the browse alias shows.
		expect(document.querySelector('form.market-list-search')).not.toBeNull()
		await waitForDom(() => document.querySelectorAll('.market-record').length === 1, 'lookup route rows')
		const discoveriesBeforeMidConnectUniverseChange = discoveredUniverseIds.length
		const midConnectChainRead = await startWalletChainRead(() => buttonByLabel('Connect wallet').click())
		await show('portfolio', { selectedUniverseId: '2' })
		midConnectChainRead.resolve(configuration.chainId)
		await settleAsyncWorkflow()
		expectOnlyUniverseTwoRefreshedSince(discoveriesBeforeMidConnectUniverseChange)
		releaseWalletChainRead()
		deferSecondPortfolioBalance = true
		await show('portfolio')
		await waitForDom(() => document.querySelectorAll('[data-portfolio-pool]').length === 2, 'both portfolio pools')
		expect(document.querySelectorAll('[data-portfolio-pool]')).toHaveLength(2)
		expect(document.body.textContent).toContain(secondPool)
		const firstPortfolioCard = document.querySelector(`[data-portfolio-pool="${pool}"]`)
		const secondPortfolioCard = document.querySelector(`[data-portfolio-pool="${secondPool}"]`)
		await waitForDom(() => firstPortfolioCard?.textContent?.includes('1 Yes') === true, 'first queued portfolio balance')
		expect(firstPortfolioCard?.textContent).toContain('1 Yes')
		expect(secondPortfolioCard?.textContent).not.toContain('4 Yes')
		secondPortfolioBalance.resolve(undefined)
		await waitForDom(() => secondPortfolioCard?.textContent?.includes('4 Yes') === true, 'second queued portfolio balance')
		expect(secondPortfolioCard?.textContent).toContain('4 Yes')
		childBalanceStarted = createDeferred<undefined>()
		deferChildDiscovery = true
		render(liveTradingView('portfolio', { selectedUniverseId: '2' }), rendered.container)
		expect(document.body.textContent).not.toContain(pool)
		expect(document.body.textContent).not.toContain(secondPool)
		await flush()
		childDiscovery.resolve(undefined)
		await childBalanceStarted.promise
		await flush()
		expect(discoveredUniverseIds).toContain(2n)
		expect(balancedPools).toContain(childPool)
		expect(document.body.textContent).toContain(childPool)
		connectedAccount = `0x${'9b'.repeat(20)}` as Address
		const universeTwoDiscoveryCount = discoveredUniverseIds.length
		await act(async () => walletListeners.get('accountsChanged')?.([connectedAccount]))
		await settleAsyncWorkflow()
		expectOnlyUniverseTwoRefreshedSince(universeTwoDiscoveryCount)
		const universeTwoChainDiscoveryCount = discoveredUniverseIds.length
		await act(async () => walletListeners.get('chainChanged')?.('0x7a69'))
		await settleAsyncWorkflow()
		expectOnlyUniverseTwoRefreshedSince(universeTwoChainDiscoveryCount)
		deferChildDiscovery = false
		await show('portfolio')
		await flush()
		connectedAccount = `0x${'9c'.repeat(20)}` as Address
		const discoveriesBeforeMidEventUniverseChange = discoveredUniverseIds.length
		const midEventChainRead = await startWalletChainRead(() => walletListeners.get('accountsChanged')?.([connectedAccount]))
		await show('portfolio', { selectedUniverseId: '2' })
		midEventChainRead.resolve(configuration.chainId)
		await settleAsyncWorkflow()
		expectOnlyUniverseTwoRefreshedSince(discoveriesBeforeMidEventUniverseChange)
		releaseWalletChainRead()
		await show('portfolio')
		await flush()
		rejectDiscovery = true
		await rerouteForRefresh('portfolio')
		await waitForDom(() => Array.from(document.querySelectorAll('[role="alert"]')).some(candidate => candidate.textContent?.includes('Security pool discovery failed') === true), 'discovery failure notice')
		expect(Array.from(document.querySelectorAll('[role="alert"]')).filter(candidate => candidate.textContent?.includes('Security pool discovery failed') === true)).toHaveLength(1)
		expect(hasButton('Refresh')).toBeFalse()
		expect(document.body.textContent).not.toContain('Retry balances')
		rejectDiscovery = false
		await rerouteForRefresh('portfolio')
		await show(marketRoute)
		await flush()
		connectedAccount = `0x${'9a'.repeat(20)}` as Address
		await act(async () => walletListeners.get('accountsChanged')?.([connectedAccount]))
		await settleAsyncWorkflow()
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, status: 'ready' })
		expect(document.body.textContent).not.toContain('Reconnect before simulating or submitting')
		await show(`security-pool/${pool}`)
		await settleAsyncWorkflow()
		const summariesBeforeChainRefresh = walletSummaries.length
		await act(async () => walletListeners.get('chainChanged')?.('0x7a69'))
		await settleAsyncWorkflow()
		expect(walletSummaries.length).toBeGreaterThan(summariesBeforeChainRefresh)
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, status: 'ready' })
		expect(document.body.textContent).not.toContain('Refreshing wallet context')
		await show(marketRoute)
		await settleAsyncWorkflow()
		await waitForDom(() => document.body.textContent?.includes('1 Yes') === true, 'wallet balances for the addressed market')

		const amountInput = document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')
		if (amountInput === null) throw new Error('Amount input is unavailable')
		const typeAmount = async (value: string) => {
			await act(() => {
				amountInput.value = value
				amountInput.dispatchEvent(new Event('input', { bubbles: true }))
			})
			await act(async () => {
				await Bun.sleep(300)
			})
		}
		await typeAmount('0.01')
		await waitForDom(() => document.querySelector('.transaction-review-primary') !== null, 'entry estimate')
		expect(buttonByLabel('Buy Yes').classList.contains('tx-action-button')).toBeTrue()
		expect(hasButton('Preview trade')).toBeFalse()
		deferPositionBroadcast = true
		waitForPositionReceipt = true
		repricePositionReceipt = true
		positionReceipt = createDeferred<{ status: 'success' | 'reverted' }>()
		positionBroadcast = createDeferred<undefined>()
		positionWalletWrite = createDeferred<undefined>()
		await act(async () => buttonByLabel('Buy Yes').click())
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Buy Yes: checking the latest price before your wallet opens')
		expect(document.querySelector('.transaction-hash')).toBeNull()
		positionBroadcast.resolve(undefined)
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Buy Yes: confirm in your wallet.')
		expect(document.querySelector('.transaction-hash')).toBeNull()
		positionWalletWrite.resolve(undefined)
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Buy Yes sent. Waiting for confirmation')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(transactionHash)
		expect(document.querySelector('.transaction-hash-link')).not.toBeNull()
		// The wallet is held to the minimum the ticket displayed (0.5% below the estimate), not to the simulation's own bound.
		expect(submittedEntries).toHaveLength(1)
		expect(submittedEntries[0]?.minimumLongShares).toBe(((submittedEntries[0]?.result.totalLongShares ?? 0n) * 9_950n) / 10_000n)
		// Navigation stays free while the trade is pending: the activity list keeps it and only this market's ticket is locked.
		expect(transactionActivity.value.entries[0]).toMatchObject({ hash: transactionHash, scope: [`market:${pool.toLowerCase()}`], status: 'pending' })
		expect(isMarketTransactionPending(pool)).toBeTrue()
		expect(isMarketTransactionPending(secondPool)).toBeFalse()
		await show('portfolio')
		await settleAsyncWorkflow()
		expect(document.querySelectorAll('[data-portfolio-pool]').length).toBeGreaterThan(0)
		expect(transactionActivity.value.entries[0]?.status).toBe('pending')
		// Other routes keep refreshing while the trade runs; only the trade's own market waits for it.
		const discoveriesBeforePortfolioRefresh = discoveredUniverseIds.length
		await act(async () => invalidateAppData())
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.length).toBeGreaterThan(discoveriesBeforePortfolioRefresh)
		// Another market's ticket shows none of this trade's status or hash and stays usable: one trade runs per market.
		const renderSecondMarket = async () => await show(`market/${secondPool}`)
		await renderSecondMarket()
		await waitForDom(() => document.body.textContent?.includes('4 Yes') === true, 'second market balances during a pending trade')
		expect(document.querySelector('.transaction-hash')).toBeNull()
		expect(document.body.textContent).not.toContain('Buy Yes sent. Waiting for confirmation')
		expect(document.body.textContent).not.toContain('Transaction in progress.')
		// The first market's amount stays with its own ticket.
		const secondAmountInput = document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')
		expect(secondAmountInput?.value).toBe('')
		expect(secondAmountInput?.disabled).toBeFalse()
		await act(() => {
			if (secondAmountInput === null) throw new Error('Second market amount input is unavailable')
			secondAmountInput.value = '0.03'
			secondAmountInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		await waitForDom(() => document.querySelector('.transaction-review-primary') !== null, 'second market entry estimate')
		expect(buttonByLabel('Buy Yes').disabled).toBeFalse()
		await act(async () => buttonByLabel('Buy Yes').click())
		await waitForDom(() => document.body.textContent?.includes('Buy Yes sent. Waiting for confirmation') === true, 'second market pending trade')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(secondMarketTransactionHash)
		expect(document.querySelector('.transaction-hash')?.textContent).not.toContain(transactionHash)
		expect(submittedEntries.map(entry => entry.market.pool)).toEqual([pool, secondPool])
		// Both trades are pending at once, each in its own market's activity scope.
		expect(transactionActivity.value.entries.map(entry => ({ hash: entry.hash, scope: entry.scope, status: entry.status }))).toEqual(
			expect.arrayContaining([
				{ hash: transactionHash, scope: [`market:${pool.toLowerCase()}`], status: 'pending' },
				{ hash: secondMarketTransactionHash, scope: [`market:${secondPool.toLowerCase()}`], status: 'pending' },
			]),
		)
		expect(transactionActivity.value.entries).toHaveLength(2)
		expect(isMarketTransactionPending(pool)).toBeTrue()
		expect(isMarketTransactionPending(secondPool)).toBeTrue()
		// With both trades pending, other routes still refresh and each pending market's route waits for its own trade.
		const discoveriesOnSecondPendingMarket = discoveredUniverseIds.length
		await act(async () => invalidateAppData())
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.length).toBe(discoveriesOnSecondPendingMarket)
		await show('portfolio')
		await settleAsyncWorkflow()
		const discoveriesBeforeSecondPortfolioRefresh = discoveredUniverseIds.length
		await act(async () => invalidateAppData())
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.length).toBeGreaterThan(discoveriesBeforeSecondPortfolioRefresh)
		await show(marketRoute)
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Buy Yes sent. Waiting for confirmation')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(transactionHash)
		expect(document.querySelector('.transaction-hash')?.textContent).not.toContain(secondMarketTransactionHash)
		expect(document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')?.value).toBe('0.01')
		const discoveriesOnPendingMarket = discoveredUniverseIds.length
		await act(async () => invalidateAppData())
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.length).toBe(discoveriesOnPendingMarket)
		positionReceipt.resolve({ status: 'success' })
		await settleAsyncWorkflow()
		// The replacement settles the same activity row and releases only this market's ticket.
		expect(transactionActivity.value.entries).toHaveLength(2)
		expect(transactionActivity.value.entries.find(entry => entry.scope.includes(`market:${pool.toLowerCase()}`))).toMatchObject({ hash: replacementTransactionHash, status: 'confirmed' })
		expect(transactionActivity.value.entries.find(entry => entry.hash === secondMarketTransactionHash)?.status).toBe('pending')
		expect(isMarketTransactionPending(pool)).toBeFalse()
		expect(isMarketTransactionPending(secondPool)).toBeTrue()
		expect(document.body.textContent).toContain('Buy Yes confirmed.')
		// Confirmation moves focus to the outcome block so the result is announced and reachable.
		expect(document.activeElement?.classList.contains('transaction-outcome')).toBe(true)
		// The post-receipt refresh revalidates balances without hiding the ones already on screen.
		expect(document.body.textContent).not.toContain('Loading balances')
		expect(document.body.textContent).toContain('1 Yes')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(replacementTransactionHash)
		// Navigating away and back remounted the ticket, so read the amount field again.
		expect(document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')?.value).toBe('')
		// The second market's trade is still pending on its own ticket, then fails without touching the first market.
		await renderSecondMarket()
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Buy Yes sent. Waiting for confirmation')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(secondMarketTransactionHash)
		expect(document.body.textContent).not.toContain('Buy Yes confirmed.')
		secondMarketReceipt.resolve({ status: 'reverted' })
		await waitForDom(() => document.body.textContent?.includes('The transaction reverted onchain') === true, 'second market reverted trade')
		expect(transactionActivity.value.entries.find(entry => entry.hash === secondMarketTransactionHash)?.status).toBe('failed')
		expect(transactionActivity.value.entries.find(entry => entry.hash === replacementTransactionHash)?.status).toBe('confirmed')
		expect(isMarketTransactionPending(secondPool)).toBeFalse()
		expect(document.querySelector<HTMLInputElement>('[role="tabpanel"] input[name="amount"]')?.disabled).toBeFalse()
		await show(marketRoute)
		await settleAsyncWorkflow()
		expect(document.body.textContent).not.toContain('The transaction reverted onchain')
		deferPositionBroadcast = false
		waitForPositionReceipt = false
		repricePositionReceipt = false
		// Protection lives in the application settings, not in the form; a new amount starts a new trade.
		expect(document.querySelector('.execution-protection')).toBeNull()
		await typeAmount('0.02')
		expect(document.querySelector('.transaction-hash')).toBeNull()

		await act(async () => buttonByLabel('Sell').click())
		expect(document.querySelector('[role="tabpanel"] .tx-action-button')).not.toBeNull()
		expect(document.querySelector('[role="tabpanel"] .pool-mechanics')).toBeNull()
		expect(document.body.textContent).not.toContain('Factory discovery')
		expect(document.querySelector('.market-list')).toBeNull()
		expect(document.querySelector('.market-stack')).not.toBeNull()
		await renderSecondMarket()
		await settleAsyncWorkflow()
		expect(document.querySelector('.transaction-hash')).toBeNull()
		expect(document.body.textContent).toContain('Second rendered workflow market')
		await show(marketRoute)
		await settleAsyncWorkflow()
		await show(liquidityRoute, { recordSummary: false })
		await flush()
		await waitForDom(() => hasButton('Remove'), 'liquidity controls')
		await act(async () => buttonByLabel('Remove').click())
		expect(hasButton('Approve exact LP amount')).toBeFalse()
		expect(hasButton('Remove liquidity')).toBeTrue()
		expect(hasButton('Simulate liquidity transaction')).toBeFalse()
		// A universe without pools shows the route-level empty state once; the portfolio list does not add a second one.
		await show('portfolio', { selectedUniverseId: '3' })
		await settleAsyncWorkflow()
		await waitForDom(() => document.body.textContent?.includes('No favorite markets in this universe') === true, 'empty universe portfolio')
		expect(document.querySelectorAll('.empty-state')).toHaveLength(1)
		expect(document.querySelector('.portfolio-positions')).toBeNull()
	})
})
