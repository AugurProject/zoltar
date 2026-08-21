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
export const disconnectWallet = 'Disconnect wallet'
export const connectWallet = 'Connect wallet'
export const selectUniverse = 'Select universe'
export const unavailable = 'Unavailable'
export const connectedWalletBalances = 'Connected wallet balances'
export const loadingBalances = 'Loading balances…'
export const eth = 'ETH'
export const rep = 'REP'
export const connectedAccount = 'Connected account'
export const walletBalances = 'Wallet balances'
export const balancesUnavailable = 'Balances unavailable'
const walletBalanceReadFailed = 'wallet balance read failed'
export const retry = 'Retry'
export const loadingWalletBalances = 'Loading wallet ETH and current-universe REP balances'
export const genesisUniverse = 'Genesis universe'
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
export const marketGuideSteps = [
	{
		number: '01',
		title: 'Create a complete set',
		description: 'Your ETH is sent to the selected Statoblast security pool, which creates equal amounts of INVALID, YES, and NO at its current exchange rate.',
	},
	{
		number: '02',
		title: 'Trade one direction',
		description: 'The opposite share enters the constant-product pair. You receive extra shares of your selected outcome.',
	},
	{
		number: '03',
		title: 'Retain INVALID',
		description: 'Matching INVALID stays in your wallet and is required alongside YES and NO to redeem a complete set.',
	},
	{
		number: '04',
		title: 'Exit a covered amount',
		description: 'The router buys the missing opposite share, combines a full set, and redeems current collateral value to ETH.',
	},
] as const
export const priceMeaningTitle = 'What the price means'
export const priceMeaningDescription = 'Conditional YES and NO prices sum to 100% because the pair compares only valid outcomes. This does not say INVALID has zero probability; the AMM has no invalidity estimate at all.'
export const remainingSharesTitle = 'Why profit can remain as shares'
export const remainingSharesDescription =
	'An insured ETH exit requires one INVALID for every complete set redeemed. If a profitable position contains more directional shares than matching INVALID, the excess remains transferable but cannot be converted into complete sets without acquiring more INVALID. After resolution, those excess shares redeem collateral only if their outcome won.'

export function documentTitle(pageTitle: string) {
	return `${pageTitle} · ${appName}`
}

export function disconnectWalletLabel(account: string) {
	return `${disconnectWallet} ${account}`
}

export function walletBalanceError(errorLabel: string | undefined, error: string | undefined) {
	return `${errorLabel ?? balancesUnavailable}: ${error ?? walletBalanceReadFailed}`
}

export function universeLabel(id: string) {
	return `Universe ${id}`
}
