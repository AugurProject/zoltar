import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getReportingOutcomeKey } from '@zoltar/ui-core-shared/lib/contractEnums.js'
import type { FeeAccounting } from './holdingFees.js'
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
	valuation?: Readonly<{ timestamp: bigint; feeEndTime: bigint; projectedCollateralAttoEth: bigint; feeAccounting?: FeeAccounting }>
	currentRetentionRate: bigint
	totalUnderwritingLimitAttoEth: bigint
	feeEligibleUnderwritingLimitAttoEth: bigint
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

/** Resolved pools keep winning redemption after a later fork; unresolved forked pools offer migration. */
export type MarketSettlementPath = 'redeem-complete-sets' | 'redeem-winning-shares' | 'migrate-shares' | 'unavailable'

export function marketSettlementPath(market: Pick<MarketLifecycle, 'loadError' | 'systemState' | 'universeForkTime' | 'questionOutcome'>): MarketSettlementPath {
	if (market.loadError !== undefined) return 'unavailable'
	if (getReportingOutcomeKey(market.questionOutcome) !== 'none') return market.systemState === 0 ? 'redeem-winning-shares' : 'unavailable'
	if (market.universeForkTime !== 0n) return 'migrate-shares'
	if (market.systemState !== 0) return 'unavailable'
	return 'redeem-complete-sets'
}

export function marketAcceptsNewRisk(market: MarketLifecycle, nowSeconds: bigint) {
	return marketNewRiskBlocker(market, nowSeconds) === undefined
}

type ShareBalanceScope = Readonly<{ pool: Address; shareToken: Address; invalidTokenId: bigint; yesTokenId: bigint; noTokenId: bigint }>

/**
 * `migrated` is the largest amount of each outcome the account migrated into any one child universe after a fork.
 * ShareToken.migrate locks the source balance instead of burning it, so a positive amount marks that balance as locked.
 * It is undefined while the universe has not forked or when the migration record could not be read.
 */
export type LiveBalances = Readonly<{ scope: ShareBalanceScope; yes: bigint; no: bigint; invalid: bigint; lp: bigint; migrated?: Readonly<{ invalid: bigint; yes: bigint; no: bigint }> | undefined }>

/** Shares of `outcome` the wallet holds whose transfers are locked after a migration; zero when unknown or never migrated. */
export function lockedMigratedBalance(balances: Pick<LiveBalances, 'invalid' | 'yes' | 'no' | 'migrated'>, outcome: 'INVALID' | 'YES' | 'NO') {
	let key: 'invalid' | 'yes' | 'no' = 'no'
	if (outcome === 'INVALID') key = 'invalid'
	else if (outcome === 'YES') key = 'yes'
	return balances.migrated === undefined || balances.migrated[key] === 0n ? 0n : balances[key]
}

/**
 * True when every held Yes, No, and Invalid balance has been migrated into at least one child universe, so nothing is
 * waiting for a first migration. Unknown migration records count as pending.
 */
export function forkMigrationSettled(balances: Pick<LiveBalances, 'invalid' | 'yes' | 'no' | 'migrated'>) {
	const migrated = balances.migrated
	if (migrated === undefined) return false
	return (['invalid', 'yes', 'no'] as const).every(key => balances[key] === 0n || migrated[key] >= balances[key])
}

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
