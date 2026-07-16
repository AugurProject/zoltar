import * as commonCopy from './common.js'
import type { CopyTemplateValue } from './types.js'

export const disputeReport = 'Dispute Report'
export const settleReport = 'Settle Report'
export const submitInitialReport = 'Submit Initial Report'
export const disputeAndSwap = 'Dispute & Swap'
export const disputeDelay = 'Dispute Delay'
export const escalationHalt = 'Escalation Halt'
export const feePercentage = 'Fee Percentage'
export const price = 'Price'
export const protocolFee = 'Protocol Fee'
export const reportId = 'Report ID'
export const settlementTime = 'Settlement Time'
export const settlerReward = 'Settler Reward'
export const tokenPair = 'Token Pair'
export const standaloneOracleDescription = 'Direct Open Oracle creation for protocol testing. This bypasses pool-managed oracle-manager staging, so confirm addresses, token amounts, fees, and timing before submitting.'
export const openOracleGame = 'Open Oracle Game'
export const formatApprovingTokenPendingLabel = (tokenSymbol: string) => `Approving ${tokenSymbol}…`
export const browseReports = 'Browse Reports'
export const formatBrowseReportsDescription = (pageSize: string) => `Browse every Open Oracle game and open a selected report view. Page size is fixed at ${pageSize} reports.`
export const formatBrowseShownCountSummary = (shownCount: string, pageCount: string) => `${shownCount} of ${pageCount} reports shown on this page.`
export const callbackContract = 'Callback Contract'
export const callbackExtra = 'Callback / Extra'
export const callbackGasLimit = 'Callback Gas Limit'
export const formatCurrentAmount1Label = (tokenSymbol: string) => `Current Amount 1 (${tokenSymbol})`
export const formatCurrentAmount2Label = (tokenSymbol: string) => `Current Amount 2 (${tokenSymbol})`
export const formatTokenPairSuffix = (token1Symbol: string, token2Symbol: string) => commonCopy.formatPairSlash(token1Symbol, token2Symbol)
export const formatReportBrowseTitle = (token1Symbol: string, token2Symbol: string, reportId: string) => `${formatTokenPairSuffix(token1Symbol, token2Symbol)} · ${formatReportNumberTitle(reportId)}`
export const createAnother = 'Create Another'
export const createStandaloneOracleGame = 'Create Standalone Oracle Game'
export const creating = 'Creating…'
export const reportCreatedDetail = 'The report instance was created successfully.'
export const createSuccess = 'Create Success'
export const currentPrice = 'Current Price'
export const currentReportState = 'Current Report State'
export const currentReporter = 'Current Reporter'
export const noneAwaitingInitialReport = 'None (awaiting initial report)'
export const replacementSwapAmountsHint = 'Provide the replacement swap amounts for the selected report.'
export const submittingDispute = 'Submitting dispute…'
export const disputingTheReport = 'disputing the report'
export const disputeDelayHelpText = 'Delay in seconds after the initial report before disputes can begin.'
export const disputeOccurred = 'Dispute Occurred'
export const formatDisconnectedWalletApprovalReason = (tokenSymbol: string) => `Connect a wallet before approving ${tokenSymbol}.`
export const disputeWalletRequiredReason = 'Connect a wallet before disputing the report.'
export const settlementWalletRequiredReason = 'Connect a wallet before settling the report.'
export const initialReportWalletRequired = 'Connect a wallet before submitting the initial report.'
export const wrapEthWalletRequiredReason = 'Connect a wallet before wrapping ETH.'
export const economics = 'Economics'
export const formatDisputeAmountsInvalidReason = (tokenSymbol: string) => `Enter valid dispute amounts before approving ${tokenSymbol}.`
export const formatEnterValidPriceBeforeApprovingReason = (token1Symbol: string, token2Symbol: string) => `Enter a valid ${token1Symbol} / ${token2Symbol} price before approving ${token2Symbol}.`
export const disputeEscalationStopAmountHelpText = 'Token1 amount where dispute escalation stops, entered as a decimal value for the token1 address.'
export const creationFundingRequirementHelpText = 'ETH sent with creation; must cover required funding and the settler reward.'
export const ethValueToSend = 'ETH Value To Send'
export const formatExactTokenRequiredLabel = (tokenSymbol: string) => `Exact ${tokenSymbol} Required`
export const initialToken1AmountHelpText = 'Token1 amount to report, entered as a decimal value for the token1 address.'
export const exactToken1Report = 'Exact Token1 Report'
export const disputeFeeHelpText = 'Fee charged during dispute economics, entered as a percentage.'
export const fee = 'Fee'
export const fetchPriceFromUniswap = 'Fetch price from Uniswap'
export const fetching = 'Fetching…'
export const identity = 'Identity'
export const initialEconomics = 'Initial Economics'
export const reportContext = 'Report Context'
export const initialReportReviewHint = 'Review price source, approvals, and token balances before submitting the initial report.'
export const initialReport = 'Initial Report'
export const initialReporter = 'Initial Reporter'
export const submittingTheInitialReport = 'submitting the initial report'
export const lastReportOpportunity = 'Last Report Opportunity'
export const reportLoadError = 'Failed to load Open Oracle reports.'
export const reportLoadRequired = 'Load a report first.'
export const escalationMultiplierHelpText = 'Escalation multiplier for dispute economics.'
export const formatNewAmountMustBeExactDetail = (tokenSymbol: string, amount: string) => `New ${tokenSymbol} amount must be exactly ${amount} for this dispute.`
export const settledReportReadOnlyDetail = 'This report is settled. No write actions are available.'
export const numberOfReports = 'Number of Reports'
export const openReport = 'Open report'
export const oracleAddress = 'Oracle Address'
export const priceExample = '1.00'
export const formatPriceFieldLabel = (token1Symbol: string, token2Symbol: string) => `Price (${token1Symbol} / ${token2Symbol})`
export const priceSource = 'Price source:'
export const protocolFeeHelpText = 'Protocol fee charged during disputes, entered as a percentage.'
export const protocolFeeRecipient = 'Protocol Fee Recipient'
export const report = 'Report'
export const formatReportNumberTitle = (reportId: string) => commonCopy.formatReportNumberLabel(reportId)
export const reportTimestamp = 'Report Timestamp'
export const reportActions = 'Report Actions'
export const reportActionFlowHint = 'Open a focused action flow for the selected report when it is available.'
export const searchReports = 'Search Reports'
export const settlementConfirmationHelpText = 'Settlement is confirmation-first. Review the current report state and confirm only when the dispute window is closed.'
export const settlementConfirmationHint = 'Confirm settlement once the selected report is ready.'
export const settlingReport = 'Settling report…'
export const settledReport = 'Settled Report'
export const settlerRewardHelpText = 'ETH paid to the account that settles the report.'
export const settlementSummary = 'Settlement Summary'
export const settlementDelayHelpText = 'Delay in seconds after the initial report before settlement can begin.'
export const settlementTimestamp = 'Settlement Timestamp'
export const notSettled = 'Not settled'
export const stateHash = 'State Hash'
export const allStatuses = 'All statuses'
export const awaitingInitialReport = 'Awaiting initial report'
export const disputed = 'Disputed'
export const oracleGamesEmpty = 'No Open Oracle games found.'
export const reportFiltersEmpty = 'No reports match the current search and status filters.'
export const reportSummariesRefreshingDetail = 'Refreshing report summaries.'
export const refreshReport = 'Refresh report'
export const reportAmounts = 'Report Amounts'
export const openOracleReportDetails = 'Open Oracle Report Details'
export const searchByReportIdTokenSymbolOrTokenAddress = 'Search by report ID, token symbol, or token address'
export const staleQuoteWarning = 'This quote is stale and will be refreshed before submission.'
export const standaloneOracleWarningDetail = 'Use this only when you intend to create a standalone oracle game directly from the connected wallet. Pool-managed oracle requests should be started from a selected security pool.'
export const submitting = 'Submitting…'
export const formatTimingValue = (timingAmount: CopyTemplateValue, usesSeconds: boolean) => `${timingAmount} ${usesSeconds ? 's' : 'blocks'}`
export const timing = 'Timing'
export const formatQuoteLoadedDetail = (quoteBlockNumberText: string | undefined, ageText: string) => (quoteBlockNumberText === undefined ? `Quote loaded ${ageText}.` : `Quote loaded at block ${quoteBlockNumberText} ${ageText}.`)
export const formatQuoteAgeText = (quoteLoadedAtMs: number) => {
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - quoteLoadedAtMs) / 1000))
	if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`
	const elapsedMinutes = Math.floor(elapsedSeconds / 60)
	if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
	const elapsedHours = Math.floor(elapsedMinutes / 60)
	return `${elapsedHours}h ago`
}
export const baseTokenHelpText = 'Base token for the reported pair.'
export const token1Address = 'Token1 Address'
export const formatTokenApprovalTitle = (tokenSymbol: string) => `${tokenSymbol} Approval`
export const quoteTokenHelpText = 'Quote token for the reported pair.'
export const token2Address = 'Token2 Address'
export const tokenToSwapOut = 'Token to Swap Out'
export const trackDisputes = 'Track Disputes'
export const awaitingInitialReportLabel = 'Awaiting Initial Report'
export const formatNewTokenAmountFieldLabel = (tokenSymbol: string) => `New ${tokenSymbol} Amount`
export const need = 'Need'
export const wethShortfallTail = 'more WETH for this report.'
export const wrapNeededEthToWeth = 'Wrap needed ETH to WETH'
export const wrappingEth = 'Wrapping ETH…'
export const reporter = 'Reporter'
export const stage = 'Stage'
