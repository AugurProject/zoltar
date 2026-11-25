export const title = 'Your position'
export const description = 'Deposit REP, choose your health target, and authorize shared backing. Your position bears its own liquidation losses.'
export const poolTitle = 'Shared backing'
export const poolDescription = 'Eligible questions share the same backing. Redeeming complete sets frees capacity for commitment reductions.'
export const withdrawableRep = 'Withdrawable REP'
export const principalRep = 'Your REP deposited'
export const commitment = 'Your commitment'
export const savedHealth = 'Health target'
export const demand = 'Capacity in use'
export const healthyCommitment = 'Healthy commitments'
export const totalPledged = 'Security pool pledged REP'
export const availableCapacity = 'Free capacity'
export const priceValid = 'Price current'
export const priceStale = 'New REP price required'
export const priceExpiry = 'Price valid until'
export const snapshotTime = 'Balances observed at'
export const noPrice = 'No accepted price'
export const forked = 'Universe forked'
export const importing = 'Branch preparation in progress'
export const earnings = 'Your earnings'
export const earningsHint = 'Claiming checkpoints newly earned fees. Prepaid rewards vest over the security pool’s configured duration.'
export const ethEarnings = 'Accrued collateral earnings'
export const repEarnings = 'Accrued REP earnings'
export const claim = 'Claim earnings'
export const claiming = 'Claiming earnings…'
export const deposit = 'Deposit REP'
export const depositHint = 'Every deposit backs your existing commitment. With no commitment, your REP stays idle until you authorize capacity.'
export const idleDepositHint = 'Deposited REP backs nothing and earns nothing until you set a commitment.'
export const depositing = 'Depositing REP…'
export const approving = 'Approving REP…'
export const repAmount = 'REP amount'
export const withdraw = 'Withdraw REP'
export const withdrawing = 'Withdrawing REP…'
export const withdrawHint = 'Withdraw surplus while keeping your health target. A current REP price is required for active commitments.'
export const authorize = 'Authorize commitment'
export const authorizing = 'Authorizing commitment…'
export const authorizationHint = 'Your REP and chosen target size the commitment below. You can choose less capacity. Complete the pending commitment reduction before increasing it.'
export const health = 'Your health target (%)'
export const healthHint = '100% includes the protocol backing requirement. A higher target keeps more REP per collateral token. Raising it needs enough REP now; it does not change the liquidation threshold.'
export const saveHealth = 'Save health target'
export const savingHealth = 'Saving target…'
export const depositHealth = 'Deposit REP and save target'
export const depositingHealth = 'Depositing and saving target…'
export const healthDepositDetails = 'Add REP while saving the target'
export const healthDepositAmount = 'REP to add'
export const optionalHealthDeposit = 'Also add REP (optional)'
export const olderPriceReport = 'Use an older funded price report'
export const setCommitment = 'Set commitment'
export const currentCommitmentPreset = 'Current'
export const howTargetWorks = 'How the target works'
export const queuedCommitmentLock = 'This commitment is locked until its reduction clears.'
export const repToReachTarget = (amount: string) => `Add ${amount} to meet this target at your current commitment.`
export const depositBeforeCommitment = 'Deposit the extra REP before setting your commitment.'
export const healthDepositHint = 'One transaction adds REP and saves the target. Your commitment does not increase.'
export const healthDepositReview = 'Your commitment stays the same. Raising the target for an active position requires enough REP, or both changes revert.'
export const targetCapacity = 'Capacity at chosen target'
export const targetShortfall = 'Additional REP for current commitment'
export const useTargetCapacity = 'Use target capacity'
export const actionPending = 'Another security pool action is pending.'
export const targetUnavailable = 'A valid target and current REP price are required.'
export const retirementRequested = 'A commitment reduction is already in queue.'
export const currentTargetSatisfied = 'The current commitment already fits this target.'
export const activeCommitment = 'Active position commitment (collateral)'
export const requiredCollateral = 'Required REP at saved target'
export const minimumCommitment = 'Minimum commitment (collateral)'
export const minimumCommitmentHint = 'The minimum collateral commitment; fork auction lots may be larger.'
export const positions = 'Your commitment position'
export const positionsHint = 'Reductions release in queue order when enough capacity is free.'
export const noPositions = 'No pledged commitments'
export const noPositionsHint = 'Deposit REP, then authorize your first commitment.'
export const phase = { active: 'Active', current: 'Reduction queued', next: 'Reduction queued' }
export const position = (id: bigint) => `Position ${id}`
export const positionPledged = 'Pledged REP'
export const positionCommitment = 'Commitment (collateral)'
export const currentHealth = 'Current health'
export const unhealthy = 'Below the backing requirement. Add REP or reduce your commitment.'
export const belowTarget = 'Below your health target. Add REP or reduce your commitment.'
export const liquidationHealth = 'Liquidation threshold'
export const liquidationHealthy = 'Meets liquidation threshold'
export const liquidationUnhealthy = 'Below liquidation'
export const liquidationHint = (duration?: string) => `The liquidation penalty grows${duration === undefined ? '' : ` for ${duration}`} after liquidation starts. The new backer can receive up to all of your pledged REP. Add REP or reduce commitment to stay above the liquidation threshold.`
export const formatRewardVesting = (duration: string) => `More earnings vest over ${duration}.`
export const liquidationSince = 'Below liquidation since'
export const noLiquidationInterval = 'No observed adverse interval'
export const liquidationTimingHint = 'This marks the accepted adverse price observation, not a guaranteed grace period.'
export const healthUnknown = 'Price unavailable'
export const retire = 'Reduce commitment'
export const retiring = 'Reducing commitment…'
export const remainingCommitment = 'Commitment to keep (collateral)'
export const remainingCommitmentHint = 'Zero releases the full commitment. A partial reduction keeps your REP pledged to the remaining commitment.'
export const queuedRemainingCommitment = 'Queued commitment to keep'
export const retireToTarget = 'Size reduction for chosen target'
export const retirementTargetHint = 'This amount stays fixed while queued. If raising your health target, save it separately after the reduction completes.'
export const serve = 'Release available commitment'
export const serving = 'Releasing commitment…'
export const retirementPreviewTitle = 'Commitment reduction preview'
export const retirementPreviewUnavailable = 'Preview unavailable'
export const retirementPreviewStale = 'A new accepted REP price is required to assess readiness'
export const retirementPreviewClosed = 'Universe closed to commitment reductions'
export const retirementPreviewHint = 'Free capacity can change before confirmation. An attempt may spend gas without reducing commitment.'
export const retirementPreviewStatus = {
	'not-retiring': 'No pending reduction',
	'imports-open': 'Branch preparation in progress',
	'demand-exceeds-healthy': 'Capacity in use exceeds available backing',
	'earlier-requests': 'Capacity reserved for earlier reductions',
	'insufficient-spare': 'Waiting for free capacity',
	ready: 'Enough free capacity now',
}
export const reductionFreeCapacity = 'Free capacity for reductions'
export const retirementAhead = 'Reserved for earlier reductions'
export const retirementReduction = 'Your reduction'
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
export const releaseReductionReview = `Earlier reductions keep their place in queue. ${retirementPreviewHint}`
export const rewardVesting = 'Reward vesting (hours)'
export const outcomeRate = 'Minimum collateral reserved per share'
export const outcomeRateHint = 'Holding fees stop before reducing backing below this rate. Fixed at creation; fork recovery can pay less.'

export const prepareTitle = 'Complete security pool setup'
export const prepareHint = 'Each stage is one transaction with bounded deployment work. Until the origin universe forks, anyone can resume setup before deposits and purchases open.'
export const prepareStages = ['Set up claims & redemption', 'Set up reporting & forks', 'Set up capital', 'Activate security pool']
export const prepareProgress = (stage: number) => `${stage} of 4 setup stages complete`
export const prepareProgressUnknown = 'Loading security pool setup progress…'
export const preparing = 'Preparing modules…'

export const annualFee = 'Annual holding fee (%)'
export const annualFeeHint = 'Fixed for this security pool. Accrues over time against question backing while the price is fresh and settlement is fully funded.'

export const reportId = 'Funded report ID (optional)'
export const reportHint = 'Use a finalized, funded report if the current report cannot back your larger commitment. Its REP price sets your collateral floor until the next fully funded report.'
export const reportUnavailable = 'This report cannot secure the requested commitment.'
export const reportInvalid = 'Enter a positive report ID, or leave blank to use the current security pool report.'
export const reportChecking = 'Checking report funding and freshness.'
export const reportChanged = 'Report terms changed. Review the commitment again.'

export { readUnavailable } from './securityPool.js'
export const lastConfirmed = 'Last confirmed balances. Position refresh pending.'
export const auctionVaultOwnership = 'This auction position has separate collateral. Your wallet controls it and receives withdrawals.'

export const depositLiquidating = 'This position is liquidating. REP top-ups are unavailable.'

export const resubmitRetirement = 'Retry reduction'
export const resubmittingRetirement = 'Retrying reduction…'
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
