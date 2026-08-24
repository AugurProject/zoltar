import type { Address } from '@zoltar/shared/ethereum'

export type LiveMarket = Readonly<{
	loadError?: string
	pool: Address
	pair: Address | undefined
	shareToken: Address
	universeId: bigint
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
	currentRetentionRate: bigint
	totalCapacityOwnershipAttoRep: bigint
	feeEligibleCapacityOwnershipAttoRep: bigint
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
	if (questionOutcome === 0) return 'Resolved INVALID'
	if (questionOutcome === 1) return 'Resolved YES'
	if (questionOutcome === 2) return 'Resolved NO'
	return 'Question resolved'
}

export function marketNewRiskBlocker(market: MarketLifecycle, nowSeconds: bigint) {
	if (market.loadError !== undefined) return 'Market data unavailable'
	if (market.tradingStatus !== undefined && market.tradingStatus !== 6) {
		if (market.tradingStatus === 1) return 'Question ended'
		if (market.tradingStatus === 2) return 'Pool inactive'
		if (market.tradingStatus === 3) return 'Awaiting fork continuation'
		if (market.tradingStatus === 4) return 'Universe forked'
		if (market.tradingStatus === 5) return resolvedOutcomeLabel(market.questionOutcome)
	}
	if (market.universeForkTime !== 0n) return 'Universe forked'
	if (market.awaitingForkContinuation) return 'Awaiting fork continuation'
	if (market.systemState !== 0) return 'Pool inactive'
	if (market.questionOutcome !== 3) return resolvedOutcomeLabel(market.questionOutcome)
	if (nowSeconds >= market.endTime) return 'Question ended'
	return undefined
}

export function marketAcceptsNewRisk(market: MarketLifecycle, nowSeconds: bigint) {
	return marketNewRiskBlocker(market, nowSeconds) === undefined
}

type ShareBalanceScope = Readonly<{ pool: Address; shareToken: Address; invalidTokenId: bigint; yesTokenId: bigint; noTokenId: bigint }>

export type LiveBalances = Readonly<{ scope: ShareBalanceScope; yes: bigint; no: bigint; invalid: bigint; lp: bigint; approved: boolean; lpAllowance: bigint }>

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
