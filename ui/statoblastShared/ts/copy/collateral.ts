export const fallback = 'Collateral'
export const token = 'token'
export const selector = 'Collateral token'
export const weth = 'WETH'
export const usdc = 'USDC'
export const usdt = 'USDT'
export const wallet = 'Wallet collateral'
export const reset = 'Reset USDT approval'
export const resetting = 'Resetting approval…'
export const notNeeded = 'Not needed'
export const approving = 'Approving collateral…'
export const floorHint = 'Reports also need an exposure-based stake. This floor does not automatically cover dispute gas costs.'
export const amount = (label: string, symbol: string) => `${label} (${symbol})`
export const oracleStake = (symbol: string) => amount('Minimum oracle stake', symbol)
export const purchaseFee = (symbol: string) => amount('Minimum purchase fee', symbol)
export const commitment = (symbol: string) => amount('Minimum commitment', symbol)
export const reportStake = (symbol: string) => amount('Report stake', symbol)
export const minimumReportStake = (symbol: string) => amount('Minimum report stake', symbol)
export const walletBalance = (symbol: string) => `Wallet ${symbol}`
export const released = (symbol: string) => `Released ${symbol}`
