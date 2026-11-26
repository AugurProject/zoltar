import type { CoarseDuration } from '../lib/marketListing.js'
import { liquidity } from './app.js'
import { no, yes } from './outcomes.js'
import { probabilityCopy } from './probability.js'

function durationText(duration: CoarseDuration) {
	if (duration.unit === 'minute' && duration.amount === 0n) return 'under a minute'
	return `${duration.amount.toString()} ${duration.unit}${duration.amount === 1n ? '' : 's'}`
}

/** Prices show one decimal everywhere, matching the market page's probability bar. */
function formatPercent(percent: number) {
	return percent.toFixed(1)
}

function formatOutcomePrice(outcome: string, percent: number) {
	return `${outcome} ${formatPercent(percent)}%`
}

export const marketsCopy = {
	yes,
	no,
	formatOutcomePrice,
	buyOutcomeAt: (outcome: string, percent: number) => `Buy ${outcome}: ${formatPercent(percent)}%, the price if not Invalid`,
	/** Captions the Yes / No prices with what they are conditional on; a market that stopped trading shows its last price. */
	conditionalPrice: probabilityCopy.priceIfNotInvalid,
	lastConditionalPrice: probabilityCopy.lastPriceIfNotInvalid,
	formatConditionalPrices: (caption: string, yesPercent: number, noPercent: number) => `${caption}: ${formatOutcomePrice(yes, yesPercent)}, ${formatOutcomePrice(no, noPercent)}`,
	priceUnavailable: 'The price appears once the market has liquidity.',
	/** Replaces the price on a resolved market, whose shares now pay out by outcome instead of trading. */
	finalOutcome: 'Final outcome',
	liquidity,
	liquiditySort: 'Liquidity (collateral units)',
	closes: 'Closes',
	ended: 'Ended',
	closesIn: (duration: CoarseDuration) => `in ${durationText(duration)}`,
	endedAgo: (duration: CoarseDuration) => `${durationText(duration)} ago`,
	listControls: 'Market list controls',
	searchLabel: 'Search markets',
	searchPoolsLabel: 'Search questions',
	searchPlaceholder: 'Search or paste address',
	filterLabel: 'Status filter',
	filterAll: 'All',
	filterOpen: 'Open',
	closingSoon: 'Closing soon',
	resolved: 'Resolved',
	sortLabel: 'Sort',
	resultCount: (shown: number, loaded: number) => (shown === loaded ? `${loaded.toString()} ${loaded === 1 ? 'market' : 'markets'}` : `${shown.toString()} of ${loaded.toString()} markets`),
	poolResultCount: (shown: number, loaded: number) => (shown === loaded ? `${loaded.toString()} ${loaded === 1 ? 'question' : 'questions'}` : `${shown.toString()} of ${loaded.toString()} questions`),
	clearFilters: 'Clear filters',
	/** The market list pages through every market the registry lists in the selected universe; favorites lead it. */
	otherMarkets: 'Other markets',
	loadingMarkets: 'Loading markets…',
	noMarketsInUniverse: 'No markets in this universe yet',
	noMarketsInUniverseDetail: 'Create one from a registered question, or paste a question ledger address above.',
	registryFailedLead: 'Market discovery failed',
	pageRange: (first: bigint, last: bigint, total: bigint) => `Markets ${first.toString()}–${last.toString()} of ${total.toString()}`,
	questionDescription: 'Question description',
	noQuestionDescription: 'This question has no description.',
	contracts: 'Contracts',
	yourPosition: 'Your position',
	/** Source shares remain held when migration or source-backed recovery locks transfers. */
	transfersLocked: 'Transfers locked',
	connectToSeePosition: 'Connect a wallet to see your position',
	allMarkets: 'All markets',
	shareToken: 'Share token',
	ticket: 'Trade ticket',
	poolNotInUniverse: 'Question not in this universe',
	poolNotInUniverseDetail: 'Switch universe to open it, or return to Markets.',
	switchUniverse: 'Switch universe',
	defaultOrder: 'Default order',
} as const
