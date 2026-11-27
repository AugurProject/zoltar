export const title = 'Fork choices and recovery'
export const description = 'Choose one branch for your committed REP. Branch preparation is shared by every owner.'
export const universe = 'Source universe'
export const outcome = 'Fork outcome index'
export const outcomeHint = 'The question label below must match the branch you intend to support.'
export const choiceDeadline = 'Choice deadline'
export const activationDeadline = 'Earliest activation'
export const choice = 'Commit branch choice'
export const choosing = 'Committing choice…'
export const choiceHint =
	'The native choice window lasts eight weeks. This choice is irreversible. All committed principal and commitment follow this branch. Idle REP and previously earned fees stay in the source. Missing the deadline forfeits your committed REP to outcome claimants in every branch; it does not choose a default branch.'
export const prepareBranch = 'Prepare branch capital'
export const preparingBranch = 'Preparing branch capital…'
export const start = 'Start branch migration'
export const starting = 'Starting branch migration…'
export const finalize = 'Activate branch'
export const finalizing = 'Activating branch…'
export const child = 'Child universe'
export const state = 'Branch state'
export const open = 'Open child account'
export const loading = 'Loading fork state'
export const noFork = 'This source universe has not forked.'
export const unchosen = 'No branch chosen'
export const chosen = (outcome: bigint) => `Chosen outcome: ${outcome}`
export const basketTitle = 'Claim recovery'
export const basketHint = 'After activation, returning complete sets or redeeming winning shares pays their share of this branch’s collateral and unchosen REP. The assets below cover all questions together; full repayment in collateral is not guaranteed.'
export const cashRecovery = 'Inherited settlement collateral'
export const repRecovery = 'Unchosen REP before auction sales'
export const recovery = 'Trader source cash recovery'
export const recoveryHint = 'Recover unassigned source cash with one recovery right per outcome. These rights remain separate from your child shares. Vault owners do not claim each question.'
export const question = 'Question ID'
export const shares = 'Complete sets to recover'
export const available = 'Available recovery sets'
export const invalidAvailable = 'Available Invalid rights'
export const yesAvailable = 'Available Yes rights'
export const noAvailable = 'Available No rights'
export const transferHint = 'Send outcome rights to combine a recovery set with another holder. Sending source-backed rights locks those original source shares; child migration rights stay yours.'
export const recipient = 'Recipient address'
export const invalidTransfer = 'Invalid rights to send'
export const yesTransfer = 'Yes rights to send'
export const noTransfer = 'No rights to send'
export const transfer = 'Transfer recovery rights'
export const transferring = 'Transferring recovery rights…'
export const prepare = 'Prepare source question'
export const preparing = 'Preparing source question…'
export const recover = 'Recover source cash'
export const recovering = 'Recovering source cash…'

/** Separates the fork question's title from the branch outcome label; each side is rendered as isolated on-chain text. */
export const questionOutcomeSeparator = ' — '
export const forkQuestionId = 'Fork question ID'
export const busy = 'Another security pool action is pending.'
export const branchStates = { choose: 'Choose an outcome', unprepared: 'Not prepared', chosen: 'Capital prepared', waiting: 'Awaiting activation', active: 'Active' }
export const claimBidsFirst = 'Claim your repair auction bids before choosing a branch.'
export const unclaimedBids = (count: bigint) =>
	count === 1n
		? 'You have 1 unclaimed repair auction bid in this universe. Every bid must be claimed, including bids that won nothing, before you can choose a branch.'
		: `You have ${count} unclaimed repair auction bids in this universe. Every bid must be claimed, including bids that won nothing, before you can choose a branch.`
export const claimBids = 'Claim all bids'
export const claimingBids = 'Claiming bids…'
export const noBidsToClaim = 'No repair auction bids to claim.'
export const claimAfterClose = 'Your bids can be claimed after the auction closes.'
export const claimBidsReview = (batch: number, total: number) => {
	if (batch < total) return `Claim ${batch} of your ${total} unclaimed repair auction bids in this universe in this transaction; claim again for the rest. Winning lots join your capital account here.`
	const scope = batch === 1 ? 'your 1 unclaimed repair auction bid in this universe in one transaction' : `all ${batch} of your unclaimed repair auction bids in this universe in one transaction`
	return `Claim ${scope}. Winning lots join your capital account here.`
}
export const claimLoadError = 'Unable to load your repair auction bids in this universe.'
