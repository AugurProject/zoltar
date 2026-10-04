export const timeoutResolutionDetail = 'Escalation ended by timeout. The winner is computed from the current dispute-staked REP totals.'
export const escalationMetrics = 'Escalation metrics'
export const loadingEscalationDeposits = 'Loading escalation deposits…'
export const reportingWorkflow = 'Reporting workflow'
export const reportOutcome = 'Report outcome'
export const reportOutcomeSelectionRequired = 'Select an outcome side before reporting on a question.'
export const reportingActivationHint = 'Select an outcome side above to enable reporting.'
export const settlementSelectionRequired = 'Select at least one deposit or use the claim or clear action for this side.'
export const triggerZoltarFork = 'Trigger universe fork'
export const selectedSideBelowMinimumReason = 'Remaining selected-side capacity is below the minimum report.'
export const continueForkMigrationDetail = 'Your escalation deposits already carry over to each child pool. Once a child question finalizes, claim winning deposits there; the parent deposits do not need to be migrated.'
export const reportAmountFieldLabel = 'Report amount'
export const escalationStarted = 'Escalation started'
export const chooseDepositsToSettle = 'Choose deposits to settle'
export const forkAlreadyTriggeredReportReason = 'Escalation ended without a decision and the universe fork has already been triggered for this pool. Continue in Fork & migration.'
export const forkAlreadyTriggeredSettlementReason = 'Dispute-staked REP remains in escalation, which ended without a decision. The universe fork has already been triggered for this pool, so continue in Fork & migration.'
export const forkTriggerInstruction = 'Escalation ended without a decision, so this question can only resolve through a universe fork. Trigger it unless someone else already has; until then, all escalation deposits stay locked. Triggering is permanent.'
export const forkRequiredSettlementReason = 'Escalation ended without a decision, so deposits stay locked until someone triggers the universe fork. Settle them in Fork & migration afterwards.'
export const leadHoldingCapital = 'Amount needed to hold the lead'
export const loadingPoolHeldVaultRepBacking = 'Loading pool-held vault REP backing…'
export const loadingWalletRepBalance = 'Loading wallet REP balance…'
export const loadingReportingDetails = 'Loading reporting details…'
export const maxProfitPrestartReason = 'Max reward becomes available after the escalation game starts.'
export const maxProfitForkReason = 'Max reward is unavailable because matching the other side would trigger the universe fork.'
export const maxProfitWindowFilledReason = 'Max reward is unavailable because the reward window is already filled on the selected side.'
export const selectedSideLeadsReason = 'Selected side already leads.'
export const loadingEscalation = 'Loading escalation…'
export const refreshReporting = 'Refresh reporting'
export const retryReporting = 'Retry reporting'
export const selectedSideCapacityEmpty = 'The selected side has no remaining capacity.'
export const poolHeldVaultRepBackingEmpty = 'No pool-held vault REP backing is available for reporting.'
export const walletRepBalanceEmpty = 'No wallet REP is available for reporting.'
export const reportOnSelectedSide = 'Report on selected side'
export const currentEscalationDisputeStakeLead = 'Based on the current escalation state, this action would move '
export const acceptedAmountTail = ' from pool-held backing into dispute-staked REP instead of the full entered amount.'
export const acceptedWalletAmountTail = ' from wallet REP into dispute-staked REP instead of the full entered amount.'
export const openForkAndMigration = 'Open fork & migration'
export const managePoolPrice = 'Manage pool price'
export const currentOraclePriceRequired = 'A current pool oracle price is required before reporting.'
export const forkMigrationRequiredDetail = 'Set up the child pools in Fork & migration. Escalation deposits carry over on their own; claim winning deposits in the child pool once its question finalizes.'
export const submittingReportTitle = 'Submitting report'
export const approvingRepTitle = 'Approving REP'
export const settlingEscalationDepositsTitle = 'Settling escalation deposits'
export const reportingNotEnabled = 'Reporting not enabled'
export const reportingOpen = 'Reporting open'
export const resolved = 'Resolved'
export const timedOut = 'Timed out'
export const pendingFinalization = 'Pending finalization'
export const winningPayout = 'Winning payout'
export const losingDepositSettlement = 'Losing deposit settlement'
export const currentClaimType = 'Current claim type:'
export const refreshFinalizedOutcomeReason = 'Escalation has ended. Refresh reporting to view the finalized outcome before settling deposits.'
export const poolFinalizedReason = 'This pool is already finalized.'
export const questionFinalizationRequired = 'Escalation deposits cannot be settled until the question is finalized.'
export const worthAfterFinalizationPendingFinalization = 'Worth after finalization: Pending finalization'
export const presetOutcomeSelectionRequired = 'Select an outcome side before using presets.'
export const selectedSideIsUnavailable = 'Selected side is unavailable.'
export const selectedSide = 'Selected side'
export const formatSettleSelectedDepositsLabel = (sideLabel: string) => `Settle selected ${sideLabel} deposits`
export const formatSettlingDepositsPendingLabel = (sideLabel: string) => `Settling ${sideLabel} deposits…`
export const minimumFirstReport = 'Minimum first report'
export const totalSideDisputeStakedRep = 'All reporters'
export const yourSideDisputeStakedRep = 'You'
export const triggeringZoltarFork = 'Triggering universe fork…'
export const walletUnsettledDepositsEmpty = 'Connected wallet has no unsettled escalation deposits.'
export const forkCarriedSettlementRedirectDetail = 'This pool also has deposits carried from the parent universe. Settle those in Fork & migration.'

export const reportingParameters = 'Reporting parameters'

export const phaseLabels = ['Reporting open', 'Response window', 'Resolved']
export const forkPhase = 'Fork'
export const phaseProgress = (step: number, label: string) => `Step ${step} of ${phaseLabels.length} · ${label}`
export const firstReportNext = (bond: string) => `The first report starts the game. Minimum first report: ${bond} REP.`
export const formatLeaderWinsNext = (end: string, leader: string) => `If no other side overtakes ${leader} by ${end}, ${leader} wins.`
export const resolvedNext = 'Settle your deposits below.'
export const resolvedNoDepositsNext = 'You have no deposits to settle.'
export const startsWithFirstReport = 'After the first report'
export const progressToFork = (secondLargest: string, threshold: string, percent: string) => `Progress to fork: second side at ${secondLargest} / ${threshold} REP (${percent}%)`
export const forkProgressHelp = 'A fork needs two sides at this threshold, so progress follows the second-largest side.'
export const bindingCapitalHelp = 'The second-largest side balance; exceed it to hold the lead.'
const minimumPresetLabels = { fork: 'Fill side & trigger fork', lead: 'Min to lead', start: 'Minimum first report' } as const
/** The minimum preset fills the minimum first report before the game starts, the smallest lead afterwards, or, when no lead is possible, the amount that triggers the fork. */
export const minimumPreset = (kind: keyof typeof minimumPresetLabels, amount?: string) => `${minimumPresetLabels[kind]}${amount === undefined ? '' : ` (${amount} REP)`}`
export const rewardPreset = (amount?: string) => `Max reward${amount === undefined ? '' : ` (${amount} REP)`}`
export const reportAmountPlaceholder = '0'
export const reportAmountLabel = (outcome: string, amount: string) => `Report ${outcome} · ${amount} REP`
export const approveAmountLabel = (amount: string) => `Approve ${amount} REP`
export const paidFromVault = 'Paid from: pool vault REP (no approval needed)'
export const loadingPriceReport = 'Loading price report…'
export const paidFromWallet = 'Paid from: wallet REP'
export const availableBalance = (amount: string) => `Available: ${amount} REP.`
export const continuationFundingHelp = 'Your wallet REP first enters your vault in this pool, then funds your report.'
export const continuationMinimumDeposit = (deposit: string, remainder: string) => `This pool requires a ${deposit} REP deposit for this report. Your vault will hold ${remainder} REP afterward.`
export const yourPositions = 'Your positions'
export const resultSummary = (outcome: string) => `Resolved as ${outcome}.`
export const claimDeposits = (outcome: string, amount: string) => `Claim ${amount}\u00a0REP from ${outcome}`
export const clearDeposits = (outcome: string) => `Clear ${outcome} deposits (worth 0 REP)`
export const clearLosingDepositsDetail = 'Losing deposits return no REP. Clearing them costs gas and is only needed before you redeem your vault REP from this pool: until then they still count as your dispute-staked REP, which blocks redemption.'
export const clearLosingDepositsReviewDescription = 'Returns no REP. Removes these losing deposits from your vault’s dispute-staked REP so you can redeem your vault REP from this pool.'
export const results = 'Results'

function formatPriceWindow(seconds: bigint) {
	if (seconds % 3600n === 0n) return seconds === 3600n ? '1 hour' : `${seconds / 3600n} hours`
	const minutes = seconds / 60n
	return minutes === 1n ? '1 minute' : `${minutes} minutes`
}
export const priceExpired = (windowSeconds: bigint) => `Pool price expired. Reports need a price newer than ${formatPriceWindow(windowSeconds)}.`
export const priceRequested = (countdown: string) => `Price requested. Ready to settle in ${countdown}.`
export const priceReportReady = (id: bigint) => `Price report #${id} is ready.`
export const settlingPriceReport = (id: bigint) => `Settling report #${id}…`
export const priceUpdated = (time: string) => `Price updated. Valid until ${time}.`

export const reportedAmount = (outcome: string, amount: string) => `Reported ${amount} REP on ${outcome}`
export const approvedAmount = (amount: string) => `Approved ${amount} REP`

export const reportingAmount = (outcome: string, amount: string) => `Reporting ${outcome} · ${amount} REP…`
export const approvingAmount = (amount: string) => `Approving ${amount} REP…`

export const claimedDeposits = (outcome: string, amount: string) => `Claimed ${amount} REP from ${outcome}`
export const clearedDeposits = (outcome: string) => `Cleared ${outcome} deposits (worth 0 REP)`

export const claimingDeposits = (outcome: string, amount: string) => `Claiming ${amount} REP from ${outcome}…`
export const clearingDeposits = (outcome: string) => `Clearing ${outcome} deposits (worth 0 REP)…`

export const progressToForkUnavailable = 'Progress to fork: —'

export const winningStatusLead = (side: string) => `You’re leading on ${side}.`
export const winningStatusDetail = (stake: string, worth: string) => `Your ${stake} REP would be worth about ${worth} REP if it ended now.`
export const losingStatusLead = (side: string) => `You’re behind on ${side}.`
export const losingStatusDetail = (minimum: string | undefined, deadline: string, stake: string) => `${minimum === undefined ? 'Report more on this side' : `Add at least ${minimum} REP`} before ${deadline} or your ${stake} REP is lost.`
export const takeTheLead = 'Take the lead'
export const tieStatusLead = 'No side leads right now.'
export const tieStatusDetail = (deadline: string) => `If this stays tied at ${deadline}, no side wins (`
export const tiesResolve = 'see how ties resolve'
export const tieStatusEnd = ').'
export const checkBack = (deadline: string) => `Check back before ${deadline}. Any new report can extend the response window (up to 7 weeks after the game starts).`
export const addReminder = 'Add reminder (.ics)'
export const reminderSummary = (title: string) => `Check escalation: ${title}`
export const deadlineMoved = (deadline: string) => `The response window now ends ${deadline} because a new report was added. Your status may have changed.`
export const explainerTitle = 'How the escalation game works'
export const explainerFirstReport = (bond: string) => `Put REP behind the outcome you believe is correct. The first report must be at least ${bond} REP.`
export const explainerCompetition = 'Other reporters can overtake your side. Each new report can extend the response window, up to 7 weeks after the game starts.'
export const explainerResolution = 'When the response window ends, the side with the most REP wins. Winning deposits get their REP back, and eligible early deposits may also earn a reward; losing deposits are lost.'
export const explainerForkLead = 'If two sides both reach the '
export const formatExplainerForkThresholdSeparator = (threshold: string) => ` (${threshold} REP), the game stops and a `
export const explainerForkTail = ' can be triggered. Your REP then follows the outcome you backed through Fork & migration.'
export const fullExplanation = 'Read the full explanation'
export const winningPosition = (worth: string) => `Leading · worth about ${worth} REP if it ended now`
export const losingPosition = 'Behind · worth 0 REP if it ended now'
export const tiedPosition = 'Tied'
export const forkPosition = 'Continue in Fork & migration'
export const responseWindowEnds = 'Response window ends'
export const attritionStarts = 'Attrition starts'
export const dismissDeadlineNotice = 'Dismiss response window notice'

export const resultClaim = (amount: string) => ` You can claim ${amount} REP.`

export const forkViewerStake = (side: string, stake: string) => `You have ${stake} REP on ${side}.`

export const updateReminder = 'Update your reminder (.ics)'
export const zeroBalanceStatusDetail = 'If all balances stay at zero, the timeout outcome is Invalid.'

export const repSource = 'REP source'
export const noVaultRepSelectWallet = 'No REP is available in your pool vault. Select Wallet REP to report.'
export const insufficientVaultRepSelectWallet = (balance: string) => `Only ${balance} is available in your pool vault. Reduce the amount or select Wallet REP.`

export const loadingVaultFunding = 'Loading vault funding requirements…'

export const depositTriggersFork = 'This report reaches the non-decision threshold: the game ends and a universe fork can be triggered.'
export const forkTriggerWarningTitle = 'This report triggers a universe fork'
export const forkTriggerWarning = (outcome: string, threshold: string) => `Another side already holds ${threshold} REP. Filling ${outcome} to the same threshold ends escalation without a decision: deposits lock, and the question can only resolve by forking the universe into Yes, No, and Invalid. This can’t be undone.`
export const forkTriggerConfirmation = 'I understand this report ends escalation and leads to a universe fork.'
export const forkTriggerConfirmationRequired = 'Confirm that this report triggers the universe fork.'
export const reportingRepApprovalRequired = 'Approve REP for this security pool before reporting.'
export const forkTriggerConfirmationAndApprovalRequired = 'Confirm that this report triggers the universe fork and approve REP for this security pool before reporting.'
export const maxBelowForkHint = (amount: string) => `Max stops at ${amount} REP, just below the non-decision threshold. Confirm the fork warning to fill the side.`
export const maxBelowForkReason = 'Max stops below the non-decision threshold, which leaves less than the minimum first report. Enter an amount to fill the side and trigger the fork.'
export const reportAndTriggerForkLabel = (outcome: string, amount: string) => `Report ${outcome} & trigger fork · ${amount} REP`
export const reportingAndTriggeringFork = (outcome: string, amount: string) => `Reporting ${outcome} & triggering fork · ${amount} REP…`
export const reportForkReviewTitle = (outcome: string, amount: string) => `Report ${outcome} & trigger fork · ${amount}\u00a0REP`
export const reportForkReviewDescription = (outcome: string) => `Fills ${outcome} to the non-decision threshold while another side is already there. Escalation ends without a decision, deposits lock, and the question can only resolve through a universe fork. This can’t be undone.`
export const reportReviewDescription = (outcome: string) => `Deposits REP on ${outcome}. If ${outcome} loses, this REP is lost; if it wins, it returns with any earned reward.`
export const forkTriggerChangedSinceReview = 'This report would now trigger the universe fork. Review the fork warning and confirm before reporting.'
export const depositDeadlinePreview = (deadline: string, extension: string, unchanged: boolean) => `After this report, check back before ${deadline}. ${unchanged ? 'This report does not extend the response window.' : `Response window extended by ${extension}.`} Other reports can change when it ends.`

export const dismissReminderUpdate = 'Dismiss'

export const responseWindowEndsTooSoon = 'The response window ends too soon. Wait for the result before settling deposits.'
