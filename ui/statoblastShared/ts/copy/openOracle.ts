import type { CopyTemplateValue } from '@zoltar/ui-core-shared/copy/types.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export const disputeAndSwap = 'Dispute & swap'
export const disputeAndSwapAction = 'Dispute & swap'
export const disputeDelay = 'Dispute delay'
export const disputeDelaySeconds = 'Dispute delay (seconds)'
export const escalationHalt = 'Escalation halt'
export const feePercentage = 'Fee percentage'
export const disputeFeePercentage = 'Dispute fee (%)'
export const price = 'Price'
export const protocolFee = 'Protocol fee'
export const protocolFeePercentage = 'Protocol fee (%)'
export const reportId = 'Report ID'
export const settlementTime = 'Settlement time'
export const settlementDelaySeconds = 'Settlement delay (seconds)'
export const settlerReward = 'Settler reward'
export const tokenPair = 'Token pair'
export const baseToken = 'Base token'
export const quoteToken = 'Quote token'
export const openOracleGame = 'Standalone oracle report'
export const formatTokenWithdrawn = (tokenSymbol: CopyTemplateValue) => `${tokenSymbol} withdrawn`
export const browseReports = 'Browse reports'
export const reportDirectory = 'Report directory'
export const browseReportsDescription = 'Search favorite reports or open a report by ID.'
export const createReportDescription = 'Create a standalone report and review its assets, funding, and escalation settings before submitting.'
export const selectedReportDescription = 'Review the selected report’s current stage, balances, and available settlement or dispute actions.'
export const formatReportsShownSummary = (shownCount: CopyTemplateValue, totalCount: CopyTemplateValue) => `${shownCount} of ${totalCount} reports shown.`
export const callbackContract = 'Callback contract'
export const callbackExtra = 'Callback / extra'
export const callbackGasLimit = 'Callback gas limit'
export const formatCurrentAmount1Label = (tokenSymbol: string) => `Current amount 1 (${tokenSymbol})`
export const formatCurrentAmount2Label = (tokenSymbol: string) => `Current amount 2 (${tokenSymbol})`
export const formatTokenPairSuffix = (token1Symbol: string, token2Symbol: string) => `${token1Symbol} / ${token2Symbol}`
// Report prices are quote tokens per base token, matching the pool oracle's REP per ETH direction.
export const formatReportPriceUnit = (token1Symbol: string, token2Symbol: string) => `${token2Symbol} per ${token1Symbol}`
export const formatReportBrowseTitle = (token1Symbol: string, token2Symbol: string, reportId: string) => `${token1Symbol} / ${token2Symbol} · report #${reportId}`
export const createAnother = 'Create another'
export const createReport = 'Create report'
export const reportCreated = 'Report created'
export const createStandaloneOracleGame = 'Create standalone oracle report'
export const creating = 'Creating…'
export const reportAtAGlance = 'Report at a glance'
export const nextStep = 'Next step'
export const currentPrice = 'Current price'
export const currentReportState = 'Current report state'
export const currentReporter = 'Current reporter'
export const submittingDispute = 'Submitting dispute…'
export const disputingTheReport = 'disputing the report'
export const disputeOccurred = 'Dispute occurred'
export const disputeWalletRequiredReason = commonCopy.formatConnectWalletBefore('disputing the report')
export const settlementWalletRequiredReason = commonCopy.formatConnectWalletBefore('settling the report')
export const economics = 'Economics'
export const formatDisputeAmountsInvalidReason = (tokenSymbol: string) => `Enter valid dispute amounts before approving ${tokenSymbol}.`
export const disputeEscalationStopAmountHelpText = 'Base-token amount that ends escalation.'
export const creationFundingRequirementHelpText = 'ETH funding, including the settler reward.'
export const ethValueToSend = 'ETH value to send'
export const formatExactTokenRequiredLabel = (tokenSymbol: string) => `Exact ${tokenSymbol} required`
export const initialToken1AmountHelpText = 'Base-token amount to report.'
export const exactToken1Report = 'Base token amount'
export const initialToken2Amount = 'Quote token amount'
export const initialToken2AmountHelpText = 'Quote-token amount to report.'
export const identity = 'Identity'
export const initialEconomics = 'Initial economics'
export const lastReportOpportunity = 'Last report opportunity'
export const reportLoadRequired = 'Select a report first.'
export const escalationMultiplierHelpText = 'Dispute escalation multiplier.'
export const formatNewAmountMustBeExactDetail = (tokenSymbol: string, amount: string) => `New ${tokenSymbol} amount must be exactly ${amount} for this dispute.`
export const formatNewAmountRangeDetail = (tokenSymbol: string, minimumAmount: string, maximumAmount: string) => `New ${tokenSymbol} amount must be between ${minimumAmount} and ${maximumAmount} for this dispute.`
export const oracleBalances = 'Your oracle balances'
export const oracleBalancesDetail = 'Settlement rewards, returned report liquidity, and dispute proceeds stay in the oracle until the credited account withdraws them.'
export const noOracleBalances = 'No withdrawable oracle balances are available for this token pair.'
export const noWithdrawableBalanceForAsset = 'No withdrawable balance is available for this asset.'
export const loadingOracleBalances = 'Loading oracle balances…'
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
	if (!timeType) return `Settle in ${remaining} block${remaining === 1n ? '' : 's'}`
	if (remaining < 60n) return `Settle in ${remaining}s`
	if (remaining < 3600n) return `Settle in ${remaining / 60n}m ${remaining % 60n}s`
	return `Settle in ${remaining / 3600n}h ${(remaining % 3600n) / 60n}m ${remaining % 60n}s`
}
export const searchReports = 'Search reports'
export const reportSearchPlaceholder = 'Report ID, token symbol, or token address'
export const noFavoriteReports = 'No favorite reports yet'
export const noFavoriteReportsDetail = 'Search a report ID. Reports you open are saved here.'
export const formatOpenReportById = (reportId: CopyTemplateValue) => `Open report #${reportId}`
export const formatReportUpdated = (relativeTime: CopyTemplateValue) => `Updated ${relativeTime}`
export const settlingReport = 'Settling report…'
export const settlingReportTitle = 'Settling report'
export const reportSettled = 'Settled report'
export const settlerRewardHelpText = 'ETH paid to the settler.'
export const settlementSummary = 'Settlement summary'
export const settlementTimestamp = 'Settlement timestamp'
export const settlementBlock = 'Settlement block'
export const settlementTimestampOnConfirmation = 'Recorded on confirmation'
export const notSettled = 'Not settled'
export const stateHash = 'State hash'
export const allStatuses = 'All statuses'
export const disputed = 'Disputed'
export const reportFiltersEmpty = 'No favorite reports match the current search and status filters.'
export const refreshReport = 'Refresh report'
export const reportAmounts = 'Report amounts'
export const openOracleReportDetails = 'OpenOracle report details'
export const standaloneOracleWarningDetail = 'Standalone only. Start pool-managed requests from a security pool.'
export const standaloneOracleIntroduction = 'Define the token pair and initial report economics first. Default dispute and timing settings are available below for users who need to tune the report lifecycle.'
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
export const standaloneParameterDetails = 'Exact report and escalation-halt amounts use base-token decimals. ETH funding must cover required funding and the settler reward. Dispute settings determine escalation timing and economics.'

export const settleReportTitle = (id: bigint) => `Settle report #${id}`

export const settledReportNumber = (id: string) => `Settled report #${id}`

export const settleReport = 'Settle report'

export const priceExpired = 'Price expired'
export const settledAfterPriceExpired = 'Settled after price expired'
export const staleSettlementWarning = 'Settlement will clear this report, but the pool will reject its price.'
export const staleSettledReportWarning = 'Request a new price.'
export const expiredReportPrice = 'This report’s price has expired.'
export const reportPriceRejected = 'Report settled; price rejected'
export const poolPriceAccepted = 'Pool accepted this price.'

export function formatPriceSettlementRejection(reason: string) {
	return reason === 'Report stale' ? 'Price expired before settlement. Request a new price.' : `Pool rejected this price: ${reason}. Request a new price.`
}

export const priceExpiredDuringReview = 'Price expired while reviewing. Review settlement again; the pool will reject this price.'
export const priceSettlementUnconfirmed = 'Report settled; price acceptance unconfirmed'
export const priceSettlementUnconfirmedDetail = 'The pool did not confirm accepting this price. Check the pool oracle before using it.'
