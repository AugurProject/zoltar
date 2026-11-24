import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export const disputeAndSwap = 'Dispute & swap'
export const disputeDelay = 'Dispute delay'
export const disputeDelaySeconds = 'Dispute delay (seconds)'
export const escalationHalt = 'Escalation halt'
export const disputeFeePercentage = 'Dispute fee (%)'
export const disputeFeeRate = 'Dispute fee'
export const price = 'Price'
export const protocolFee = 'Protocol fee'
export const protocolFeePercentage = 'Protocol fee (%)'
export const reportId = 'Report ID'
export const settlementDelay = 'Settlement delay'
export const settlementDelaySeconds = 'Settlement delay (seconds)'
export const settlerReward = 'Settler reward'
export const tokenPair = 'Token pair'
export const baseToken = 'Base token'
export const quoteToken = 'Quote token'
export const openOracleGame = 'OpenOracle'
export const standaloneReportSettings = 'Standalone report settings'
export const formatTokenWithdrawn = (tokenSymbol: CopyTemplateValue) => `${tokenSymbol} withdrawn`
export const reportDirectory = 'Report directory'
export const browseReportsDescription = 'Search favorite reports or open a report by ID.'
export const selectedReportDescription = 'Review the selected report’s current stage, balances, and available settlement or dispute actions.'
export const formatReportsShownSummary = (shownCount: CopyTemplateValue, totalCount: CopyTemplateValue) => `${shownCount} of ${totalCount} reports shown.`
export const callbackContract = 'Callback contract'
export const callbackExtra = 'Callback / extra'
export const callbackGasLimit = 'Callback gas limit'
export const formatCurrentAmount1Label = (tokenSymbol: string) => `Current base amount (${tokenSymbol})`
export const formatCurrentAmount2Label = (tokenSymbol: string) => `Current quote amount (${tokenSymbol})`
export const formatTokenPairSuffix = (token1Symbol: string, token2Symbol: string) => `${token1Symbol} / ${token2Symbol}`
// Report prices are quote tokens per base token, matching the pool oracle's REP per ETH direction.
export const formatReportPriceUnit = (token1Symbol: string, token2Symbol: string) => `${token2Symbol} per ${token1Symbol}`
export const formatReportBrowseTitle = (token1Symbol: string, token2Symbol: string, reportId: string) => `${token1Symbol} / ${token2Symbol} · report #${reportId}`
export const createAnother = 'Create another'
export const formatTokenDecimalsInvalid = (tokenAddress: CopyTemplateValue) => `Token metadata for ${tokenAddress} returned invalid decimals`
export const formatWethMetadataInvalid = (tokenAddress: CopyTemplateValue) => `WETH metadata is invalid for ${tokenAddress}`
export const formatReportTokenMetadataUnavailable = (reportId: CopyTemplateValue, reason: CopyTemplateValue) => `OpenOracle report #${reportId} is unavailable. ${reason}.`
export const settlementGasExceedsTransactionCap = 'This report’s settlement callback needs more gas than one transaction allows, so it cannot be settled from this app.'
export const reportCreated = 'Report created'
export const createStandaloneReport = 'Create standalone OpenOracle report'
export const creating = 'Creating…'
export const reportAtAGlance = 'Report at a glance'
export const currentPrice = 'Current price'
export const currentReportState = 'Current report state'
export const currentReporter = 'Current reporter'
export const submittingDispute = 'Submitting dispute…'
export const disputingTheReport = 'disputing the report'
export const disputeOccurred = 'Dispute occurred'
export const disputeWalletRequiredReason = commonCopy.formatConnectWalletBefore(disputingTheReport)
export const settlementWalletRequiredReason = commonCopy.formatConnectWalletBefore('settling the report')
export const economics = 'Economics'
export const formatDisputeAmountsInvalidReason = (tokenSymbol: string) => `Enter valid dispute amounts before approving ${tokenSymbol}.`
export const wrapEth = 'Wrap ETH'
export const formatWrapEthAmount = (amount: string) => `Wrap ${amount} ETH`
export const wrappingEth = 'Wrapping ETH…'
export const disputeAmountsRequiredBeforeWrap = 'Enter valid dispute amounts before wrapping ETH.'
export const wrapEthNotNeeded = 'Not needed. Your WETH covers this dispute.'
export const loadingWethBalance = 'Loading current WETH balance…'
export const loadingEthBalance = 'Loading ETH balance…'
export const formatInsufficientEthToWrap = (required: string, available: string) => `Insufficient ETH to wrap. Need ${required} ETH, wallet has ${available} ETH.`
export const formatWrapEthFirst = (amount: string) => `Wrap ${amount} ETH to WETH first.`
export const wrapEthFailed = 'Failed to wrap ETH'
export const wrapEthDisputeOnly = 'ETH can only be wrapped for a report that is open to disputes.'
export const disputeEscalationStopAmountHelpText = 'Base token amount that ends escalation.'
export const ethSent = 'ETH sent'
export const formatInitialTokenReportLabel = (tokenSymbol: string) => `Initial ${tokenSymbol} report deposit`
export const exactToken1Report = 'Base token amount'
export const initialToken2Amount = 'Quote token amount'
export const identity = 'Identity'
export const initialEconomics = 'Initial economics'
export const lastReportOpportunity = 'Last report on opposite clock'
export const reportLoadRequired = 'Select a report first.'
export const escalationMultiplierHelpText = 'Below the escalation halt, each dispute multiplies the base amount by this factor. At or above the halt, it adds one raw base-token unit. A zero halt uses that increment from the first dispute.'
export const formatNewAmountMustBeExactDetail = (tokenSymbol: string, amount: string) => `New ${tokenSymbol} amount must be exactly ${amount} for this dispute.`
export const formatNewAmountRangeDetail = (tokenSymbol: string, minimumAmount: string, maximumAmount: string) => `New ${tokenSymbol} amount must be between ${minimumAmount} and ${maximumAmount} for this dispute.`
export const oracleBalances = 'Your oracle balances'
export const oracleBalancesDetail = 'Settlement rewards, returned report liquidity, and dispute proceeds stay in the oracle until the credited account withdraws them.'
export const noOracleBalances = 'No withdrawable oracle balances are available for this token pair.'
export const noWithdrawableBalanceForAsset = 'No withdrawable balance is available for this asset.'
export const loadingOracleBalances = 'Loading oracle balances…'
export const nothingToWithdraw = 'Nothing to withdraw.'
export const oracleBalancesUnavailable = 'Oracle balances unavailable.'
export const withdrawBalance = (tokenSymbol: string) => `Withdraw ${tokenSymbol}`
export const withdrawingBalance = (tokenSymbol: string) => `Withdrawing ${tokenSymbol}…`
export const checkingWithdrawalBalance = (tokenSymbol: string) => `Checking ${tokenSymbol} balance…`
export const formatWithdrawalBalanceChanged = (tokenSymbol: CopyTemplateValue) => `Your withdrawable ${tokenSymbol} balance changed. Try withdrawing the updated balance again.`
export const withdrawalBalanceRefreshFailed = 'Unable to refresh the withdrawable balance'
export const numberOfReports = 'Number of reports'
export const openReport = 'Open report'
export const formatOpenReportLabel = (reportTitle: string) => `Open report: ${reportTitle}`
export const oracleAddress = 'Oracle address'
export const protocolFeeRecipient = 'Protocol fee recipient'
export const report = 'Report'
export const formatReportNumberTitle = (reportId: string) => `Report #${reportId}`
export const reportTimestamp = 'Report timestamp'
export const reportBlock = 'Report block'
export const reportActions = 'Report actions'
export function formatSettleCountdown(remaining: bigint, timeType: boolean) {
	if (!timeType) return `Can settle in ${remaining} block${remaining === 1n ? '' : 's'}`
	return `Can settle in ${formatDuration(remaining)}`
}
export const searchReports = 'Search reports'
export const reportSearchPlaceholder = 'Report ID, token, or address'
export const noFavoriteReports = 'No favorite reports yet'
export const noFavoriteReportsDetail = 'Reports you open are added here.'
export const formatOpenReportById = (reportId: CopyTemplateValue) => `Open report #${reportId}`
export const formatReportUpdated = (relativeTime: CopyTemplateValue) => `Updated ${relativeTime}`
export const settlingReport = 'Settling report…'
export const settlingReportTitle = 'Settling report'
export const reportSettled = 'Report settled'
export const settlerRewardHelpText = 'ETH credited to the settler’s internal OpenOracle balance, sent with the create transaction. The settler withdraws it separately.'
export const settlementSummary = 'Settlement summary'
export const settlementTimestamp = 'Settlement timestamp'
export const settlementBlock = 'Settlement block'
export const settlementTimestampOnConfirmation = 'Recorded on confirmation'
export const notSettled = 'Not settled'
export const stateHash = 'State hash'
export const allStatuses = 'All statuses'
export const disputed = 'Disputed'
export const awaitingDisputeWindow = 'Waiting for dispute window'
export const disputeWindowClosing = 'Dispute window closing'
export const disputeWindowOpen = 'Dispute window open'
export const readyToSettle = 'Ready to settle'
export const reportFiltersEmpty = 'No favorite reports match the current search and status filters.'
export const refreshReport = 'Refresh report'
export const reportAmounts = 'Report amounts'
export const openOracleReportDetails = 'OpenOracle report details'
export const standaloneOracleWarningDetail = 'Standalone only. Start security-pool-managed requests from the security pool price panel.'
export const advancedDisputeAndTimingSettings = 'Advanced dispute & timing settings'
export const advancedDisputeAndTimingSettingsDetail = 'These values control how challenges escalate and when settlement becomes available. Keep the defaults unless your report requires different economics.'
export const secondsAbbreviation = 's'
export const blocks = 'blocks'
export const formatTimingValue = (timingAmount: CopyTemplateValue, unit: CopyTemplateValue) => `${timingAmount}\u00a0${unit}`
export const timing = 'Timing'
export const token1Address = 'Base token address'
export const formatTokenApprovalTitle = (tokenSymbol: string) => `${tokenSymbol} approval`
export const token2Address = 'Quote token address'
export const tokenToSwapOut = 'Token to swap out'
export const trackDisputes = 'Track disputes'
export const formatNewTokenAmountFieldLabel = (tokenSymbol: string) => `New ${tokenSymbol} amount`
export const reporter = 'Reporter'
export const parameterDetails = 'Parameter details'
export const standaloneParameterDetails = 'Base token amount and escalation halt use the base token’s decimals.'

export const settleReportTitle = (id: bigint) => `Settle report #${id}`

export const formatSettledReportNumber = (id: string) => `Report #${id} settled`

export const settleReport = 'Settle report'

export const formatReportMissing = (reportId: CopyTemplateValue) => `OpenOracle report #${reportId} does not exist.`
export const formatApprovingTokenTitle = (tokenSymbol: CopyTemplateValue) => `Approving ${tokenSymbol}`
export const formatWithdrawingTokenTitle = (tokenSymbol: CopyTemplateValue) => `Withdrawing ${tokenSymbol}`
export const creatingStandaloneReportTitle = 'Creating standalone OpenOracle report'
export const standaloneReportCreated = 'Standalone OpenOracle report created'

export const formatSecondsDurationHint = (seconds: CopyTemplateValue, duration: CopyTemplateValue) => `${seconds} seconds = ${duration}`
export const impliedInitialPrice = 'Initial price'
export const readingTokenMetadata = 'Reading token details…'
export const formatResolvedToken = (tokenSymbol: CopyTemplateValue, decimals: CopyTemplateValue) => `${tokenSymbol} · ${decimals} decimals`
export const formatTokenMetadataUnreadable = (role: 'Base' | 'Quote') => `${role} token address is not a readable ERC-20 contract.`
export const disputeOutcome = 'Dispute summary'
export const disputeOutcomePending = 'Enter the new amounts to preview what you pay and receive.'
export const youPay = 'You pay'
export const disputeFee = 'Dispute fee (to current reporter)'
export const feesIncludedInPayment = 'Fees are included in the amounts you pay.'
export const creditedToOracleBalance = 'Credited to your oracle balance'
export const yourNewReport = 'Your new report'
export const proposedPrice = 'Proposed price'
export const newBaseAmountFixedHint = 'Set by the report’s escalation rules.'
export const newQuoteAmountHint = 'The quote amount sets the price you propose.'
export const disputeSwapTokenPending = 'Determined by the proposed price'
export const formatReportCreatedDetail = (reportId: CopyTemplateValue) => `Report #${reportId} is live. Open it to track disputes and settlement.`
export const reportCreatedWithoutIdDetail = 'Your report is live. Find it in the report directory.'
export const multiplierUnit = '×'
export const formatDisputeSwapTokenChanged = (newTokenSymbol: CopyTemplateValue, reviewedTokenSymbol: CopyTemplateValue) => `The refreshed report changes this dispute to swap out ${newTokenSymbol} instead of ${reviewedTokenSymbol}. Review the refreshed report and try again.`

export const priceExpired = 'Price expired'
export const settledAfterPriceExpired = 'Settled after price expired'
export const staleSettlementWarning = 'Settlement will clear this report, but the security pool will reject its price.'
export const staleSettledReportWarning = 'Request a new price.'
export const expiredReportPrice = 'This report’s price has expired.'
export const reportPriceRejected = 'Report settled; price rejected'
export const poolPriceAccepted = 'Security pool accepted this price.'

export function formatPriceSettlementRejection(reason: string) {
	if (reason === 'Security pool reporting window closed') return 'Reporting is closed in this security pool universe. Check its fork and branch status.'
	if (reason === 'Report timestamp not newer') return 'This report did not replace the newer accepted price. Check the accepted price and any attached operation results.'
	return reason === 'Report stale' ? 'Price expired before settlement. Request a new price.' : `Security pool rejected this price: ${reason}. Request a new price.`
}

export const reportPriceDeferred = 'Report settled; price pending recovery'

export function formatPriceSettlementDeferral(maxSettlementBaseFeeNanoEthPerGas: string) {
	return `The base fee was above this report’s ${maxSettlementBaseFeeNanoEthPerGas} nanoETH per gas limit, so the security pool kept the report pending. Recover it from the security pool price panel once the base fee is at or below the limit, before the price expires.`
}

export const priceExpiredDuringReview = 'Price expired while reviewing. Review settlement again; the security pool will reject this price.'
export const priceSettlementUnconfirmed = 'Report settled; price acceptance unconfirmed'
export const priceSettlementUnconfirmedDetail = 'The security pool did not confirm accepting this price. Check the security pool oracle before using it.'

export const reportAlreadySettled = 'This report is already settled.'
export const reportMissingInitialReport = 'This report is invalid because its initial report is missing.'

export const formatAbsoluteBlock = (value: bigint) => `Block ${value}`
export const approvalGasRequired = 'Add ETH to pay the token approval network fee.'
