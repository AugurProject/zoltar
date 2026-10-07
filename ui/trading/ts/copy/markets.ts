import type { CoarseDuration } from '../lib/marketListing.js'
import { liquidity } from './app.js'
import { no, yes } from './outcomes.js'

function durationText(duration: CoarseDuration) {
	if (duration.unit === 'minute' && duration.amount === 0n) return 'under a minute'
	return `${duration.amount.toString()} ${duration.unit}${duration.amount === 1n ? '' : 's'}`
}

function formatOutcomePrice(outcome: string, percent: number) {
	return `${outcome} ${percent.toString()}%`
}

export const marketsCopy = {
	yes,
	no,
	formatOutcomePrice,
	buyOutcomeAt: (outcome: string, percent: number) => `Buy ${outcome} at a conditional ${percent.toString()}%`,
	conditionalPrice: 'Conditional price',
	formatConditionalPrices: (yesPercent: number, noPercent: number) => `Conditional price: ${formatOutcomePrice(yes, yesPercent)}, ${formatOutcomePrice(no, noPercent)}`,
	priceUnavailable: 'The conditional price appears once the market has liquidity.',
	liquidity,
	closes: 'Closes',
	ended: 'Ended',
	closesIn: (duration: CoarseDuration) => `in ${durationText(duration)}`,
	endedAgo: (duration: CoarseDuration) => `${durationText(duration)} ago`,
	listControls: 'Market list controls',
	searchLabel: 'Search markets',
	searchPoolsLabel: 'Search security pools',
	searchPlaceholder: 'Search or paste a security pool address',
	filterLabel: 'Status filter',
	filterAll: 'All',
	filterOpen: 'Open',
	closingSoon: 'Closing soon',
	resolved: 'Resolved',
	sortLabel: 'Sort',
	resultCount: (shown: number, loaded: number) => (shown === loaded ? `${loaded.toString()} ${loaded === 1 ? 'market' : 'markets'}` : `${shown.toString()} of ${loaded.toString()} markets`),
	poolResultCount: (shown: number, loaded: number) => (shown === loaded ? `${loaded.toString()} ${loaded === 1 ? 'security pool' : 'security pools'}` : `${shown.toString()} of ${loaded.toString()} security pools`),
	clearFilters: 'Clear filters',
	questionDescription: 'Question description',
	noQuestionDescription: 'This question has no description.',
	contracts: 'Contracts',
	yourPosition: 'Your position',
	/** A balance ShareToken.migrate locked in the parent universe after a fork; it stays in the wallet but cannot be transferred. */
	lockedAfterMigration: 'Locked after migration',
	connectToSeePosition: 'Connect a wallet to see your position',
	allMarkets: 'All markets',
	shareToken: 'Share token',
	ticket: 'Trade ticket',
	poolNotInUniverse: 'Security pool not in this universe',
	poolNotInUniverseDetail: 'Switch universe to open it, or return to Markets.',
	switchUniverse: 'Switch universe',
} as const
