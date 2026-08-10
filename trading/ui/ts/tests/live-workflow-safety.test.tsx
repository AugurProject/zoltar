import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import type { LiveMarket } from '../protocol/live.ts'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const pair = `0x${'33'.repeat(20)}` as Address
const shareToken = `0x${'44'.repeat(20)}` as Address
const factory = `0x${'55'.repeat(20)}` as Address
const router = `0x${'66'.repeat(20)}` as Address
const securityPoolFactory = `0x${'77'.repeat(20)}` as Address
const transactionHash = `0x${'88'.repeat(32)}` as Hash

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

function button(label: string) {
	const match = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label)
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}. Rendered text: ${document.body.textContent}`)
	return match
}

describe('live workflow safety boundary', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/?demo=0#/market').cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('keeps the hash visible and every competing write locked after receipt polling and wallet context fail', async () => {
		let contextApprovalReceipt = deferred<{ status: 'success' | 'reverted' }>()
		let waitForContextApprovalReceipt = false
		let approved = false
		let lpAllowance = 10n ** 18n
		let rejectBalanceRefresh = false
		const walletListeners = new Map<string, (...args: unknown[]) => void>()
		Reflect.set(window, 'ethereum', {
			request: async () => undefined,
			on: (eventName: string, listener: (...args: unknown[]) => void) => walletListeners.set(eventName, listener),
			removeListener: (eventName: string) => walletListeners.delete(eventName),
		})
		const walletClient = {
			waitForTransactionReceipt: async () => {
				if (waitForContextApprovalReceipt) return await contextApprovalReceipt.promise
				return { status: 'success' as const }
			},
		}
		const now = BigInt(Math.floor(Date.now() / 1_000))
		let discoveredEndTime = 2n ** 255n
		let discoveredLoadError: string | undefined
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
			initialReportPriorityFeeAttoEthPerGas: 1n,
			systemState: 0,
			awaitingForkContinuation: false,
			universeForkTime: 0n,
			activeVaultCount: 1n,
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
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:8545', securityPoolFactory, factory, router, feeBps: 30 }
		const actualLive = await import('../protocol/live.ts')
		mock.module('../protocol/live.ts', () => ({
			...actualLive,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverLiveMarketPage: async () => ({ start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [{ ...market, endTime: discoveredEndTime, loadError: discoveredLoadError }] }),
			walletChainId: async () => configuration.chainId,
			connectWallet: async () => account,
			createTradingWalletClient: () => walletClient,
			loadLiveBalances: async () => {
				if (rejectBalanceRefresh) throw new Error('balance RPC unavailable')
				return { scope: actualLive.shareBalanceScope(market), invalid: 10n ** 18n, yes: 10n ** 18n, no: 10n ** 18n, approved, lp: 10n ** 18n, lpAllowance }
			},
			approveRouter: async () => {
				approved = true
				return transactionHash
			},
			approveLpRouter: async () => transactionHash,
			simulateEntry: async () => ({
				blockNumber: 1n,
				amount: 10n ** 16n,
				side: 'YES' as const,
				market,
				deadline: now + 1_200n,
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
			submitFreshEntry: async () => transactionHash,
		}))
		const { LiveTrading } = await import('../features/LiveTrading.tsx')
		const workflowLocks: boolean[] = []
		const rendered = await renderIntoDocument(<LiveTrading route='market' configuration={configuration} configurationError={undefined} onWorkflowLockChange={locked => workflowLocks.push(locked)} />)
		cleanupRendered = rendered.cleanup
		await flush()
		expect(document.body.textContent).toContain('Unsupported on-chain timestamp')
		expect(document.body.textContent).not.toContain('Unsupported on-chain timestamp UTC')
		discoveredLoadError = 'market RPC unavailable'
		await act(async () => button('Refresh').click())
		await flush()
		expect(document.body.textContent).toContain('Market data unavailable')
		expect(document.body.textContent).toContain(pool)
		expect(document.body.textContent).toContain(shareToken)
		expect(document.body.textContent).toContain('1 / 2')
		expect(document.body.textContent).toContain('INVALID 256 · YES 257 · NO 258')
		discoveredLoadError = undefined
		await act(async () => button('Refresh').click())
		await flush()
		discoveredEndTime = now + 2n

		await act(async () => button('Connect wallet').click())
		await flush()
		await act(async () => button('Exit').click())
		rejectBalanceRefresh = true
		await act(async () => button('Approve router for all ShareToken shares').click())
		await flush()
		expect(document.body.textContent).toContain('Share-token approval confirmed, but balances could not be refreshed: balance RPC unavailable')
		expect(document.body.textContent).toContain('Retry balances')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(document.body.textContent?.split('Share-token approval confirmed').length).toBe(2)
		expect(Array.from(document.querySelectorAll('[role="alert"]')).filter(candidate => candidate.textContent?.includes('Share-token approval confirmed') === true)).toHaveLength(1)

		rejectBalanceRefresh = false
		approved = false
		await act(async () => button('Retry balances').click())
		await flush()
		expect(document.body.textContent).not.toContain('balance RPC unavailable')
		waitForContextApprovalReceipt = true
		await act(async () => button('Approve router for all ShareToken shares').click())
		await act(async () => {
			walletListeners.get('accountsChanged')?.([`0x${'99'.repeat(20)}`])
			contextApprovalReceipt.resolve({ status: 'success' })
			await contextApprovalReceipt.promise
		})
		await flush()
		expect(document.body.textContent).toContain('Wallet account changed. Reconnect before simulating or submitting.')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(button('Connect wallet').disabled).toBeFalse()
		expect(workflowLocks.at(-1)).toBeFalse()

		await act(async () => button('Connect wallet').click())
		await flush()
		lpAllowance = 0n
		await act(() => render(<LiveTrading route='liquidity' configuration={configuration} configurationError={undefined} onWorkflowLockChange={locked => workflowLocks.push(locked)} />, rendered.container))
		await act(async () => button('Refresh').click())
		await flush()
		await act(async () => button('Remove').click())
		rejectBalanceRefresh = true
		await act(async () => button('Approve exact LP amount').click())
		await flush()
		expect(document.body.textContent).toContain('LP-token approval confirmed, but balances could not be refreshed: balance RPC unavailable')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(workflowLocks.at(-1)).toBeFalse()

		rejectBalanceRefresh = false
		await act(() => render(<LiveTrading key='lp-context' route='liquidity' configuration={configuration} configurationError={undefined} onWorkflowLockChange={locked => workflowLocks.push(locked)} />, rendered.container))
		await flush()
		await act(async () => button('Connect wallet').click())
		await flush()
		await act(async () => button('Remove').click())
		contextApprovalReceipt = deferred<{ status: 'success' | 'reverted' }>()
		await act(async () => button('Approve exact LP amount').click())
		await act(async () => {
			walletListeners.get('accountsChanged')?.([`0x${'96'.repeat(20)}`])
			contextApprovalReceipt.resolve({ status: 'success' })
			await contextApprovalReceipt.promise
		})
		await flush()
		expect(document.body.textContent).toContain('Wallet context changed while the LP-token approval was pending')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(workflowLocks.at(-1)).toBeFalse()

		discoveredEndTime = now - 1n
		approved = false
		waitForContextApprovalReceipt = false
		await act(() => render(<LiveTrading key='settlement-refresh' route='market' configuration={configuration} configurationError={undefined} onWorkflowLockChange={locked => workflowLocks.push(locked)} />, rendered.container))
		await flush()
		await act(async () => button('Connect wallet').click())
		await flush()
		rejectBalanceRefresh = true
		await act(async () => button('Approve router for complete-set redemption').click())
		await flush()
		expect(document.body.textContent).toContain('Share-token approval confirmed, but balances could not be refreshed: balance RPC unavailable')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(workflowLocks.at(-1)).toBeFalse()

		rejectBalanceRefresh = false
		approved = false
		await act(async () => button('Retry balances').click())
		await flush()
		waitForContextApprovalReceipt = true
		contextApprovalReceipt = deferred<{ status: 'success' | 'reverted' }>()
		await act(async () => button('Approve router for complete-set redemption').click())
		await act(async () => {
			walletListeners.get('accountsChanged')?.([`0x${'95'.repeat(20)}`])
			contextApprovalReceipt.resolve({ status: 'success' })
			await contextApprovalReceipt.promise
		})
		await flush()
		expect(document.body.textContent).toContain('Wallet context changed while the share-token approval was pending')
		expect(document.body.textContent).not.toContain('Refreshing wallet balances and approvals')
		expect(workflowLocks.at(-1)).toBeFalse()

		approved = false
		contextApprovalReceipt = deferred<{ status: 'success' | 'reverted' }>()
		await act(async () => button('Connect wallet').click())
		await flush()
		await act(async () => button('Approve router for complete-set redemption').click())
		await act(async () => {
			walletListeners.get('accountsChanged')?.([`0x${'98'.repeat(20)}`])
			contextApprovalReceipt.resolve({ status: 'reverted' })
			await contextApprovalReceipt.promise
		})
		await flush()
		expect(document.body.textContent).toContain('Wallet context changed while the share-token approval was pending. Approval transaction reverted.')
		expect(button('Connect wallet').disabled).toBeFalse()
		expect(workflowLocks.at(-1)).toBeFalse()

		approved = false
		contextApprovalReceipt = deferred<{ status: 'success' | 'reverted' }>()
		await act(async () => button('Connect wallet').click())
		await flush()
		await act(async () => button('Approve router for complete-set redemption').click())
		await act(async () => {
			walletListeners.get('accountsChanged')?.([`0x${'97'.repeat(20)}`])
			contextApprovalReceipt.reject(new Error('approval receipt polling failed'))
			await contextApprovalReceipt.promise.catch(() => undefined)
		})
		await flush()

		const warning = Array.from(document.querySelectorAll('[role="alert"]')).find(candidate => candidate.textContent?.includes(transactionHash) === true)
		expect(warning?.textContent).toContain('Do not resubmit')
		expect(document.body.textContent).toContain('Wallet account changed. Reconnect before simulating or submitting.')
		expect(button('Refresh').disabled).toBeTrue()
		expect(button('Connect wallet').disabled).toBeTrue()
		expect(workflowLocks.at(-1)).toBeTrue()

		await Bun.sleep(2_100)
		await flush()
		expect(button('Simulate authoritative settlement').disabled).toBeTrue()
		expect(warning?.textContent).toContain(transactionHash)
	})
})
