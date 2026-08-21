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

export function migrationSubmission(count: number) {
	return `Submit migration to ${count.toString()} child ${count === 1 ? 'branch' : 'branches'}`
}

export function simulatingTrade(mode: 'entry' | 'exit', side: 'YES' | 'NO') {
	return `Simulating ${mode === 'entry' ? `Enter ${side}` : `insured ${side} exit`}…`
}
