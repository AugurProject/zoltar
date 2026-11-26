export const fallback = 'Collateral'
export const selector = 'Collateral token'
export const weth = 'WETH'
export const usdc = 'USDC'
export const wallet = 'Wallet collateral'
/** Why a collateral-funded action is blocked. Statoblast and Trading show the same reason for the same funding state. */
export const fundingLoading = 'Loading collateral balance and approval.'
export const approvalRequired = 'Collateral approval required.'
export const formatInsufficientBalance = (symbol: string) => `Insufficient ${symbol} balance.`
export const approvalFailed = 'Collateral approval failed.'
export const floorHint = 'Reports also need an exposure-based stake. This floor does not automatically cover dispute gas costs.'
const amount = (label: string, symbol: string) => `${label} (${symbol})`
export const purchaseFee = (symbol: string) => amount('Minimum purchase fee', symbol)
export const commitment = (symbol: string) => amount('Minimum commitment', symbol)
export const reportStake = (symbol: string) => amount('Report stake', symbol)
export const walletBalance = (symbol: string) => `Wallet ${symbol}`
export const released = (symbol: string) => `Released ${symbol}`
export const recoveryContribution = 'Recovery REP contribution'
export const maximumRecoveryContribution = 'Maximum recovery REP contribution'
export const insufficientRecoveryRep = 'Insufficient REP for the proportional recovery contribution.'
export const recoveryApprovalRequired = 'Recovery REP approval required.'
export const recoveryContributionHint = 'These complete sets include inherited REP. Your proportional contribution preserves existing holders’ backing.'
export const approvalPending = 'Wait for the current approval to finish.'

export const fundingReadFailed = 'Unable to load collateral funding.'
