import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address, Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { LiveTrading as ProductionLiveTrading } from '../../features/LiveTrading.js'
import { liveLiquidityServices } from '../../features/LiveLiquidityControls.js'
import { liveSettlementServices } from '../../features/LiveSettlementControls.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import * as actualLive from '../../protocol/live.js'
import type { LiveMarket } from '../../protocol/live.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const secondPool = `0x${'23'.repeat(20)}` as Address
const secondShareToken = `0x${'45'.repeat(20)}` as Address
const childPool = `0x${'24'.repeat(20)}` as Address
const childShareToken = `0x${'46'.repeat(20)}` as Address
const factory = `0x${'55'.repeat(20)}` as Address
const router = `0x${'66'.repeat(20)}` as Address
const securityPoolFactory = `0x${'77'.repeat(20)}` as Address
const transactionHash = `0x${'88'.repeat(32)}` as Hash
const replacementTransactionHash = `0x${'89'.repeat(32)}` as Hash
const forbiddenLiveCopy = ['Binary shares for', 'INVALID is insurance', 'Canonical SecurityPools', 'In a live transaction', 'illustrative', 'Market signal', 'Exact identity', 'Preview ready', 'Gwei']

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

async function waitForDom(predicate: () => boolean, description: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		await settleAsyncWorkflow()
		if (predicate()) return
	}
	throw new Error(`Timed out waiting for ${description}. Rendered text: ${document.body.textContent}`)
}

function button(label: string) {
	const match = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}. Rendered text: ${document.body.textContent}`)
	return match
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
		},
		url: 'http://localhost/?demo=0#/market',
	})

	test('keeps the hash visible and every competing write locked after receipt polling and wallet context fail', async () => {
		let connectedAccount = account
		let positionReceipt = deferred<{ status: 'success' | 'reverted' }>()
		let waitForPositionReceipt = false
		let repricePositionReceipt = false
		let positionBroadcast = deferred<undefined>()
		let positionWalletWrite = deferred<undefined>()
		let deferPositionBroadcast = false
		let deferredWalletChainRead: ReturnType<typeof deferred<number>> | undefined
		let walletChainReadStarted: ReturnType<typeof deferred<undefined>> | undefined
		const rejectBalanceRefresh = false
		let deferSecondPortfolioBalance = false
		const secondPortfolioBalance = deferred<undefined>()
		let deferChildDiscovery = false
		const childDiscovery = deferred<undefined>()
		let childBalanceStarted = deferred<undefined>()
		const discoveredUniverseIds: Array<bigint | undefined> = []
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
		const market: LiveMarket = {
			pool,
			pair,
			shareToken,
			universeId: 1n,
			questionId: 2n,
			title: 'Rendered workflow market',
			description: 'Receipt uncertainty fixture',
			endTime: discoveredEndTime,
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
		const secondMarket: LiveMarket = { ...market, pool: secondPool, shareToken: secondShareToken, questionId: 3n, title: 'Second rendered workflow market' }
		const childMarket: LiveMarket = { ...market, pool: childPool, shareToken: childShareToken, universeId: 2n, questionId: 4n, title: 'Child-universe workflow market' }
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory, factory, router, feeBps: 30 }
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
			return { ...(await discoverMarkets()), universeIds: [1n, 2n], selectedUniverseId: 1n }
		}
		const controllerServices = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverLiveUniverseMarketPage: discoverSelectedUniverse,
			discoverAllLiveMarketsInUniverse: discoverSelectedUniverse,
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
			simulateEntry: async () => ({
				blockNumber: 1n,
				amount: 10n ** 16n,
				side: 'YES' as const,
				market,
				deadline: now + 1_200n,
				slippageBps: 50n,
				minimumLongShares: 1n,
				result: {
					completeSetShares: 1n,
					oppositeSharesSwapped: 1n,
					additionalLongShares: 1n,
					totalLongShares: 2n,
					invalidInsurance: 1n,
					feeAmount: 1n,
					conditionalYesBpsBefore: 5_000n,
					conditionalYesBpsAfter: 5_001n,
				},
			}),
			submitFreshEntry: async (_client: unknown, _configuration: unknown, _account: unknown, _quote: unknown, guardedWrite: <T>(write: () => Promise<T>) => Promise<T>) => {
				if (deferPositionBroadcast) await positionBroadcast.promise
				return await guardedWrite(async () => {
					if (deferPositionBroadcast) await positionWalletWrite.promise
					return transactionHash
				})
			},
		}
		const liquidityServices = liveLiquidityServices
		const LiveTrading = (props: Parameters<typeof ProductionLiveTrading>[0]) => <ProductionLiveTrading {...props} controllerServices={controllerServices} liquidityServices={liquidityServices} settlementServices={liveSettlementServices} />
		const workflowLocks: boolean[] = []
		let rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />)
		cleanupRendered = rendered.cleanup
		await flush()
		for (const phrase of forbiddenLiveCopy) expect(document.body.textContent?.toLowerCase()).not.toContain(phrase.toLowerCase())
		expect(document.body.textContent).not.toContain('2 nETH / gas')
		expect(document.body.textContent).toContain('Unsupported on-chain timestamp')
		expect(document.body.textContent).not.toContain('Unsupported on-chain timestamp UTC')
		discoveredLoadError = 'market RPC unavailable'
		await act(async () => button('Refresh').click())
		await flush()
		expect(document.body.textContent).toContain('Market data unavailable')
		expect(document.body.textContent).toContain(pool)
		expect(document.body.textContent).not.toContain(shareToken)
		expect(document.body.textContent).not.toContain('Question ID2')
		expect(document.body.textContent).not.toContain('INVALID 256 · YES 257 · NO 258')
		discoveredLoadError = undefined
		await act(async () => button('Refresh').click())
		await flush()
		discoveredEndTime = now + 2n

		deferredWalletChainRead = deferred<number>()
		walletChainReadStarted = deferred<undefined>()
		await act(async () => {
			button('Connect wallet').click()
			await walletChainReadStarted?.promise
		})
		const summariesBeforeUnmountedConnectionResolution = walletSummaries.length
		await rendered.cleanup()
		cleanupRendered = undefined
		deferredWalletChainRead.resolve(configuration.chainId)
		await settleAsyncWorkflow()
		expect(walletSummaries).toHaveLength(summariesBeforeUnmountedConnectionResolution)
		expect(walletListeners.size).toBe(0)
		deferredWalletChainRead = undefined
		walletChainReadStarted = undefined
		const poolRoute = `security-pool/${pool}`
		deferredWalletChainRead = deferred<number>()
		walletChainReadStarted = deferred<undefined>()
		rendered = await renderIntoDocument(<LiveTrading route={poolRoute} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} walletConnectRequestNonce={0} />)
		cleanupRendered = rendered.cleanup
		await flush()
		await act(() => render(<LiveTrading route={poolRoute} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} walletConnectRequestNonce={1} />, rendered.container))
		await walletChainReadStarted.promise
		await act(() => render(<LiveTrading route='markets' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} walletConnectRequestNonce={1} />, rendered.container))
		deferredWalletChainRead.reject(new Error('Wallet request rejected after navigation'))
		await settleAsyncWorkflow()
		expect(document.body.textContent).not.toContain('Wallet request rejected after navigation')
		await act(() => render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} walletConnectRequestNonce={1} />, rendered.container))
		await settleAsyncWorkflow()
		expect(document.body.textContent).not.toContain('Wallet request rejected after navigation')
		deferredWalletChainRead = undefined
		walletChainReadStarted = undefined
		await act(() => render(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await settleAsyncWorkflow()
		await flush()
		deferredWalletChainRead = deferred<number>()
		walletChainReadStarted = deferred<undefined>()
		const discoveriesBeforeMidConnectUniverseChange = discoveredUniverseIds.length
		await act(async () => {
			button('Connect wallet').click()
			await walletChainReadStarted?.promise
		})
		await act(() => render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='2' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		deferredWalletChainRead.resolve(configuration.chainId)
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.slice(discoveriesBeforeMidConnectUniverseChange)).not.toContain(1n)
		expect(discoveredUniverseIds.at(-1)).toBe(2n)
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, universeId: '2', status: 'ready', repAttoRep: 6n * 10n ** 18n })
		deferredWalletChainRead = undefined
		walletChainReadStarted = undefined
		deferSecondPortfolioBalance = true
		await act(() => render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await waitForDom(() => document.querySelectorAll('[data-portfolio-pool]').length === 2, 'both portfolio pools')
		expect(document.querySelectorAll('[data-portfolio-pool]')).toHaveLength(2)
		expect(document.body.textContent).toContain(secondPool)
		const firstPortfolioCard = document.querySelector(`[data-portfolio-pool="${pool}"]`)
		const secondPortfolioCard = document.querySelector(`[data-portfolio-pool="${secondPool}"]`)
		expect(firstPortfolioCard?.textContent).toContain('1 YES')
		expect(secondPortfolioCard?.textContent).not.toContain('4 YES')
		secondPortfolioBalance.resolve(undefined)
		await Bun.sleep(10)
		await flush()
		expect(secondPortfolioCard?.textContent).toContain('4 YES')
		childBalanceStarted = deferred<undefined>()
		deferChildDiscovery = true
		render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='2' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container)
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
		expect(discoveredUniverseIds.slice(universeTwoDiscoveryCount)).not.toContain(1n)
		expect(discoveredUniverseIds.at(-1)).toBe(2n)
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, universeId: '2', status: 'ready', repAttoRep: 6n * 10n ** 18n })
		const universeTwoChainDiscoveryCount = discoveredUniverseIds.length
		await act(async () => walletListeners.get('chainChanged')?.('0x7a69'))
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.slice(universeTwoChainDiscoveryCount)).not.toContain(1n)
		expect(discoveredUniverseIds.at(-1)).toBe(2n)
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, universeId: '2', status: 'ready', repAttoRep: 6n * 10n ** 18n })
		deferChildDiscovery = false
		await act(() => render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await flush()
		deferredWalletChainRead = deferred<number>()
		walletChainReadStarted = deferred<undefined>()
		connectedAccount = `0x${'9c'.repeat(20)}` as Address
		const discoveriesBeforeMidEventUniverseChange = discoveredUniverseIds.length
		await act(async () => {
			walletListeners.get('accountsChanged')?.([connectedAccount])
			await walletChainReadStarted?.promise
		})
		await act(() => render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='2' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		deferredWalletChainRead.resolve(configuration.chainId)
		await settleAsyncWorkflow()
		expect(discoveredUniverseIds.slice(discoveriesBeforeMidEventUniverseChange)).not.toContain(1n)
		expect(discoveredUniverseIds.at(-1)).toBe(2n)
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, universeId: '2', status: 'ready', repAttoRep: 6n * 10n ** 18n })
		deferredWalletChainRead = undefined
		walletChainReadStarted = undefined
		await act(() => render(<LiveTrading route='portfolio' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await flush()
		rejectDiscovery = true
		await act(async () => button('Refresh').click())
		await flush()
		expect(Array.from(document.querySelectorAll('[role="alert"]')).filter(candidate => candidate.textContent?.includes('SecurityPool discovery failed') === true)).toHaveLength(1)
		expect(Array.from(document.querySelectorAll('button')).filter(candidate => candidate.textContent?.trim() === 'Refresh')).toHaveLength(1)
		expect(document.body.textContent).not.toContain('Retry balances')
		rejectDiscovery = false
		await act(async () => button('Refresh').click())
		await flush()
		await act(() => render(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await flush()
		connectedAccount = `0x${'9a'.repeat(20)}` as Address
		await act(async () => walletListeners.get('accountsChanged')?.([connectedAccount]))
		await settleAsyncWorkflow()
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, status: 'ready' })
		expect(document.body.textContent).not.toContain('Reconnect before simulating or submitting')
		await act(() => render(<LiveTrading route={`security-pool/${pool}`} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await settleAsyncWorkflow()
		const summariesBeforeChainRefresh = walletSummaries.length
		await act(async () => walletListeners.get('chainChanged')?.('0x7a69'))
		await settleAsyncWorkflow()
		expect(walletSummaries.length).toBeGreaterThan(summariesBeforeChainRefresh)
		expect(walletSummaries.at(-1)).toMatchObject({ account: connectedAccount, ethAttoEth: 5n * 10n ** 18n, repAttoRep: 6n * 10n ** 18n, status: 'ready' })
		expect(document.body.textContent).not.toContain('Refreshing wallet context')
		await act(() => render(<LiveTrading route='market' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} onWalletSummaryChange={recordWalletSummary} />, rendered.container))
		await settleAsyncWorkflow()

		await act(async () => button('Enter').click())
		await act(async () => button('Preview trade').click())
		await settleAsyncWorkflow()
		expect(button('Enter YES').classList.contains('tx-action-button')).toBeTrue()
		expect(document.querySelector('.transaction-review-primary')).not.toBeNull()
		deferPositionBroadcast = true
		waitForPositionReceipt = true
		repricePositionReceipt = true
		positionReceipt = deferred<{ status: 'success' | 'reverted' }>()
		positionBroadcast = deferred<undefined>()
		positionWalletWrite = deferred<undefined>()
		await act(async () => button('Enter YES').click())
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Preparing Enter YES')
		expect(document.querySelector('.transaction-hash')).toBeNull()
		positionBroadcast.resolve(undefined)
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Enter YES pending in wallet')
		expect(document.querySelector('.transaction-hash')).toBeNull()
		positionWalletWrite.resolve(undefined)
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Enter YES pending on-chain')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(transactionHash)
		expect(document.querySelector('.transaction-hash-link')).not.toBeNull()
		positionReceipt.resolve({ status: 'success' })
		await settleAsyncWorkflow()
		expect(document.body.textContent).toContain('Enter YES confirmed on-chain')
		expect(document.querySelector('.transaction-hash')?.textContent).toContain(replacementTransactionHash)
		deferPositionBroadcast = false
		waitForPositionReceipt = false
		repricePositionReceipt = false
		const protectionInputs = document.querySelectorAll<HTMLInputElement>('.operation-block .execution-settings input')
		if (protectionInputs.length !== 2) throw new Error('Missing position transaction protection fields')
		await act(() => {
			const slippageInput = protectionInputs[0]
			const validityInput = protectionInputs[1]
			if (slippageInput === undefined || validityInput === undefined) throw new Error('Missing position transaction protection input')
			slippageInput.value = '0.6'
			slippageInput.dispatchEvent(new Event('input', { bubbles: true }))
			validityInput.value = '21'
			validityInput.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(document.querySelector('.transaction-hash')).toBeNull()

		await act(async () => button('Exit').click())
		const positionAction = document.querySelector('.operation-block .tx-action-button')
		const poolMechanics = document.querySelector('.operation-block .pool-mechanics')
		if (positionAction === null || poolMechanics === null) throw new Error('Missing position action or pool mechanics disclosure')
		expect(positionAction.compareDocumentPosition(poolMechanics) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
		const secondMarketButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.live-market-button')).find(candidate => candidate.textContent?.includes('Second rendered workflow market') === true)
		if (secondMarketButton === undefined) throw new Error('Missing second market selector')
		expect(document.body.textContent).not.toContain('Factory discovery')
		expect(document.querySelector('.market-list.section')).toBeNull()
		expect(document.querySelector('.market-stack')).not.toBeNull()
		await act(async () => secondMarketButton.click())
		await settleAsyncWorkflow()
		expect(document.querySelector('.transaction-hash')).toBeNull()
		const firstMarketButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.live-market-button')).find(candidate => candidate.textContent?.includes('Rendered workflow market') === true && candidate.textContent?.includes('Second') !== true)
		if (firstMarketButton === undefined) throw new Error('Missing first market selector')
		await act(async () => firstMarketButton.click())
		await settleAsyncWorkflow()
		await act(() => render(<LiveTrading route='liquidity' configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={locked => workflowLocks.push(locked)} />, rendered.container))
		await act(async () => button('Refresh').click())
		await flush()
		await act(async () => button('Remove').click())
		expect(hasButton('Approve exact LP amount')).toBeFalse()
		expect(hasButton('Simulate liquidity transaction')).toBeTrue()
	})
})
