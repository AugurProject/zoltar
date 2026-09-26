export const timeoutResolutionDetail = 'Escalation ended by timeout. The winner is computed from the current dispute-staked REP totals.'
export const escalationMetrics = 'Escalation Metrics'
export const loadingEscalationDeposits = 'Loading escalation deposits.'
export const reportingWorkflow = 'Reporting Workflow'
export const reportOutcome = 'Report Outcome'
export const reportOutcomeSelectionRequired = 'Select an outcome side before reporting on a question.'
export const reportingActivationHint = 'Select an outcome side above to enable reporting.'
export const settlementSelectionRequired = 'Select at least one deposit or use the claim or clear action for this side.'
export const settleEscalationDeposits = 'Settle Escalation Deposits'
export const triggerZoltarFork = 'Trigger universe fork'
export const selectedSideBelowMinimumReason = 'Remaining selected-side capacity is below the minimum report bond.'
export const continueForkMigrationDetail = 'Fork-carried deposits are already represented by the child snapshot; winning proofs can be claimed there after finalization without migrating parent deposits.'
export const contributionAmountRep = 'Contribution Amount (REP)'
export const reportAmountPreviewRequired = 'Enter a valid report amount to preview profit.'
export const escalationStarted = 'Escalation started'
export const chooseDepositsToSettle = 'Choose deposits to settle'
export const forkAlreadyTriggeredReportReason = 'Escalation reached non-decision and the universe fork has already been triggered for this pool. Continue in Fork & Migration.'
export const forkAlreadyTriggeredSettlementReason = 'Dispute-staked REP remains in escalation after non-decision. The universe fork has already been triggered for this pool, so continue in Fork & Migration.'
export const forkTriggerInstruction = 'Escalation reached non-decision. Trigger the universe fork here if this pool should fork.'
export const forkRequiredSettlementReason = 'Dispute-staked REP remains in escalation after non-decision. Trigger the universe fork here if this pool should fork.'
export const initiallyDeposited = 'Initially deposited:'
export const leadHoldingCapital = 'Amount needed to hold the lead'
export const loadingPoolHeldVaultRepBacking = 'Loading pool-held vault REP backing.'
export const loadingWalletRepBalance = 'Loading wallet REP balance.'
export const presetDetailsRequired = 'Loading reporting details.'
export const maxProfitPrestartReason = 'Max reward becomes available after the escalation game starts.'
export const maxProfitWindowFilledReason = 'Max reward preset unavailable because the reward window is already filled on the selected side.'
export const selectedSideLeadsReason = 'Selected side already leads.'
export const loadingEscalation = 'Loading escalation…'
export const refreshReporting = 'Refresh reporting'
export const retryReporting = 'Retry reporting'
export const selectedSideCapacityEmpty = 'No remaining contribution capacity is available on the selected side.'
export const poolHeldVaultRepBackingEmpty = 'No pool-held vault REP backing is available for reporting.'
export const walletRepBalanceEmpty = 'No wallet REP is available for reporting.'
export const nonDecisionThresholdAttoRep = 'Non-decision threshold'
export const reportOnSelectedSide = 'Report on selected side'
export const reportOutcomeAriaLabel = 'Report outcome'
export const currentEscalationDisputeStakeLead = 'Based on the current escalation state, this action would move '
export const acceptedAmountTail = ' from pool-held backing into dispute-staked REP instead of the full entered amount.'
export const acceptedWalletAmountTail = ' from wallet REP into dispute-staked REP instead of the full entered amount.'
export const openForkAndMigration = 'Open fork & migration'
export const managePoolPrice = 'Manage pool price'
export const currentOraclePriceRequired = 'A current pool oracle price is required before reporting.'
export const forkMigrationRequiredDetail = 'Initialize the fork continuation in Fork & Migration. Deposits themselves do not need migration; winning proofs settle in the child after finalization.'
export const submittingReport = 'Submitting report…'
export const approvingReportingRep = 'Approving REP…'
export const reportingNotEnabled = 'Reporting Not Enabled'
export const reportingOpen = 'Reporting Open'
export const resolved = 'Resolved'
export const timedOut = 'Timed Out'
export const pendingFinalization = 'Pending finalization'
export const winningPayout = 'Winning payout'
export const losingDepositSettlement = 'Losing deposit settlement'
export const currentClaimType = 'Current claim type:'
export const entryDepth = 'Entry depth:'
export const refreshFinalizedOutcomeReason = 'Escalation has ended. Refresh reporting to view the finalized outcome before settling deposits.'
export const reportingDetailsRequired = 'Loading reporting details.'
export const poolFinalizedReason = 'This pool is already finalized.'
export const questionFinalizationRequired = 'Escalation deposits cannot be settled until the question is finalized.'
export const formatReportingResolvedDetailLabel = (selectedOutcomeLabel: string) => `Question finalized as ${selectedOutcomeLabel}.`
export const unresolvedMigrationExpiredDetail = 'The optional unresolved parent escalation-deposit accounting cleanup window has closed. Child proof eligibility is unchanged.'
export const worthAfterFinalizationPendingFinalization = 'Worth after finalization: Pending finalization'
export const worthNow = 'Worth now:'
export const presetOutcomeSelectionRequired = 'Select an outcome side before using presets.'
export const selectedSideIsUnavailable = 'Selected side is unavailable.'
export const selectedSide = 'Selected Side'
export const formatSettleSelectedDepositsLabel = (sideLabel: string) => `Settle selected ${sideLabel} deposits`
export const formatSettlingDepositsPendingLabel = (sideLabel: string) => `Settling ${sideLabel} deposits…`
export const startBondAttoRep = 'Start bond'
export const totalSideDisputeStakedRep = 'All reporters'
export const yourSideDisputeStakedRep = 'You'
export const triggeringZoltarFork = 'Triggering universe fork…'
export const loadingEscalationDepositsDetail = 'Loading escalation deposits…'
export const walletUnsettledDepositsEmpty = 'Connected wallet has no unsettled escalation deposits.'
export const forkCarriedSettlementRedirectDetail = 'This pool also has fork-carried escalation positions. Settle those in Fork & Migration.'

export const reportingParameters = 'Reporting parameters'

export const phaseLabels = ['Reporting open', 'Response window', 'Resolved']
export const forkPhase = 'Fork'
export const phaseProgress = (step: number, label: string) => `Step ${step} of 3 · ${label}`
export const firstReportNext = (bond: string) => `The first report starts the game. Minimum first report: ${bond} REP.`
export const pendingStartNext = ({ end, outcome }: { end: string; outcome: string }) => `If nobody outbids ${outcome} by ${end}, ${outcome} wins.`
export const activeNext = (end: string, leader: string) => `If nobody outbids ${leader} by ${end}, ${leader} wins.`
export const resolvedNext = 'Settle your deposits below.'
export const startsWithFirstReport = 'starts with first report'
export const progressToFork = (largest: string, threshold: string, percent: string) => `Progress to fork: ${largest} / ${threshold} REP (${percent}%)`
export const forkProgressHelp = 'A fork requires two sides to reach this threshold.'
export const bindingCapitalHelp = 'The second-largest side balance; exceed it to hold the lead.'
export const minimumPreset = (started: boolean, amount?: string) => `${started ? 'Min to lead' : 'Start bond'}${amount === undefined ? '' : ` (${amount} REP)`}`
export const rewardPreset = (amount?: string) => `Max reward${amount === undefined ? '' : ` (${amount} REP)`}`
export const reportAmountPlaceholder = '0'
export const reportAmountLabel = (outcome: string, amount: string) => `Report ${outcome} · ${amount} REP`
export const approveAmountLabel = (amount: string) => `Approve ${amount} REP`
export const paidFromVault = 'Paid from: vault-backed REP (no approval needed)'
export const paidFromWallet = 'Paid from: wallet REP'
export const availableBalance = (amount: string) => `Available: ${amount} REP.`
export const fundingSourceHelp = 'The first report funds the game from the pool; later reports come from your wallet.'
export const continuationFundingHelp = 'Fork continuations use vault-backed REP from the pool.'
export const yourPositions = 'Your positions'
export const resultSummary = (outcome: string, amount?: string) => `Resolved as ${outcome}.${amount === undefined ? '' : ` You can claim ${amount} REP.`}`
export const claimDeposits = (outcome: string, amount: string) => `Claim ${amount} REP from ${outcome}`
export const clearDeposits = (outcome: string) => `Clear ${outcome} deposits (worth 0 REP)`
export const results = 'Results'

export const priceExpired = 'Pool price expired. Reports need a price newer than 5 minutes.'
export const priceRequested = (countdown: string) => `Price requested. Ready to settle in ${countdown}.`
export const priceReportReady = (id: bigint) => `Price report #${id} is ready.`
export const settlePriceReport = (id: bigint) => `Settle report #${id}`
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

export const yourStatus = 'Your status'
export const winningStatusLead = (side: string) => `You're winning on ${side}.`
export const winningStatusDetail = (stake: string, worth: string) => `Your ${stake} REP would be worth about ${worth} REP if it ended now.`
export const losingStatusLead = (side: string) => `You're losing on ${side}.`
export const losingStatusDetail = (minimum: string, deadline: string, stake: string) => `Add at least ${minimum} REP before ${deadline} or your ${stake} REP is lost.`
export const takeTheLead = 'Take the lead…'
export const tieStatusLead = 'No side leads right now.'
export const tieStatusDetail = (deadline: string) => `If this stays tied at ${deadline}, no side wins (`
export const tiesResolve = 'see how ties resolve'
export const tieStatusEnd = ').'
export const checkBack = (deadline: string) => `Check back before ${deadline}. Any new report can push this deadline later (up to 7 weeks after the game starts).`
export const addReminder = 'Add reminder (.ics)'
export const reminderSummary = (title: string) => `Check escalation: ${title}`
export const deadlineMoved = (deadline: string) => `The deadline moved to ${deadline} because a new report was added. Your status may have changed.`
export const explainerTitle = 'How the escalation game works'
export const explainerFirstReport = (bond: string) => `Put REP behind the outcome you believe is correct. The first report needs at least the start bond (${bond} REP).`
export const explainerCompetition = 'Other reporters can outbid you. Each new report can move the deadline, up to 7 weeks after the game starts.'
export const explainerResolution = 'When the deadline passes, the side with the most REP wins. Winning deposits get their REP back, and eligible early deposits may also earn a reward; losing deposits are lost.'
export const explainerFork = (threshold: string) => `If two sides both reach ${threshold} REP, the game stops and a universe fork can be triggered. Your REP then follows the outcome you backed through Fork & Migration.`
export const fullExplanation = 'Read the full explanation'
export const winningPosition = (worth: string) => `Winning · worth about ${worth} REP if it ended now`
export const losingPosition = 'Losing · worth 0 REP if it ended now'
export const tiedPosition = 'Tied'
export const forkPosition = 'Continue in Fork & Migration'
export const responseWindowEnds = 'Response window ends'
export const attritionStarts = 'Attrition starts'
export const dismissDeadlineNotice = 'Dismiss deadline notice'

export const resultClaim = (amount: string) => ` You can claim ${amount} REP.`

export const forkViewerStake = (side: string, stake: string) => `You have ${stake} REP on ${side}.`

export const updateReminder = 'Update your reminder (.ics)'
export const zeroBalanceStatusDetail = 'If all balances stay at zero, the timeout outcome is Invalid.'
