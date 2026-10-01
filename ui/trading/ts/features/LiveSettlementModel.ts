import { attoSharesToCollateralAttoEth, formatCollateralEth, formatOutcomeQuantity, type ShareValueRate } from '../lib/shareValue.js'
import type { ForkTarget } from '../protocol/forks.js'
import type { LiveMarket, SettlementOperation, ShareOutcome } from '../protocol/live.js'
import { resolvedShareOutcome } from '../lib/marketLabels.js'
import * as settlementCopy from '../copy/settlement.js'
import type { BalanceState } from './live/liveTradingTypes.js'

type SettlementLifecycle = Pick<LiveMarket, 'loadError' | 'systemState' | 'universeForkTime' | 'questionOutcome'>
type SettlementHoldings = Readonly<{ completeSets: bigint; winningBalance: bigint; directionalBalance: bigint }>

/** Why the selected settlement action cannot run for this market and wallet, or undefined when it can. */
export function settlementUnavailableReason(operation: SettlementOperation, market: SettlementLifecycle, holdings: SettlementHoldings) {
	if (market.loadError !== undefined) return settlementCopy.marketDataUnavailableReason
	if (operation === 'migrate-shares') {
		if (market.universeForkTime === 0n) return settlementCopy.universeNotForkedReason
		if (holdings.directionalBalance === 0n) return settlementCopy.noSharesToMigrateReason
		return undefined
	}
	if (operation === 'redeem-complete-set') {
		if (market.universeForkTime !== 0n) return settlementCopy.universeForkedReason
		if (market.systemState !== 0) return settlementCopy.poolNotOperationalReason
		return holdings.completeSets === 0n ? settlementCopy.noCompleteSetsReason : undefined
	}
	if (market.systemState !== 0) return settlementCopy.poolNotOperationalReason
	const winningOutcome = resolvedShareOutcome(market.questionOutcome)
	if (winningOutcome === undefined) return settlementCopy.questionNotResolvedReason
	return holdings.winningBalance === 0n ? settlementCopy.noWinningSharesReason(winningOutcome) : undefined
}

export function migrationSimulationSummary(blockNumber: bigint, sourceOutcome: ShareOutcome, targetCount: bigint) {
	return `Fork migration simulation ready at block ${blockNumber.toString()}: the entire selected ${sourceOutcome} balance will be copied into ${targetCount.toString()} selected child ${targetCount === 1n ? 'branch' : 'branches'} and locked in the parent universe.`
}

export function settlementInputBlocker(operation: SettlementOperation, unavailableReason: string | undefined, completeSetsAttoShares: bigint, parsedAmountAttoShares: bigint | undefined, targetOutcomeIndexes: readonly bigint[], sourceOutcome: ShareOutcome, sourceBalance: bigint | undefined, rate: ShareValueRate) {
	if (unavailableReason !== undefined) return unavailableReason
	if (operation === 'redeem-complete-set') {
		if (parsedAmountAttoShares === undefined || parsedAmountAttoShares === 0n) return 'Enter a valid positive complete-set value'
		if (parsedAmountAttoShares > completeSetsAttoShares) return `Enter no more than the available complete-set balance of ${formatCollateralEth(completeSetsAttoShares, rate, 'down')}`
		if (attoSharesToCollateralAttoEth(parsedAmountAttoShares, rate) === 0n) return 'Amount too small to redeem any ETH'
	}
	if (operation === 'migrate-shares') {
		if (targetOutcomeIndexes.length === 0) return 'Select at least one child branch from the fork question'
		if (sourceBalance === undefined || sourceBalance === 0n) return `The selected ${sourceOutcome} balance is zero`
	}
	return undefined
}

export function forkMigrationBatchBlocker(targets: readonly ForkTarget[]) {
	if (targets.length <= 1 || targets.every(target => target.canonicalPool !== undefined)) return undefined
	return 'This selection includes a missing child pool; migrate each missing target separately for the current source share'
}

export function forkMigrationBatchWarning(targets: readonly ForkTarget[]) {
	if (forkMigrationBatchBlocker(targets) === undefined) return undefined
	return 'For this source share, submit each missing child as a separate migration. After confirmation, do not select that same source-child pair again. A different source share may batch those children once their pools are ready.'
}

export function settlementBalanceLabel(balanceState: BalanceState, balance: bigint | undefined, rate: ShareValueRate, outcome?: ShareOutcome) {
	if (balanceState === 'loading') return 'Loading…'
	if (balanceState === 'error') return 'Unavailable'
	if (balanceState !== 'ready' || balance === undefined) return 'Not loaded'
	return outcome === undefined ? formatCollateralEth(balance, rate, 'down') : formatOutcomeQuantity(balance, outcome)
}
