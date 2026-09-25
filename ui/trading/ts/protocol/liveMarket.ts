import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getReportingOutcomeKey } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import * as blockerCopy from '../copy/marketBlockers.js'

export type LiveMarket = Readonly<{
	loadError?: string
	pool: Address
	pair: Address | undefined
	shareToken: Address
	universeId: bigint
	originUniverseId?: bigint
	questionId: bigint
	title: string
	description: string
	endTime: bigint
	statoblastSecurityMultiplierBps: bigint
	initialReportPriorityFeeAttoEthPerGas: bigint
	systemState: number
	awaitingForkContinuation: boolean
	universeForkTime: bigint
	vaultCount: bigint
	shareTokenSupplyAttoShares: bigint
	settlementCollateralAttoEth: bigint
	valuation?: Readonly<{ timestamp: bigint; feeEndTime: bigint; projectedCollateralAttoEth: bigint }>
	currentRetentionRate: bigint
	totalCapacityOwnershipAttoRep: bigint
	activeObligationUnits: bigint
	mintingCapacityCeilingAttoEth: bigint
	availableMintingCapacityAttoEth: bigint
	feeBps: bigint
	tradingStatus: number | undefined
	questionOutcome: number
	yesReserve: bigint
	noReserve: bigint
	lpTotalSupply: bigint
}>

export type MarketLifecycle = Pick<LiveMarket, 'loadError' | 'tradingStatus' | 'systemState' | 'awaitingForkContinuation' | 'universeForkTime' | 'questionOutcome' | 'endTime'>

function resolvedOutcomeLabel(questionOutcome: number) {
	const key = getReportingOutcomeKey(questionOutcome)
	if (key === 'invalid') return blockerCopy.resolvedOutcome('INVALID')
	if (key === 'yes') return blockerCopy.resolvedOutcome('YES')
	if (key === 'no') return blockerCopy.resolvedOutcome('NO')
	return blockerCopy.questionResolved
}

export function marketNewRiskBlocker(market: MarketLifecycle, nowSeconds: bigint) {
	if (market.loadError !== undefined) return blockerCopy.marketDataUnavailable
	if (market.tradingStatus !== undefined && market.tradingStatus !== 6) {
		if (market.tradingStatus === 1) return blockerCopy.questionEnded
		if (market.tradingStatus === 2) return blockerCopy.poolInactive
		if (market.tradingStatus === 3) return blockerCopy.awaitingForkContinuation
		if (market.tradingStatus === 4) return blockerCopy.universeForked
		if (market.tradingStatus === 5) return resolvedOutcomeLabel(market.questionOutcome)
	}
	if (market.universeForkTime !== 0n) return blockerCopy.universeForked
	if (market.awaitingForkContinuation) return blockerCopy.awaitingForkContinuation
	if (market.systemState !== 0) return blockerCopy.poolInactive
	if (market.questionOutcome !== 3) return resolvedOutcomeLabel(market.questionOutcome)
	if (nowSeconds >= market.endTime) return blockerCopy.questionEnded
	return undefined
}

export function marketAcceptsNewRisk(market: MarketLifecycle, nowSeconds: bigint) {
	return marketNewRiskBlocker(market, nowSeconds) === undefined
}

type ShareBalanceScope = Readonly<{ pool: Address; shareToken: Address; invalidTokenId: bigint; yesTokenId: bigint; noTokenId: bigint }>

export type LiveBalances = Readonly<{ scope: ShareBalanceScope; yes: bigint; no: bigint; invalid: bigint; lp: bigint }>

export function shareBalanceScope(market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId'>) {
	const invalidTokenId = market.universeId << 8n
	return {
		pool: market.pool,
		shareToken: market.shareToken,
		invalidTokenId,
		yesTokenId: invalidTokenId | 1n,
		noTokenId: invalidTokenId | 2n,
	} as const
}

export function liveBalancesForMarket(balances: LiveBalances | undefined, market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId'> | undefined) {
	if (balances === undefined || market === undefined) return undefined
	const scope = shareBalanceScope(market)
	if (balances.scope.pool !== scope.pool || balances.scope.shareToken !== scope.shareToken) return undefined
	if (balances.scope.invalidTokenId !== scope.invalidTokenId || balances.scope.yesTokenId !== scope.yesTokenId || balances.scope.noTokenId !== scope.noTokenId) return undefined
	return balances
}
