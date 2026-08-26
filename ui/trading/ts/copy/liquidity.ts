export const sectionTitle = 'Live liquidity'
export const disconnectedGuidance = 'Connect a wallet to load balances and simulate liquidity transactions.'
export const loadingBalancesStatus = 'Refreshing wallet balances and LP allowance…'
export const balanceRefreshFallback = 'balance refresh failed'
export const operationLabel = 'Liquidity operation'
export const initializeAction = 'Initialize'
export const addAction = 'Add'
export const removeAction = 'Remove'
export const lpTokenAmount = 'LP tokens'
export const ethAmount = 'ETH amount'
export const lp = 'LP'
export const eth = 'ETH'
export const conditionalYesPrice = 'Conditional YES price'
export const percent = '%'
export const conditionalYesPriceValidation = 'Enter a Conditional YES price above 0% and below 100%, with at most two decimal places.'
export const removalGuidance = 'Removal returns raw YES and NO. It never consumes wallet INVALID.'
export const additionGuidance = 'All INVALID and unused directional shares return to the wallet; LP tokens do not include wallet INVALID.'
export const slippageTolerance = 'Slippage tolerance'
export const deadline = 'Deadline'
export const rawYesReturned = 'Raw YES returned'
export const rawNoReturned = 'Raw NO returned'
export const completeSetSharesCreated = 'Complete-set shares created'
export const simulatedCompleteSetRate = 'Simulated effective complete-set rate'
export const sharesDeposited = 'YES / NO deposited'
export const unusedSharesReturned = 'Unused YES / NO returned'
export const invalidRetained = 'INVALID retained'
export const lpTokensExpected = 'LP tokens expected'
export const yes = 'YES'
export const no = 'NO'
export const invalid = 'INVALID'

export function balancesUnavailable(reason: string) {
	return `Wallet balances and LP allowance are unavailable: ${reason}.`
}

export function simulationBlock(blockNumber: bigint) {
	return `Authoritative router simulation at block ${blockNumber.toString()}.`
}
