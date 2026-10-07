import { endSentence } from '../lib/format.js'

export const appName = 'Statoblast Trading'
export const market = 'Market'
export const markets = 'Markets'
export const create = 'Create'
export const liquidity = 'Liquidity'
export const portfolio = 'Portfolio'
export { changeWallet, disconnectWallet, sectionRequiresDeployment } from '@zoltar/ui-core-shared/copy/app.js'
import { disconnectWallet } from '@zoltar/ui-core-shared/copy/app.js'
export { universe } from '@zoltar/ui-core-shared/copy/common.js'
export { connectWallet, deploy, loadingWithEllipsis, notDeployed, notFound, retry, unavailable } from '@zoltar/ui-core-shared/copy/common.js'
export const help = 'Help'
export const universeUnavailable = 'Unable to load the universe.'
export function universeNotFound(label: string) {
	return `${label} is not deployed on this network.`
}
export const securityPool = 'Security pool'
export const loadingBalances = 'Loading balances…'
/** The one phrase every Trading surface uses when wallet balances cannot be read. */
export const walletBalancesUnavailable = 'Wallet balances unavailable'
export const loadingWalletBalance = 'Loading wallet ETH balance…'
export const loadingContracts = 'Loading trading contracts…'
export const marketRouteDescription = 'Trade conditional Yes and No shares backed by Statoblast security pools.'
export const liquidityRouteDescription = 'Open a market by security pool address to add or remove liquidity.'
export const createMarketRouteDescription = 'Open a security pool without a market to create its market and add the first liquidity.'
export const universeRouteDescription = 'Markets, Portfolio, and Create follow this universe. After it forks, its child universes are listed here.'
export const securityPoolRouteDescription = 'Identity, lifecycle, and capacity of the security pool that backs this market.'
export const deployRouteDescription = 'Deploy the trading factory and router that this interface uses.'
export const marketGuideDescription = 'How trades, prices, and payouts work in a conditional market, and where to start each task.'
export const marketWorkspaceViews = 'Market views'
export const trade = 'Trade'
export const settlement = 'Settlement'
export const deploymentUnverified = 'Deployment unverified'
export const tradingContractsUnreachable = 'Cannot verify the trading contracts'
export const tradingContractsUnreachableFallback = 'The trading RPC did not respond.'
export const tradingContractsUnreachableHint = 'Check the RPC in Settings, then retry.'
/** The deployment list is a static file served with the app; the RPC setting cannot fix a failed download. */
export const deploymentRegistryUnavailable = 'The deployment list could not be downloaded. Check your connection, then retry.'
export const checkingDeployment = 'Checking deployment…'
export const connectingWallet = 'Connecting wallet…'
export const securityPoolFactoryNotDeployed = 'Security pool factory is not deployed'
export const checkingContract = 'Checking…'
export const securityPoolDataUnavailable = 'Security pool data unavailable'
export const marketGuideStepsTitle = 'How a trade works'
export const marketGuideSteps = [
	{
		number: '01',
		title: 'Create a complete set',
		description: 'Your ETH is sent to the selected Statoblast security pool, which creates equal amounts of Yes, No, and Invalid shares at its current collateral rate.',
	},
	{
		number: '02',
		title: 'Trade one direction',
		description: 'The opposite share enters the trading pool. You receive extra shares of your selected outcome.',
	},
	{
		number: '03',
		title: 'Retain Invalid shares',
		description: 'Matching Invalid shares stay in your wallet and are required alongside Yes and No to redeem a complete set.',
	},
	{
		number: '04',
		title: 'Exit an insured amount',
		description: 'The router buys the missing opposite share, combines a complete set, and redeems it for ETH at the current collateral rate.',
	},
] as const
export const priceMeaningTitle = 'What the price means'
export const priceMeaningDescription = 'Conditional Yes and No prices sum to 100% because the trading pool compares only valid outcomes. This does not say Invalid has zero probability; the trading pool has no invalidity estimate at all.'
export const shareValueTitle = 'How share amounts are shown'
export const shareValueDescription =
	'Token quantities stay unchanged as holding fees reduce their ETH backing. A complete set contains equal amounts of Yes, No, and Invalid and redeems at the current collateral rate. An individual outcome pays that amount only if the question resolves to it, and pays 0 ETH otherwise. ETH values shown for outcomes are conditional payouts, not sale quotes. LP quantities represent a share of the trading pool; their underlying Yes and No claims are shown separately. Deposit and redemption inputs use ETH; LP removal inputs use LP quantities.'
export const pricesAndPayoutsTitle = 'Prices and payouts'
export const tasksTitle = 'Common tasks'
export const findMarketTitle = 'Find a market'
export const findMarketDescription = 'Markets and Portfolio list only markets opened in this browser. Copy a security pool address from Statoblast and paste it into the Markets search to open its market.'
export const findMarketLink = 'Guide: find a market'
export const createMarketTitle = 'Create a market'
export const createMarketDescription = 'Open a security pool without a market under Create, then add the first liquidity at your conditional Yes price.'
export const createMarketLink = 'Guide: your first market'
export const afterTradingTitle = 'After resolution or a fork'
export const afterTradingDescription = 'When trading ends, a market’s Settlement view redeems your shares, or migrates them to a child universe after a fork.'
export const resolutionLink = 'Guide: after resolution'
export const forkLink = 'Guide: after a fork'
export const remainingSharesTitle = 'Why profit can remain as shares'
export const remainingSharesDescription =
	'An insured ETH exit requires one Invalid share for every complete set redeemed. If a profitable position contains more directional shares than matching Invalid shares, the excess remains transferable but cannot be converted into complete sets without acquiring more Invalid shares. After resolution, those excess shares redeem collateral only if the question resolved to their outcome.'

export function documentTitle(pageTitle: string) {
	return `${pageTitle} · ${appName}`
}

/** A market's page names its question first, so browser tabs and history tell markets apart. */
export function marketPageTitle(marketTitle: string, pageTitle: string) {
	return `${marketTitle} · ${pageTitle}`
}

export function disconnectWalletLabel(account: string) {
	return `${disconnectWallet} ${account}`
}

/** The one format every Trading surface uses to report a failed wallet balance read, with its cause when one is known. */
export function formatWalletBalancesUnavailable(reason: string | undefined) {
	return reason === undefined ? `${walletBalancesUnavailable}.` : `${walletBalancesUnavailable}: ${endSentence(reason)}`
}

/** Accessible name for the header notice, whose visible text is only the label. */
export function formatHeaderErrorLabel(errorLabel: string | undefined, error: string | undefined) {
	const label = errorLabel ?? walletBalancesUnavailable
	if (error === undefined) return `${label}.`
	// A redacted error is only its lead, which the label already states.
	return error.startsWith(label) ? endSentence(error) : `${label}: ${endSentence(error)}`
}

export function openSecurityPoolLabel(address: string) {
	return `Open security pool ${address}`
}

export const deploymentConfigurationInvalid = 'Deployment configuration invalid'
export const deploymentNotConfigured = 'Network or RPC not configured'
export const deploymentComplete = 'Deployment complete'

export const createMarket = 'Create market'
