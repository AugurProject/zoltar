export { eth, invalid, no, yes } from './outcomes.js'
import { outcomeLabel } from './outcomes.js'
import { recheckedBeforeWallet } from './workflows.js'
export const operationLabel = 'Settlement operation'
export const completeSetAction = 'Redeem sets'
export const forkMigrationAction = 'Migrate'
export const completeSetRedemptionGuidance = 'Burn equal amounts of your Yes, No, and Invalid shares for ETH at the security pool’s current collateral rate.'
export { max } from '@zoltar/ui-core-shared/copy/common.js'
/** The field takes ETH; the hint below it converts that to complete sets. */
export const completeSetValueToRedeem = 'ETH to redeem'
export const winningRedemptionUnavailable = 'Winning-outcome redemption becomes available after the question resolves.'
export const migrationGuidance = 'Pick one share type (Yes, No, or Invalid) and the child universes to migrate it into. Migrating moves your whole balance of that share and permanently locks its transfers in this universe. You can migrate the same share into more child universes later.'
export const marketDataUnavailableReason = 'Market data is unavailable. Refresh the market.'
export const universeNotForkedReason = 'The universe has not forked, so there is nothing to migrate.'
export const noSharesToMigrateReason = 'You hold no Yes, No, or Invalid shares to migrate.'
export const universeForkedReason = 'The universe forked. Migrate your shares to a child universe instead.'
export const poolNotOperationalReason = 'The security pool is not operational, so it cannot pay out ETH.'
export const noCompleteSetsReason = 'You hold no complete sets. Redeeming needs equal Yes, No, and Invalid shares.'
export const questionNotResolvedReason = 'The question has not resolved yet.'
export const acknowledgeMigrationReason = 'Confirm that you understand the migration.'
export const shareToMigrate = 'Share to migrate'
export const connectToSeeBalance = 'Connect a wallet to see your balance.'
export const loadingForkDetails = 'Loading fork question and child universes…'
export const forkDetailsUnavailable = 'Fork question details are unavailable.'
export const retryForkDetails = 'Retry fork details'
export const completeSetAmountTooSmall = 'Amount too small to redeem any ETH.'
export const childUniverseRequired = 'Select at least one child universe.'
export const missingChildPoolBlocker = 'This selection includes a child universe without a security pool. Migrate into each such child universe separately.'
export const missingChildPoolWarning = 'For this share, migrate into each child universe that has no security pool in a separate transaction. Another share can migrate into those child universes together once their security pools are ready.'

export function redeemOutcomeAction(outcome: 'INVALID' | 'YES' | 'NO') {
	return `Redeem ${outcomeLabel(outcome)}`
}

export function noWinningSharesReason(outcome: 'INVALID' | 'YES' | 'NO') {
	return `You hold no ${outcomeLabel(outcome)} shares to redeem.`
}

export function completeSetsHeld(completeSets: string, value: string) {
	return `You hold ${completeSets}, worth ${value}`
}

/** `available` is the ETH the held complete sets redeem for; `completeSets` is how many sets that is. */
export function formatCompleteSetLimit(available: string, completeSets: string) {
	return `Enter no more than ${available} (your ${completeSets}).`
}

export function formatZeroShareBalance(outcome: 'INVALID' | 'YES' | 'NO') {
	return `Your ${outcomeLabel(outcome)} balance is zero.`
}

export function formatShareBalance(balance: string) {
	return `Balance: ${balance}`
}

/** A migrated source balance stays in the wallet but can no longer be transferred in this universe. */
export function formatLockedShareBalance(balance: string) {
	return `Balance: ${balance} · locked after migration`
}

/** The selection includes a child universe that already holds this share's whole balance. */
export function targetAlreadyMigrated(outcome: 'INVALID' | 'YES' | 'NO', childUniverse: string) {
	return `Your ${outcomeLabel(outcome)} balance is already migrated to ${childUniverse}. Deselect it.`
}

export function migrationAmount(balance: string) {
	return `Migrates your entire balance: ${balance}`
}

export function acknowledgeMigration(balance: string, outcome: 'INVALID' | 'YES' | 'NO') {
	return `I understand this moves all ${balance} into the selected child universes and permanently locks my ${outcomeLabel(outcome)} transfers in the parent universe.`
}

/** `balance` is omitted until the wallet's balance is known, so the sentence never quotes a loading or missing state. */
export function formatWinningRedemptionGuidance(outcome: 'INVALID' | 'YES' | 'NO', balance: string | undefined) {
	return balance === undefined ? `Redeem your entire ${outcomeLabel(outcome)} balance through this security pool.` : `Redeem your entire ${outcomeLabel(outcome)} balance (${balance}) through this security pool.`
}
export const settlementTransaction = 'Settlement transaction'
export const transactionFailed = 'Settlement transaction failed.'
export const estimateHeading = 'Redemption estimate'
export { invalidEthAmount, minimumReceived, youReceiveEstimate as youReceive } from './tradeTicket.js'
export const redeemCompleteSetsAction = 'Redeem complete sets'

export function migrationAction(count: number) {
	return count === 0 ? 'Migrate shares' : `Migrate to ${count.toString()} child ${count === 1 ? 'universe' : 'universes'}`
}

export const zeroRedemptionReason = 'Complete-set redemption would return zero ETH.'

export const estimateNote = `Estimate from the current collateral rate. ${recheckedBeforeWallet}`
