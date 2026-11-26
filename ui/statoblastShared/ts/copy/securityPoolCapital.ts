import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { minimumSecurityPoolHealthFactorBps } from '@zoltar/statoblast-shared/statoblast/securityPool'

export const withdrawableRep = 'Withdrawable REP'
export const principalRep = 'Your REP deposited'
export const commitment = 'Your commitment'
export const positionCommitment = 'Position commitment'
export const savedHealth = 'Health target'
export const availableCapacity = 'Free capacity'
export const priceValid = 'Price current'
export const priceStale = 'New REP price required'
export const earnings = 'Your earnings'
export const earningsHint = 'Claiming checkpoints newly earned fees. Prepaid rewards vest over the security pool’s configured duration.'
export const ethEarnings = 'Accrued collateral earnings'
export const repEarnings = 'Accrued REP earnings'
export const claim = 'Claim earnings'
export const claiming = 'Claiming earnings…'
export const deposit = 'Deposit REP'
export const idleDepositHint = 'Deposited REP backs nothing and earns nothing until you set a commitment.'
export const depositing = 'Depositing REP…'
export const approving = 'Approving REP…'
export const repAmount = 'REP amount'
export const withdraw = 'Withdraw REP'
export const withdrawing = 'Withdrawing REP…'
export const withdrawHint = 'Withdraw surplus while keeping your health target. A current REP price is required for active commitments.'
export const authorize = 'Authorize commitment'
export const authorizing = 'Authorizing commitment…'
export const health = 'Your health target (%)'
export const healthHint = `${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}% includes the required backing. A higher target keeps more REP per collateral token. Raising it needs enough REP now; it does not change the liquidation threshold.`
export const saveHealth = 'Save health target'
export const savingHealth = 'Saving target…'
export const depositHealth = 'Deposit REP and save target'
export const depositingHealth = 'Depositing and saving target…'
export const optionalHealthDeposit = 'Also add REP (optional)'
export const olderPriceReport = 'Use an older funded price report'
export const setCommitment = 'Set commitment'
export const currentCommitmentPreset = 'Current'
export const howTargetWorks = 'How the target works'
export const queuedCommitmentLock = 'This commitment is locked until its reduction clears.'
export const repToReachTarget = (amount: string) => `Add ${amount} to meet this target at your current commitment.`
export const depositBeforeCommitment = 'Deposit the extra REP before setting your commitment.'
export const healthDepositReview = 'Your commitment stays the same. Raising the target for an active position requires enough REP, or both changes revert.'
export const actionPending = 'Another security pool action is pending.'
export const targetUnavailable = 'A valid target and current REP price are required.'
export const retirementRequested = 'A commitment reduction is already in queue.'
export const minimumCommitment = 'Minimum commitment (collateral)'
export const minimumCommitmentHint = 'The minimum collateral commitment; fork auction lots may be larger.'
export const noPositions = 'No pledged commitments'
export const noPositionsHint = 'Deposit REP, then authorize your first commitment.'
export const liquidationHint = (duration?: string) => `The liquidation penalty grows${duration === undefined ? '' : ` for ${duration}`} after liquidation starts. The new backer can receive up to all of your pledged REP. Add REP or reduce commitment to stay above the liquidation threshold.`
export const formatRewardVesting = (duration: string) => `More earnings vest over ${duration}.`
export const retire = 'Reduce commitment'
export const retiring = 'Reducing commitment…'
export const remainingCommitment = 'Commitment to keep (collateral)'
export const serving = 'Releasing commitment…'
export const retirementPreviewUnavailable = 'Preview unavailable'
export const retirementPreviewStale = 'A new accepted REP price is required to assess readiness'
export const retirementPreviewClosed = 'Universe closed to commitment reductions'
export const retirementPreviewStatus = {
	'not-retiring': 'No pending reduction',
	'imports-open': 'Branch preparation in progress',
	'demand-exceeds-healthy': 'Capacity in use exceeds available backing',
	'earlier-requests': 'Capacity reserved for earlier reductions',
	'insufficient-spare': 'Waiting for free capacity',
	ready: 'Enough free capacity now',
}
export const reductionWaits = 'The reduction waits for free capacity in queue order.'
export const reductionWithCure = (covered: string, keepsCoveredCommitment: boolean) => {
	const coverage = `Your REP covers only ${covered} at the current price.`
	if (keepsCoveredCommitment) return `${coverage} The reduction can happen at once if there is enough free capacity. Any remainder goes in queue.`
	return `${coverage} The uncovered part can be removed at once if there is enough free capacity. The rest waits in queue.`
}
export const requestReductionReview = (positionId: bigint, releasesPledgedRep: boolean, queue: string) => {
	const consequence = releasesPledgedRep ? 'Reducing to zero releases its pledged REP.' : 'REP stays pledged to the remaining commitment.'
	return `Position ${positionId}. ${consequence} ${queue} You can’t change or cancel the queued reduction. Your saved health target stays unchanged.`
}
export const releaseReductionReview = (owner: string) => `Release the commitment reduction for ${owner}. Earlier reductions keep their place in queue. Free capacity can change before confirmation. An attempt may spend gas without reducing commitment.`
export const rewardVesting = 'Reward vesting (hours)'
export const outcomeRate = 'Minimum collateral reserved per share'
export const outcomeRateHint = 'Holding fees stop before reducing backing below this rate. Fixed at creation; fork recovery can pay less.'

export const prepareTitle = 'Complete security pool setup'
export const prepareHint = 'Each stage is one transaction with bounded deployment work. Until the origin universe forks, anyone can resume setup before deposits and purchases open.'
export const prepareStages = ['Set up claims & redemption', 'Set up reporting & forks', 'Set up capital', 'Activate security pool']
export const prepareProgress = (stage: number) => `${stage} of 4 setup stages complete`
export const preparing = 'Preparing contracts…'

export const annualFee = 'Annual holding fee (%)'
export const annualFeeHint = 'Fixed for this security pool. Accrues over time against question backing while the price is fresh and settlement is fully funded.'

export const reportId = 'Funded report ID (optional)'
export const reportHint = 'Use a finalized, funded report if the current report cannot back your larger commitment. Its REP price sets your collateral floor until the next fully funded report.'
export const reportUnavailable = 'This report cannot secure this commitment.'
export const reportInvalid = 'Enter a positive report ID, or leave blank to use the current security pool report.'
export const reportChecking = 'Checking report funding and freshness.'
export const reportChanged = 'Report terms changed. Review the commitment again.'

export { readUnavailable } from './securityPool.js'
export const auctionVaultOwnership = 'This auction position has separate collateral. Your wallet controls it and receives withdrawals.'

export const depositLiquidating = 'This position is liquidating. REP top-ups are unavailable.'

export const resubmitRetirement = 'Retry reduction'
export const preview = 'Preview'
export const adjustApproval = 'Adjust approval amount'
export const previewBacking = 'REP needed for target'
export const previewMaximum = 'Max commitment'
export const previewBefore = 'Current'
export const previewAfter = 'After changes'
export const queueHint = "Reductions release in full, in queue order. A queued reduction can't be changed."
export const queueCommitment = 'Your commitment'
export const queueAhead = 'Ahead of you'
export const queueYourReduction = 'Your reduction'
export const requestReduction = 'Queue reduction'
export const readyToRelease = 'Ready to release'
export const queueFreeNow = (amount: string, total: string | undefined) => (total === undefined ? `${amount} free now` : `${amount} free now, covers all ${total}`)
export const releaseKeeping = (amount: string) => `Release reduction (keep ${amount})`
export const walletBalanceHint = (amount: string) => `${amount} in your wallet`
export const maximumWithdrawalHint = (amount: string) => `${amount} available to withdraw`
export const takeoverThresholdNotice = (threshold: string, duration: string) => `Below ${threshold}% health, anyone can take over your commitment. The takeover reward can reach all your pledged REP within ${duration}.`

export const releaseReduction = 'Release reduction'
export const completedReductionCommitment = 'Commitment when reduction completes'
export const waitingForFreeCapacity = 'Waiting for free capacity'
export const retryRelease = 'Retry release'

export const healthChangesClosed = 'This universe is closed to health changes.'
export const healthTargetMinimum = `Choose a health target of at least ${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}%.`
export const healthTargetTooLarge = 'This health target is too large.'
export const healthNeedsCurrentPrice = 'A new accepted REP price is required before raising your target.'
export const healthNeedsMoreRep = 'Add REP or complete a commitment reduction before raising your target.'
export const positionInactive = 'Position is no longer live.'
export const remainingCommitmentRequired = 'Enter the commitment to keep, or zero to release it all.'
export const smallerRemainingCommitmentRequired = 'Choose a smaller remaining commitment.'
export const reductionBelowMinimum = 'The remaining commitment and reduction must each meet the security pool minimum.'
export const positiveCommitmentRequired = 'Enter a positive commitment amount.'
export const commitmentBelowMinimum = 'Commitment is below this security pool’s minimum.'
export const useReduceCommitment = 'Use Reduce commitment to lower an existing commitment.'
export const commitmentBelowHealthTarget = 'Collateral is below your saved health target.'
export const forkPreventsWithdrawal = 'Pledged REP cannot be withdrawn during fork preparation.'
export const withdrawalNeedsCurrentPrice = 'A new accepted REP price is required before withdrawing pledged REP.'
export const amountAboveWithdrawable = 'Amount exceeds withdrawable REP. Reduce commitment to release more pledged REP.'
