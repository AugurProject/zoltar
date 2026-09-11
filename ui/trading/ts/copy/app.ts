export const appName = 'Statoblast trading'
export const market = 'Market'
export const liquidity = 'Liquidity'
export const portfolio = 'Portfolio'
export { changeWallet, notConnected, hideEnvironmentDetails, showEnvironmentDetails } from '@zoltar/ui-core-shared/copy/app.js'
export { universe } from '@zoltar/ui-core-shared/copy/common.js'
export { connectWallet, deploy, eth, loadingWithEllipsis, rep, retry, unavailable } from '@zoltar/ui-core-shared/copy/common.js'
export const help = 'Help'
export const securityPool = 'Security pool'
export const notFound = 'Not found'
export const pageNotFound = 'Page not found'
export const returnToMarket = 'Return to market'
export const browseMarkets = 'Browse markets'
export const browseSecurityPools = 'Browse SecurityPools'
export const disconnectWallet = 'Disconnect wallet'
export const selectUniverse = 'Select universe'
export const connectedWalletBalances = 'Connected wallet balances'
export const loadingBalances = 'Loading balances…'
export const connectedAccount = 'Connected account'
export const balancesUnavailable = 'Balances unavailable'
const walletBalanceReadFailed = 'wallet balance read failed'
export const loadingWalletBalances = 'Loading wallet ETH and current-universe REP balances'
export const genesisUniverse = 'Genesis universe'
export const positionsByPool = 'Positions by SecurityPool'
export const standaloneLiveClient = 'Standalone live client'
export const loadingContracts = 'Loading trading contracts'
export const networkUnavailable = 'Network unavailable'
export const checkingDeployment = 'Checking deployment'
export const connectingWallet = 'Connecting wallet…'
export const securityPoolFactoryNotDeployed = 'SecurityPoolFactory is not deployed'
export const checkingContract = 'Checking'
export const poolDataUnavailable = 'Pool data unavailable'
export const projectGuide = 'Project guide'
export const marketGuide = 'How the market works'
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
export const shareValueTitle = 'How share amounts are shown'
export const shareValueDescription = 'YES, NO, INVALID, complete-set, and LP amounts are shown on one scale: the settlement-collateral value in ETH that the security pool currently assigns to that many shares, which is what a complete set redeems for or a winning share pays out. Amounts you enter use the same scale.'
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

export function openSecurityPoolLabel(address: string) {
	return `Open security pool ${address}`
}

export const invalidDeploymentSettings = 'Invalid deployment settings'
export const completeDeploymentSettings = 'Complete deployment settings'
export const deploymentComplete = 'Deployment complete'

export const createMarket = 'Create new market'
