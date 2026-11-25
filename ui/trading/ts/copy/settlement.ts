export { invalid, no, yes } from './outcomes.js'
import { outcomeLabel } from './outcomes.js'
import { recheckedBeforeWallet } from './workflows.js'
export const operationLabel = 'Settlement operation'
export const completeSetAction = 'Redeem sets'
export const forkMigrationAction = 'Migrate'
export const completeSetRedemptionGuidance = 'Burn equal amounts of your Yes, No, and Invalid shares for their share of the question’s collateral.'
export { max } from '@zoltar/ui-core-shared/copy/common.js'
/** The field takes ETH; the hint below it converts that to complete sets. */
export const formatCollateralToRedeem = (symbol: string) => `${symbol} to redeem`
export const winningRedemptionUnavailable = 'Winning-outcome redemption becomes available after the question resolves.'
export const migrationGuidance = 'Moves your whole balance of one share into the child universes you pick and permanently locks its transfers here. You can add child universes later.'
export const marketDataUnavailableReason = 'Market data is unavailable. Refresh the market.'
export const universeNotForkedReason = 'The universe has not forked, so there is nothing to migrate.'
export const noSharesToMigrateReason = 'You hold no Yes, No, or Invalid shares to migrate.'
export const universeForkedReason = 'The universe forked; migrate your shares instead.'
export const poolNotOperationalReason = 'The question is not operational, so its shares cannot be redeemed.'
export const noCompleteSetsReason = 'You hold no complete sets. Redeeming needs equal Yes, No, and Invalid shares.'
export const questionNotResolvedReason = 'The question has not resolved yet.'
export const questionResolvedReason = 'The question resolved. Redeem your winning shares instead.'
export const acknowledgeMigrationReason = 'Confirm that you understand the migration.'
export const shareToMigrate = 'Share to migrate'
export const connectToSeeBalance = 'Connect a wallet to see your balance.'
export const loadingForkDetails = 'Loading fork question and child universes…'
export const forkDetailsUnavailable = 'Fork question details are unavailable.'
export const retryForkDetails = 'Retry fork details'
export const completeSetAmountTooSmall = 'Amount too small to redeem any collateral.'
export const childUniverseRequired = 'Select at least one child universe.'
export const missingChildPoolBlocker = 'This selection includes a child universe where this question is not registered yet. Migrate into each such child universe separately.'
export const inactiveBranchBlocker = 'Activate this branch in Statoblast under Fork choices and recovery before migrating.'
export const missingChildPoolWarning = 'For this share, migrate into each child universe where this question is not registered yet in a separate transaction. Another share can migrate into those child universes together once their question ledgers are ready.'

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

export function formatSetQuantityLimit(completeSets: string) {
	return `Enter no more than ${completeSets}.`
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

export function migrationAmount(balance: string) {
	return `Migrates your entire balance: ${balance}`
}

export function acknowledgeMigration(balance: string, outcome: 'INVALID' | 'YES' | 'NO') {
	return `I understand this mints ${balance} in each selected child universe and keeps the original shares in the parent universe, permanently locking my ${outcomeLabel(outcome)} transfers in the parent universe.`
}

/** `balance` is omitted until the wallet's balance is known, so the sentence never quotes a loading or missing state. */
export function formatWinningRedemptionGuidance(outcome: 'INVALID' | 'YES' | 'NO', balance: string | undefined) {
	return balance === undefined ? `Redeem your entire ${outcomeLabel(outcome)} balance for this question.` : `Redeem your entire ${outcomeLabel(outcome)} balance (${balance}) for this question.`
}
export const settlementTransaction = 'Settlement transaction'
export const transactionFailed = 'Settlement transaction failed.'
export const estimateHeading = 'Redemption estimate'
export { minimumReceived, recoveryRep, youReceiveEstimate as youReceive } from './tradeTicket.js'
export const redeemCompleteSetsAction = 'Redeem complete sets'

export function migrationAction(count: number) {
	return count === 0 ? 'Migrate shares' : `Migrate to ${count.toString()} child ${count === 1 ? 'universe' : 'universes'}`
}

export const zeroRedemptionReason = 'Complete-set redemption would return no collateral or REP.'
export const completeSetsToRedeem = 'Complete sets to redeem'
export const sets = 'sets'

export const estimateNote = `Estimate from the current collateral rate. ${recheckedBeforeWallet}`

export const minimumRecoveryRep = 'Minimum recovery REP'

export const refreshForkDetails = 'Refresh fork details'
