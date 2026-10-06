import { attoSharesToCollateralAttoEth, formatCollateralEth, formatOutcomeWithValue, type ShareValueRate } from '../lib/shareValue.js'
import type { ForkTarget } from '../protocol/forks.js'
import { settlementUnavailability, type LiveBalances, type LiveMarket, type SettlementOperation, type SettlementUnavailableReason, type ShareOutcome } from '../protocol/live.js'
import * as settlementCopy from '../copy/settlement.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

type SettlementLifecycle = Pick<LiveMarket, 'loadError' | 'systemState' | 'universeForkTime' | 'questionOutcome'>

const settlementUnavailableCopy = {
	'market-data-unavailable': settlementCopy.marketDataUnavailableReason,
	'universe-not-forked': settlementCopy.universeNotForkedReason,
	'no-shares-to-migrate': settlementCopy.noSharesToMigrateReason,
	'universe-forked': settlementCopy.universeForkedReason,
	'pool-not-operational': settlementCopy.poolNotOperationalReason,
	'no-complete-sets': settlementCopy.noCompleteSetsReason,
	'question-not-resolved': settlementCopy.questionNotResolvedReason,
	'question-resolved': settlementCopy.questionResolvedReason,
} satisfies Record<Exclude<SettlementUnavailableReason['code'], 'no-winning-shares'>, string>

function settlementUnavailableReasonCopy(reason: SettlementUnavailableReason) {
	return reason.code === 'no-winning-shares' ? settlementCopy.noWinningSharesReason(reason.outcome) : settlementUnavailableCopy[reason.code]
}

/** Why the selected settlement action cannot run for this market and wallet, or undefined when it can. */
export function settlementUnavailableReason(operation: SettlementOperation, market: SettlementLifecycle, balances: Pick<LiveBalances, 'invalid' | 'yes' | 'no'> | undefined) {
	const reason = settlementUnavailability(operation, market, balances)
	return reason === undefined ? undefined : settlementUnavailableReasonCopy(reason)
}

export function settlementInputBlocker(operation: SettlementOperation, unavailableReason: string | undefined, completeSetsAttoShares: bigint, parsedAmountAttoShares: bigint | undefined, targetOutcomeIndexes: readonly bigint[], sourceOutcome: ShareOutcome, sourceBalance: bigint | undefined, rate: ShareValueRate) {
	if (unavailableReason !== undefined) return unavailableReason
	if (operation === 'redeem-complete-set') {
		if (parsedAmountAttoShares === undefined || parsedAmountAttoShares === 0n) return settlementCopy.completeSetAmountRequired
		if (parsedAmountAttoShares > completeSetsAttoShares) return settlementCopy.formatCompleteSetLimit(formatCollateralEth(completeSetsAttoShares, rate, 'down'))
		if (attoSharesToCollateralAttoEth(parsedAmountAttoShares, rate) === 0n) return settlementCopy.completeSetAmountTooSmall
	}
	if (operation === 'migrate-shares') {
		if (targetOutcomeIndexes.length === 0) return settlementCopy.childUniverseRequired
		if (sourceBalance === undefined || sourceBalance === 0n) return settlementCopy.formatZeroShareBalance(sourceOutcome)
	}
	return undefined
}

export function forkMigrationBatchBlocker(targets: readonly ForkTarget[]) {
	if (targets.length <= 1 || targets.every(target => target.canonicalPool !== undefined)) return undefined
	return settlementCopy.missingChildPoolBlocker
}

export function forkMigrationBatchWarning(targets: readonly ForkTarget[]) {
	if (forkMigrationBatchBlocker(targets) === undefined) return undefined
	return settlementCopy.missingChildPoolWarning
}

/** The wallet's balance once it has been read; undefined while it is loading, failed, or the wallet is disconnected, so prose never quotes a state in place of an amount. */
export function settlementBalanceLabel(balanceState: BalanceState, balance: bigint | undefined, rate: ShareValueRate & Partial<SettlementLifecycle>, outcome?: ShareOutcome) {
	if (balanceState !== 'ready' || balance === undefined) return undefined
	return outcome === undefined ? formatCollateralEth(balance, rate, 'down') : formatOutcomeWithValue(balance, outcome, rate)
}

/** The standalone balance line: the amount when it is known, otherwise what the user is waiting for or has to do. */
export function settlementBalanceStatus(balanceState: BalanceState, balance: bigint | undefined, rate: ShareValueRate, outcome?: ShareOutcome) {
	if (balanceState === 'loading') return settlementCopy.formatShareBalance(commonCopy.loadingWithEllipsis)
	if (balanceState === 'error') return settlementCopy.formatShareBalance(commonCopy.unavailable)
	const label = settlementBalanceLabel(balanceState, balance, rate, outcome)
	return label === undefined ? settlementCopy.connectToSeeBalance : settlementCopy.formatShareBalance(label)
}
