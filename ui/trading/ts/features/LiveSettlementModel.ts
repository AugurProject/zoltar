import { formatOutcomeAmount, formatShareAmount, formatUnits } from '../lib/format.js'
import type { ForkTarget } from '../protocol/forks.js'
import type { SettlementOperation, ShareOutcome } from '../protocol/live.js'
import type { BalanceState } from './live/liveTradingTypes.js'

export function insuredExitLimitMessage(requested: bigint, maximum: bigint, invalidBalance: bigint) {
	if (maximum === invalidBalance && requested > invalidBalance) return `Your INVALID balance covers only ${formatUnits(invalidBalance)} complete sets. Excess YES/NO profit must remain as shares unless you acquire more INVALID.`
	return `Your current long-share balance and pair liquidity support an insured exit of at most ${formatUnits(maximum)} complete sets. Reduce the exit amount; excess directional shares remain in your wallet.`
}

export function migrationSimulationSummary(blockNumber: bigint, sourceOutcome: ShareOutcome, targetCount: bigint) {
	return `Fork migration simulation ready at block ${blockNumber.toString()}: the entire selected ${sourceOutcome} balance will be copied into ${targetCount.toString()} selected child ${targetCount === 1n ? 'branch' : 'branches'} and locked in the parent universe.`
}

export function settlementInputBlocker(operation: SettlementOperation, operationAvailable: boolean, completeSets: bigint, parsedAmount: bigint | undefined, targetOutcomeIndexes: readonly bigint[], sourceOutcome: ShareOutcome, sourceBalance: bigint | undefined) {
	if (!operationAvailable) return 'The selected settlement action is unavailable for the current lifecycle state or wallet balances'
	if (operation === 'redeem-complete-set') {
		if (parsedAmount === undefined || parsedAmount === 0n) return 'Enter a valid positive complete-set share amount'
		if (parsedAmount > completeSets) return `Enter no more than the available complete-set balance of ${formatShareAmount(completeSets)}`
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

export function settlementBalanceLabel(balanceState: BalanceState, balance: bigint | undefined, outcome?: ShareOutcome) {
	if (balanceState === 'loading') return 'Loading…'
	if (balanceState === 'error') return 'Unavailable'
	if (balanceState !== 'ready' || balance === undefined) return 'Not loaded'
	return outcome === undefined ? formatShareAmount(balance) : formatOutcomeAmount(balance, outcome)
}
