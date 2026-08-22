import type { Address, Hash } from '@zoltar/shared/ethereum'
import { parseUnitsOrUndefined } from '../lib/format.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import {
	approveRouter,
	connectWallet,
	createTradingPublicClient,
	createTradingWalletClient,
	discoverAllLiveMarketsInUniverse,
	discoverLiveUniverseMarketPage,
	loadLiveBalances,
	loadWalletHeaderBalances,
	publicErrorMessage,
	simulateEntry,
	simulateExit,
	submitFreshEntry,
	submitFreshExit,
	switchWalletChain,
	validateLiveDeployment,
	walletChainId,
	type LiveMarket,
} from '../protocol/live.js'
import type { LiveTradingControllerServices, TransactionState } from './live/liveTradingTypes.js'
export type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>
export type WorkflowOwner = 'position' | 'liquidity'

export const liveTradingControllerServices: LiveTradingControllerServices = {
	approveRouter,
	connectWallet,
	createTradingPublicClient,
	createTradingWalletClient,
	discoverAllLiveMarketsInUniverse,
	discoverLiveUniverseMarketPage,
	loadLiveBalances,
	loadWalletHeaderBalances,
	simulateEntry,
	simulateExit,
	submitFreshEntry,
	submitFreshExit,
	switchWalletChain,
	validateLiveDeployment,
	walletChainId,
}

export function walletSummaryRefreshState(account: Address | undefined, universeId: string | undefined): WalletSummaryState {
	return { account, ethAttoEth: undefined, repAttoRep: undefined, status: account === undefined ? 'disconnected' : 'loading', error: undefined, errorLabel: undefined, universeId }
}

export async function observeKnownReceipt<T>(receipt: Promise<T>, onKnownReceipt: () => void): Promise<T> {
	const knownReceipt = await receipt
	onKnownReceipt()
	return knownReceipt
}

export function walletSummaryDiscoveryRetryStart(discoveryState: 'loading' | 'ready' | 'error', selectedPoolAvailable: boolean, selectedPoolLoadError: string | undefined, currentPageStart: bigint) {
	return discoveryState === 'error' || !selectedPoolAvailable || selectedPoolLoadError !== undefined ? currentPageStart : undefined
}

export function walletSummaryAvailability(configurationAvailable: boolean, configurationError: string | undefined, discoveryState: 'loading' | 'ready' | 'error', discoveryError: string | undefined, selectedPoolAvailable: boolean) {
	if (!configurationAvailable) return configurationError === undefined ? { status: 'loading' as const, error: undefined, errorLabel: undefined } : { status: 'error' as const, error: configurationError, errorLabel: 'Deployment unavailable' }
	if (discoveryState === 'loading') return { status: 'loading' as const, error: undefined, errorLabel: undefined }
	if (discoveryState === 'error') return { status: 'error' as const, error: `SecurityPool discovery failed: ${discoveryError ?? 'unknown discovery error'}`, errorLabel: 'SecurityPool discovery failed' }
	if (selectedPoolAvailable) return undefined
	return { status: 'error' as const, error: 'No SecurityPool is available in the selected universe', errorLabel: 'No SecurityPool in this universe' }
}

export function parseSlippageBps(value: string) {
	const parsed = parseUnitsOrUndefined(value, 2)
	return parsed !== undefined && parsed >= 0n && parsed <= 500n ? parsed : undefined
}

export function parseTransactionValidityMinutes(value: string) {
	if (!/^\d+$/.test(value)) return undefined
	const parsed = BigInt(value)
	return parsed >= 1n && parsed <= 1_440n ? parsed : undefined
}

export function failedSubmissionTransition(caught: unknown, fallback: string) {
	return { quote: undefined, state: 'error' as const, message: publicErrorMessage(caught, fallback) }
}

export function broadcastUncertainMessage(label: string, hash: Hash) {
	return `${label} ${hash} was broadcast, but its receipt could not be confirmed. Do not resubmit. Check this hash in your wallet or configured block explorer, then reload only after its final status is known.`
}

export function approvalFailureTransition(label: string, broadcastHash: Hash | undefined, receiptKnown: boolean, caught: unknown, fallback: string) {
	if (broadcastHash !== undefined && !receiptKnown) return { keepLocked: true, state: 'pending' as const, message: undefined, warning: broadcastUncertainMessage(label, broadcastHash) }
	return { keepLocked: false, state: 'error' as const, message: publicErrorMessage(caught, fallback), warning: undefined }
}

export function positionControlsWorkflowLocked(state: TransactionState, receiptWarning: string | undefined) {
	return state === 'preparing' || state === 'approval' || state === 'approval-pending' || state === 'submitting' || state === 'pending' || receiptWarning !== undefined
}

export function discoveryCommitAllowed(owner: WorkflowOwner | undefined, positionLocked: boolean, liquidityLocked: boolean) {
	if (owner === 'position') return !liquidityLocked
	if (owner === 'liquidity') return !positionLocked
	return !positionLocked && !liquidityLocked
}

export function securityPoolAddressFromRoute(route: string) {
	const match = /^security-pool\/(0x[0-9a-fA-F]{40})$/.exec(route)
	return match?.[1]?.toLowerCase()
}

export function livePairInitialized(market: Pick<LiveMarket, 'pair' | 'lpTotalSupply' | 'yesReserve' | 'noReserve' | 'tradingStatus'>) {
	return market.pair !== undefined && market.lpTotalSupply > 0n && market.yesReserve > 0n && market.noReserve > 0n && market.tradingStatus !== 6
}

export function marketSelectionAfterDiscovery(markets: readonly Pick<LiveMarket, 'pool'>[], currentPool: Address | undefined, preserveCurrentPage: boolean) {
	if (preserveCurrentPage && markets.some(market => market.pool === currentPool)) return currentPool
	return markets[0]?.pool
}

export function filterMarketsByUniverse(markets: readonly LiveMarket[], selectedUniverseId: string | undefined) {
	if (selectedUniverseId === undefined) return []
	return markets.filter(market => market.universeId.toString() === selectedUniverseId)
}
