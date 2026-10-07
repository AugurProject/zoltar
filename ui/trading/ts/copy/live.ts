import { forked, initialReportPriorityFee, operational, outcome } from '@zoltar/ui-core-shared/copy/common.js'
import * as appCopy from './app.js'
import { endSentence } from '../lib/format.js'
import { initializeLiquidityAction } from './liquidity.js'
import { marketDataUnavailable } from './marketBlockers.js'
import { tradingFee } from './tradeTicket.js'

const securityPoolDiscoveryFailedLead = 'Security pool discovery failed'
const universeDiscoveryFailedLead = 'Universe discovery failed'
const unknownDiscovery = 'unknown error'

function unknownSystemState(state: number) {
	return `Unknown state ${state.toString()}`
}

function unknownQuestionOutcome(outcome: number) {
	return `Unknown outcome ${outcome.toString()}`
}

/** `blocker` is the short market status, such as `Question ended`, that rules out the first liquidity. */
function formatInitializationUnavailable(blocker: string) {
	return `${endSentence(blocker)} This market can no longer be created.`
}

function formatMarketNotCreatedDetail(feePercent: string) {
	return `This security pool does not have a market yet. Creating the market and adding the first liquidity happen in one transaction. Trading fee: ${feePercent}%.`
}

function formatNoLiquidityDetail(feePercent: string) {
	return `This market needs its first liquidity before trading can open. Trading fee: ${feePercent}%.`
}

function securityPoolDetailsUnavailable(loadError: string, refreshError?: string) {
	return refreshError === undefined ? `Security pool details could not be loaded: ${endSentence(loadError)}` : `Security pool details could not be loaded: ${endSentence(loadError)} Latest retry failed: ${endSentence(refreshError)}`
}

function securityPoolRefreshFailed(refreshError: string) {
	return `Security pool refresh failed; showing the last successful result: ${endSentence(refreshError)}`
}

/** The lead a route's discovery failure is reported under: the universe route discovers universes, every other live route discovers security pools. */
function discoveryFailureLead(route: string) {
	return route === 'universe' ? universeDiscoveryFailedLead : securityPoolDiscoveryFailedLead
}

/** Composes a discovery failure under its lead; a detail that already carries the lead (a redacted error) is not prefixed twice. */
function describeDiscoveryFailure(lead: string, detail?: string) {
	if (detail === undefined) return `${lead}: ${endSentence(unknownDiscovery)}`
	return endSentence(detail.startsWith(lead) ? detail : `${lead}: ${detail}`)
}

function securityPoolDiscoveryFailed(error?: string) {
	return describeDiscoveryFailure(securityPoolDiscoveryFailedLead, error)
}

function securityPoolCouldNotLoad(error: string) {
	return `This security pool could not be loaded. Trading, liquidity, and settlement are unavailable until it loads: ${endSentence(error)}`
}

export const liveCopy = {
	securityPoolDoesNotExist: 'Security pool does not exist',
	backToCreateMarket: 'Back to create market',
	openSecurityPool: 'Open security pool',
	openMarket: 'Open market',
	marketDataUnavailable,
	marketNotCreated: 'Market not created',
	tradingOpen: 'Trading open',
	tradingClosed: 'Trading closed',
	universeForkedNotice: 'This universe has forked. Its markets no longer trade or take new liquidity. In each market’s Settlement view, holders of an unresolved market migrate their shares to a child universe, and holders of a resolved market redeem their winning shares.',
	viewChildUniverses: 'View child universes',
	marketCreated: 'Market created and liquidity added. Your LP tokens are listed under Your position.',
	noLiquidityYet: 'No liquidity yet',
	operational,
	poolForked: 'Security pool forked',
	forkMigration: 'Fork migration',
	forkTruthAuction: 'Fork truth auction',
	unresolvedOutcome: 'None (unresolved)',
	neverInitializedDetail: 'This market was never created, so it has no conditional price.',
	addFirstLiquidity: initializeLiquidityAction,
	refreshingSecurityPool: 'Refreshing security pool; showing the last successful result.',
	retryingSecurityPoolDetails: 'Retrying security pool details…',
	retryRefresh: 'Retry refresh',
	retrySecurityPool: 'Retry security pool',
	questionEnd: 'Question end',
	securityPoolState: 'Security pool state',
	universeFork: 'Universe fork',
	notForked: 'Not forked',
	outcome,
	securityMultiplier: 'Security multiplier',
	initialReportPriorityFee,
	registeredVaults: 'Registered vaults',
	retentionRatePerSecond: 'Retention rate per second',
	commitmentLimits: 'Total / fee-eligible commitment limit',
	mintingCapacity: 'Minting capacity',
	unknownDiscovery,
	loadingSecurityPoolDetails: 'Loading security pool details…',
	retryDiscovery: 'Retry discovery',
	discoveringSecurityPools: 'Discovering security pools…',
	noFavoritePools: 'No favorite security pools yet',
	noFavoritePoolsDetail: 'This list only shows security pools opened in this browser. Paste a security pool address from Statoblast above to open one.',
	noFavoriteMarkets: 'No favorite markets yet',
	noFavoriteMarketsDetail: 'This list only shows markets opened in this browser. Paste a security pool address above to open its market.',
	findMarketGuide: 'How to find a market',
	findSecurityPoolGuide: 'How to find a security pool',
	poolAddressRequired: 'Enter a full security pool address: 0x followed by 40 hexadecimal characters.',
	details: 'Details',
	securityPoolFacts: 'Security pool facts',
	parameters: 'Security pool parameters',
	securityPool: appCopy.securityPool,
	tradingPool: 'Trading pool',
	tradingFee,
	forked,
	unknownSystemState,
	unknownQuestionOutcome,
	formatInitializationUnavailable,
	formatMarketNotCreatedDetail,
	formatNoLiquidityDetail,
	securityPoolDetailsUnavailable,
	securityPoolRefreshFailed,
	securityPoolDiscoveryFailed,
	discoveryFailureLead,
	describeDiscoveryFailure,
	securityPoolCouldNotLoad,
} as const
