/**
 * A sentence with REP amounts, as its parts with each amount in place, so the UI can render each one rounded with the exact
 * value on hover and plain text can join rounded strings. Each amount carries its own REP unit.
 */
type CopyParts<Amount> = readonly (string | Amount)[]

export const reportAnOutcome = 'Report an outcome'
export const reportOutcomeChoice = 'Outcome'
export const outcomeRepStaked = 'staked'
export const outcomeRepToLead = 'more to lead'
export const outcomeLeading = 'Leading'
export const outcomeBehind = 'Behind'
export const reportComparison = 'After this report'
export const reportComparisonBefore = 'Before'
export const reportComparisonAfter = 'After'
export const reportComparisonPayout = 'You’d get back if the window ended now'
export const reportComparisonStake = (outcome: string) => `Your REP staked on ${outcome}`
export const reportComparisonLeader = 'Leader'
export const reportComparisonNoReports = 'No reports'
export const reportComparisonDeadline = 'Window ends'
export const reportComparisonUndecided = 'Ends undecided'
export const reportComparisonKnownDeposits = 'Payout estimates include deposits this device knows about.'
export const reportComparisonLoss = (outcome: string) => `If ${outcome} loses, you lose`
export const reportOutcomeSelectionRequired = 'Select an outcome side before reporting on a question.'
export const reportingActivationHint = 'Select an outcome side above to enable reporting.'
export const settlementSelectionRequired = 'Select at least one deposit to claim.'
export const triggerZoltarFork = 'Trigger universe fork'
export const checkingFork = 'Checking…'
export const forkTriggerOnce = 'Anyone can send this. It only needs to be sent once.'
export const forkIrreversible = 'A fork cannot be undone.'
export const forkFreeze = 'This universe freezes; everything moves to child universes Yes, No and Invalid.'
export const forkCostLead = 'Triggering costs you'
export const forkCostDetail = 'REP supply grew after reporting started. You give up this REP permanently.'
export const forkStakeCarries = 'Your REP stays staked and carries to the child universes after the fork.'
export const selectedSideBelowMinimumReason = 'Remaining selected-side capacity is below the minimum report.'
export const reportAmountFieldLabel = 'Report amount'
export const loadingPoolHeldVaultRepBacking = 'Loading the position’s pledged REP…'
export const loadingWalletRepBalance = 'Loading wallet REP balance…'
export const loadingReportingDetails = 'Loading reporting details…'
export const maxProfitPrestartReason = 'Full reward share becomes available after the first report.'
export const maxProfitForkReason = 'Full reward share is unavailable because matching the other side would end reporting without a decision.'
export const maxProfitWindowFilledReason = 'Full reward share is unavailable because the reward window is already filled on the selected side.'
export const maxProfitUnavailable = 'Full reward share is unavailable.'
export const maxProfitOutsideCapacity = 'Full reward share is unavailable because the selected side cannot fill the reward window within its remaining capacity.'
export const selectedSideLeadsReason = 'Selected side already leads.'
export const loadingEscalation = 'Loading reporting…'
export const retryReporting = 'Retry reporting'
export const selectedSideCapacityEmpty = 'The selected side has no remaining capacity.'
export const poolHeldVaultRepBackingEmpty = 'This position has no pledged REP available for reporting.'
export const walletRepBalanceEmpty = 'No wallet REP is available for reporting.'
export const reportOnSelectedSide = 'Report on selected side'
export const currentEscalationDisputeStakeLead = 'This report would stake '
const acceptedWalletAmountTail = ' from your wallet instead of the full amount.'
const acceptedTieAmountTail = ', 1 attoREP less than entered, because a report cannot tie the leading outcome.'
export function formatAcceptedAmountTail(trimmedByTie: boolean) {
	if (trimmedByTie) return acceptedTieAmountTail
	return acceptedWalletAmountTail
}
export const openForkAndMigration = 'Open Fork & recovery'
export const managePoolPrice = 'Manage security pool price'
export const currentOraclePriceRequired = 'A current security pool oracle price is required before reporting.'
export const forkMigrationRequiredDetail = 'Set up the child questions in Fork & recovery. Your deposits carry to the child universes. Claim winning deposits there after resolution.'
export const parentUniverseForked = 'Universe forked'
export const submittingReportTitle = 'Submitting report'
export const approvingRepTitle = 'Approving REP'
export const settlingEscalationDepositsTitle = 'Claiming reporting deposits'
export const refreshFinalizedOutcomeReason = 'Reporting has ended. Refresh to check the result before claiming deposits.'
export const questionFinalizationRequired = 'Claim deposits after the question resolves.'
export const reportingAlreadyResolved = 'Reporting has already resolved.'
export const invalidReportAmount = 'The reporting game would not accept this amount.'
export const enterMinimumFirstReport = (amount: string) => `Enter at least ${amount} to meet the minimum first report.`
export const minimumReportRequired = (amount: string) => `Enter at least ${amount} to start the reporting game.`
export const reportPreviewUnavailable = 'Unable to check how much REP this report would stake.'
export const claimWalletAction = 'claiming reporting deposits'
export const claimUnavailableBeforeReporting = 'Reporting has not started yet.'
export const claimOutcomeUnavailable = 'Could not load deposits for this outcome.'
export const claimParentAfterResolution = 'Claim winning deposits in the child question after it resolves.'
export const claimDepositUnavailable = (index: bigint, side: string) => `Deposit #${index} is no longer available to claim on ${side}.`
export const claimFailed = 'Claim failed'
export const presetOutcomeSelectionRequired = 'Select an outcome side before using presets.'
export const selectedSideIsUnavailable = 'Selected side is unavailable.'
export const selectedSide = 'Selected side'
export const triggeringZoltarFork = 'Triggering universe fork…'
export const walletUnsettledDepositsEmpty = 'This wallet has no remaining reporting deposits.'
export const forkCarriedSettlementRedirectDetail = 'Claim deposits carried from the parent universe in Fork & recovery.'

export const takeLeadBeforeFirstReport = 'Take the lead is available after the first report.'
export const takeLeadForkReason = 'Two outcomes would reach the threshold and end reporting without a decision.'
const minimumPresetLabels = { min: 'Min', takeLead: 'Take the lead' } as const
/** The reporting presets fill the minimum first report or the smallest amount needed to take the lead. */
export const minimumPreset = <Amount>(kind: keyof typeof minimumPresetLabels, amount?: Amount): CopyParts<Amount> => (amount === undefined ? [minimumPresetLabels[kind]] : [minimumPresetLabels[kind], ' (', amount, ')'])
export const rewardPreset = <Amount>(amount?: Amount): CopyParts<Amount> => (amount === undefined ? ['Full reward share'] : ['Full reward share (', amount, ')'])
export const reportAmountPlaceholder = '0'
export const reportAmountLabel = (outcome: string, amount: string) => `Report ${outcome} · ${amount} REP`
export const paidFromWallet = 'Paid from: wallet REP'
export const availableBalance = (amount: string) => `Available: ${amount} REP.`
export const claimDeposits = (outcome: string, amount: string) => `Claim ${amount}\u00a0REP from ${outcome}`

export const reportedAmount = (outcome: string, amount: string) => `Reported ${amount} REP on ${outcome}`
export const approvedAmount = (amount: string) => `Approved ${amount} REP`

export const reportingAmount = (outcome: string, amount: string) => `Reporting ${outcome} · ${amount} REP…`

export const claimedDeposits = (outcome: string, amount: string) => `Claimed ${amount} REP from ${outcome}`

export const explainerTitle = 'How reporting works'
export const explainerFirstReport = (bond: string) => `Put REP behind the outcome you believe is correct. The first report must be at least ${bond} REP.`
export const explainerCompetition = 'Other reporters can overtake your side, even in the last seconds. A report that raises the middle of the three balances extends the response window.'
export const explainerResolution = 'When the response window ends, the side with the most REP wins. Winning deposits get their REP back, and eligible early deposits may also earn a reward; losing deposits are lost.'
export const explainerForkLead = 'If two sides both reach the '
export const formatExplainerForkThresholdSeparator = (threshold: string) => ` (${threshold} REP), the game stops and a `
export const explainerForkTail = ' can be triggered. Your REP then follows the outcome you backed through Fork & recovery.'
export const fullExplanation = 'Read the full explanation'
export const tiedPosition = 'Tied'

export const noVaultRepSelectWallet = 'Select Wallet REP to report. This position has no REP available.'

export const forkTriggerWarningTitle = 'This report ends reporting without a decision'
export const forkTriggerWarning = (outcome: string, threshold: string) => `Another side already holds ${threshold} REP. Filling ${outcome} to the same threshold locks deposits. Anyone can then trigger the irreversible universe fork. Your deposits carry to the child universes.`
export const forkTriggerConfirmation = 'I understand this report ends reporting and allows the universe to fork.'
export const forkTriggerConfirmationRequired = 'Confirm that this report ends reporting without a decision.'
export const reportingRepApprovalRequired = 'Approve REP for this question before reporting.'
export const reportingApprovalAction = 'reporting'
export const reportAmountRequired = 'Enter a report amount.'
export const forkTriggerConfirmationAndApprovalRequired = 'Confirm the non-decision warning and approve REP for this question before reporting.'
export const maxBelowForkHint = <Amount>(amount: Amount): CopyParts<Amount> => ['Max stops at ', amount, ', just below the non-decision threshold. Confirm the warning to fill the side.']
export const maxBelowForkReason = 'Max stops below the non-decision threshold, which leaves less than the minimum first report. Enter the amount that ends reporting without a decision.'
export const reportAndEndReportingLabel = (outcome: string, amount: string) => `Report ${outcome} & end reporting · ${amount} REP`
export const reportForkReviewTitle = (outcome: string, amount: string) => `Report ${outcome} & end reporting · ${amount}\u00a0REP`
export const reportForkReviewDescription = (outcome: string) => `Fills ${outcome} to the non-decision threshold while another side is already there. Reporting ends without a decision, deposits lock, and the question can only resolve through a universe fork. This can’t be undone.`
export const reportReviewDescription = (outcome: string) => `Deposits REP on ${outcome}. If ${outcome} loses, this REP is lost; if it wins, it returns with any earned reward.`
export const forkTriggerChangedSinceReview = 'This report would now end reporting without a decision. Review the warning and confirm before reporting.'

export const responseWindowEndsTooSoon = 'The response window ends too soon to report. Wait for the result.'

export const recoverySource = 'Inherited reporting deposits'

export const settleInheritedClaim = 'Claim inherited reporting deposit'
export const settleInheritedClaims = 'Claim inherited reporting deposits'

export const claimSettled = 'Inherited deposit claimed'

export const inheritedClaims = 'Inherited reporter claims'

export const inheritedClaimsDescription = 'Claim winning deposits from the parent question after this branch resolves.'

export const claimPending = 'Another claim transaction is pending.'

export const claimAuthenticationRequired = 'Refresh to check this deposit.'

export const claimResolutionRequired = 'Wait for branch resolution.'

export const claimWinningOutcomeRequired = 'Only deposits on the winning outcome can be claimed.'

export const inheritedClaimContextChanged = 'The question or wallet changed. Reopen the claim.'
export const inheritedClaimDepositChanged = 'This deposit changed. Refresh and try again.'
export const inheritedClaimSubmissionFailed = 'Could not claim inherited deposits.'
export const inheritedClaimRequiresChildQuestion = 'Open the question in the child universe to claim inherited deposits.'
export const inheritedClaimChildReportingUnavailable = 'Reporting is unavailable for this question in the child universe.'
export const inheritedClaimParentDepositsUnavailable = 'Could not check deposits from the parent universe.'
export const inheritedDepositAlreadyClaimed = (index: bigint) => `Deposit #${index} from the parent universe has already been claimed.`
export const inheritedDepositUnavailable = (index: bigint) => `Deposit #${index} from the parent universe is unavailable.`

export const repUnit = 'REP'

export const settleClaim = 'Claim REP'

export const settlingClaim = 'Claiming REP'

export const inheritedClaimIdentity = (outcome: string, index: string) => `${outcome} · Deposit #${index} ·`

export const inheritedOutcomeReportingClosed = 'This branch inherits a fixed question outcome; new reports are closed.'
export const continuationNotResumed = 'Resume the continuation game before reporting.'
export const inheritedOutcomeCannotFork = 'This game has a fixed inherited outcome and cannot trigger a universe fork.'

export const walletRepReviewLabel = 'Wallet REP'
export const claimPayoutReviewLabel = 'Claim payout'
export const claimPayoutChangedSinceReview = 'The claim payout changed. Refresh and review the claim again.'
export const stakedRepReviewLabel = (outcome: string) => `Your REP staked on ${outcome}`
export const reportReviewInsufficientRep = 'Wallet REP changed. Add enough REP for this report and try again.'
export const escalationPreparationChanged = 'Reporting is already prepared. Review the question again.'

export const reportingReadFailed = 'Failed to load reporting details'
export const invalidReportingAmount = 'Invalid report amount.'
export const reportingUnavailable = 'Reporting actions are unavailable until this question is operational.'
export const allowanceAlreadySufficient = 'This question already has enough REP allowance for this report.'
export const reportingOutcomeUnavailable = 'The selected reporting outcome is unavailable.'
export const reportingCapacityRemaining = (remaining: string) => `Only ${remaining} remains before the selected side reaches the non-decision threshold.`
export const reportingBalanceShortfall = (shortfall: string) => `Insufficient wallet REP. Add ${shortfall} before reporting.`

export const repApproved = 'Reporting REP approved'
export const reportSubmitted = 'Report submitted'
export const claimed = 'Claimed'
export const repApprovalFailed = 'REP approval failed'
export const reportFailed = 'Report failed'

export const reportWalletAction = 'reporting on a question'
export const loadingQuestionRepAllowance = 'Loading REP allowance for the question…'
export const formatWalletRepRequiredBeforeReporting = (required: string) => `Add ${required} to this wallet before reporting.`
export const postTransactionReportingRefreshFailed = 'Reporting transaction succeeded, but refreshing reporting details failed'

export const reportingRefreshTimedOut = 'Reporting refresh timed out.'
export const reportingRepApprovalFailed = 'Failed to approve REP for reporting'
export const reportOutcomeFailed = 'Failed to report on outcome'
export const validReportingOutcomeRequired = 'Select a valid reporting outcome.'
export const selectedSideAlreadyFull = (threshold: string) => `Selected side is already full at ${threshold}.`
