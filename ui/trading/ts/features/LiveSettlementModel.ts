import { attoSharesToCollateralAttoEth, formatCollateralEth, formatOutcomeQuantity, type ShareValueRate } from '../lib/shareValue.js'
import type { ForkTarget } from '../protocol/forks.js'
import { settlementUnavailability, type LiveBalances, type LiveMarket, type SettlementOperation, type SettlementUnavailableReason, type ShareOutcome } from '../protocol/live.js'
import * as settlementCopy from '../copy/settlement.js'
import type { BalanceState } from './live/liveTradingTypes.js'

type SettlementLifecycle = Pick<LiveMarket, 'loadError' | 'systemState' | 'universeForkTime' | 'questionOutcome'>

const settlementUnavailableCopy = {
	'market-data-unavailable': settlementCopy.marketDataUnavailableReason,
	'universe-not-forked': settlementCopy.universeNotForkedReason,
	'no-shares-to-migrate': settlementCopy.noSharesToMigrateReason,
	'universe-forked': settlementCopy.universeForkedReason,
	'pool-not-operational': settlementCopy.poolNotOperationalReason,
	'no-complete-sets': settlementCopy.noCompleteSetsReason,
	'question-not-resolved': settlementCopy.questionNotResolvedReason,
} satisfies Record<Exclude<SettlementUnavailableReason['code'], 'no-winning-shares'>, string>

function settlementUnavailableReasonCopy(reason: SettlementUnavailableReason) {
	return reason.code === 'no-winning-shares' ? settlementCopy.noWinningSharesReason(reason.outcome) : settlementUnavailableCopy[reason.code]
}

/** Why the selected settlement action cannot run for this market and wallet, or undefined when it can. */
export function settlementUnavailableReason(operation: SettlementOperation, market: SettlementLifecycle, balances: Pick<LiveBalances, 'invalid' | 'yes' | 'no'> | undefined) {
	const reason = settlementUnavailability(operation, market, balances)
	return reason === undefined ? undefined : settlementUnavailableReasonCopy(reason)
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
