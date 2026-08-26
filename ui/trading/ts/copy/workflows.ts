export const tradeSummary = 'Trade summary'
export const youPay = 'You pay'
export const youReceive = 'You receive'
export const youUse = 'You use'
export const invalidReceived = 'INVALID received'
export const invalidRequired = 'INVALID required'
export const tradingFee = 'Trading fee'
export const transaction = 'Transaction'
export const liquidityTransaction = 'Liquidity transaction'
export const approveExactLp = 'Approve exact LP amount'
export const approvingExactLp = 'Approving exact LP amount…'
export const simulateLiquidity = 'Simulate liquidity transaction'
export const simulatingLiquidity = 'Simulating liquidity transaction…'
export const submitLiquidity = 'Submit liquidity transaction'
export const submittingLiquidity = 'Submitting liquidity transaction…'
export const approveSettlement = 'Approve router for complete-set redemption'
export const approveOutcomeTokens = 'Approve router for all outcome tokens'
export const approvingRouter = 'Approving router…'
export const simulateSettlement = 'Simulate authoritative settlement'
export const simulatingSettlement = 'Simulating authoritative settlement…'
export const submitSettlement = 'Submit settlement transaction'
export const submittingSettlement = 'Submitting settlement transaction…'
export const previewTrade = 'Preview trade'
export const submittingTrade = 'Submitting trade…'
export const erc1155ApprovalScopeWarning = "This ERC-1155 approval covers every token ID in the pool's share token, including other universe branches. Revoke it through a compatible wallet or share-token contract interface when it is no longer needed."
export const unsupportedOnchainTimestamp = 'Unsupported on-chain timestamp'
export const timestamp = 'Timestamp'
export const utc = 'UTC'
export const timestampFormattingFailed = 'Timestamp formatting failed'
export const defaultTransactionAction = 'Transaction'
export const simulatingRouterCall = 'Simulating router call…'
export const authoritativeSimulationReady = 'Fresh authoritative simulation ready'
export const transactionWorkflowNeedsAttention = 'Transaction workflow needs attention'
export const readyToSimulate = 'Ready to simulate after wallet balances and inputs are valid'
export const transactionProtection = 'Transaction protection'
export const slippageTolerance = 'Slippage tolerance'
export const percent = '%'
export const slippageValidation = 'Enter 0% to 5%, with at most two decimal places.'
export const transactionValidFor = 'Transaction valid for'
export const minutes = 'minutes'
export const validityValidation = 'Enter a whole number from 1 to 1440 minutes.'
export const transactionProtectionGuidance = 'Lower slippage allows less adverse movement from the simulated quote. A shorter validity window reduces stale-transaction exposure. Either setting can cause more reverts.'
export const retryBalances = 'Retry balances'
export const walletYes = 'Wallet YES'
export const walletNo = 'Wallet NO'
export const walletInvalid = 'Wallet INVALID'
export const refreshingWalletBalances = 'Refreshing wallet balances and approvals…'
export const balanceRefreshFailed = 'Balance refresh failed.'
export const livePositionOperation = 'Live position operation'
export const enter = 'Enter'
export const exit = 'Exit'
export const outcome = 'Outcome'
export const yes = 'YES'
export const no = 'NO'
export const invalid = 'INVALID'
export const ethAmount = 'ETH amount'
export const completeSetSharesToRedeem = 'Complete-set shares to redeem'
export const eth = 'ETH'
export const shares = 'shares'
export const poolAndReserveDetails = 'Pool and reserve details'
export const submittedEthPoolPrefix = 'Submitted ETH goes to Statoblast security pool'
export const submittedEthPoolSuffix = 'That exact pool reconciles collateral and mints complete-set shares at its live rate.'
export const yesReserve = 'YES reserve'
export const noReserve = 'NO reserve'
export const fullTradeBreakdown = 'Full trade breakdown'
export const simulationBlock = 'Simulation block'
export const completeSetShares = 'Complete-set shares'
export const oppositeOutcomeSwapped = 'Opposite outcome swapped'
export const invalidRequiredUppercase = 'INVALID required'
export const estimatedEthOut = 'Estimated ETH out'
export const ammFee = 'AMM fee'
export const averageEthPerLongShare = 'Average ETH per long share'
export const minimumEthReceived = 'Minimum ETH received'
export const simulatedCompleteSetRate = 'Simulated effective complete-set rate'
export const deadline = 'Deadline'
export const conditionalYesBeforeAfter = 'Conditional YES before / after'
export const conditionalYesPriceImpact = 'Conditional YES price impact'
export const unavailableMetric = '—'
export const positiveSign = '+'
export const percentagePoints = 'percentage points'

export function enterOutcome(outcome: 'YES' | 'NO') {
	return `Enter ${outcome}`
}

export function exitInsuredOutcome(outcome: 'YES' | 'NO') {
	return `Exit insured ${outcome}`
}

export function insuredOutcomeExit(outcome: 'YES' | 'NO') {
	return `Insured ${outcome} exit`
}

export function walletBalancesUnavailable(reason: string) {
	return `Wallet balances are unavailable; retry before simulating. ${reason}`
}

export function maximumInsuredExit(outcome: 'YES' | 'NO', amount: string) {
	return `Maximum insured ${outcome} exit: ${amount}.`
}

export function outcomeSwapped(outcome: 'YES' | 'NO') {
	return `${outcome} swapped`
}

export function additionalOutcomeReceived(outcome: 'YES' | 'NO') {
	return `Additional ${outcome} received`
}

export function totalOutcomeRequired(outcome: 'YES' | 'NO') {
	return `Total ${outcome} required`
}

export function totalOutcomeDelivered(outcome: 'YES' | 'NO') {
	return `Total ${outcome} delivered`
}

export function minimumOutcomeReceived(outcome: 'YES' | 'NO') {
	return `Minimum ${outcome} received`
}

export function maximumOutcomeRequired(outcome: 'YES' | 'NO') {
	return `Maximum ${outcome} required`
}

export function timestampFormattingFailedDetail(message: string) {
	return `${timestampFormattingFailed}: ${message}`
}

export function preparingAction(action: string) {
	return `Preparing ${action}…`
}

export function actionApprovalPendingInWallet(action: string) {
	return `${action} approval pending in wallet…`
}

export function actionApprovalPendingOnchain(action: string) {
	return `${action} approval pending on-chain…`
}

export function actionApprovalConfirmedOnchain(action: string) {
	return `${action} approval confirmed on-chain`
}

export function actionPendingInWallet(action: string) {
	return `${action} pending in wallet…`
}

export function actionPendingOnchain(action: string) {
	return `${action} pending on-chain…`
}

export function actionConfirmedOnchain(action: string) {
	return `${action} confirmed on-chain`
}

export function migrationSubmission(count: number) {
	return `Submit migration to ${count.toString()} child ${count === 1 ? 'branch' : 'branches'}`
}

export function simulatingTrade(mode: 'entry' | 'exit', side: 'YES' | 'NO') {
	return `Simulating ${mode === 'entry' ? `Enter ${side}` : `insured ${side} exit`}…`
}
