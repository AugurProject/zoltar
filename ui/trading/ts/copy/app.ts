export const appName = 'Statoblast trading'
export const appHomeLabel = 'Statoblast trading home'
export const brandMark = 'S'
export const primaryNavigationLabel = 'Primary'
export const markets = 'Markets'
export const market = 'Market'
export const liquidity = 'Liquidity'
export const portfolio = 'Portfolio'
export const deploy = 'Deploy'
export const help = 'Help'
export const securityPool = 'Security pool'
export const notFound = 'Not found'
export const pageNotFound = 'Page not found'
export const returnToMarkets = 'Return to markets'
export const backToMarkets = '← Markets'
export const unavailablePool = 'This security pool is not available in the selected universe.'
export const loadingMarkets = 'Loading markets'
export const loadingMarketsDescription = 'Reading the current factory index, lifecycle state, and pair reserves…'
export const disconnectWallet = 'Disconnect wallet'
export const connectWallet = 'Connect wallet'
export const positionsByPool = 'Positions by SecurityPool'
export const standaloneLiveClient = 'Standalone live client'
export const contractsUnavailable = 'Trading contracts unavailable'
export const checkingContracts = 'Checking deterministic trading contracts…'
export const poolDataUnavailable = 'Pool data unavailable'
export const separateInvalidAccounting = 'Separate INVALID accounting'
export const liquidityDescription = 'LP tokens represent only YES and NO reserves.'
export const removalPreview = 'Removal preview'
export const projectGuide = 'Project guide'
export const marketGuide = 'How the market works'
export const deploymentDescription = 'Deploy and verify the shared deterministic contracts that back the application.'

export function documentTitle(pageTitle: string) {
	return `${pageTitle} · ${appName}`
}

export function disconnectWalletLabel(account: string) {
	return `${disconnectWallet} ${account}`
}
