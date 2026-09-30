import type { CoarseDuration } from '../lib/marketListing.js'
import { no, yes } from './outcomes.js'

function durationText(duration: CoarseDuration) {
	if (duration.unit === 'minute' && duration.amount === 0n) return 'under a minute'
	return `${duration.amount.toString()} ${duration.unit}${duration.amount === 1n ? '' : 's'}`
}

function outcomeOdds(outcome: string, percent: number) {
	return `${outcome} ${percent.toString()}%`
}

export const marketsCopy = {
	sortRegistry: 'Registry order',
	yes,
	no,
	outcomeOdds,
	buyOutcomeAt: (outcome: string, percent: number) => `Buy ${outcome} at a conditional ${percent.toString()}%`,
	buyOutcome: (outcome: string) => `Buy ${outcome}`,
	conditionalOdds: 'Conditional odds',
	impliedOdds: (yesPercent: number, noPercent: number) => `Conditional odds: ${outcomeOdds(yes, yesPercent)}, ${outcomeOdds(no, noPercent)}`,
	oddsUnavailable: 'Odds appear once the pair holds liquidity.',
	liquidity: 'Liquidity',
	liquidityValue: (formatted: string) => `${formatted} ETH`,
	closes: 'Closes',
	ended: 'Ended',
	closesIn: (duration: CoarseDuration) => `in ${durationText(duration)}`,
	endedAgo: (duration: CoarseDuration) => `${durationText(duration)} ago`,
	listControls: 'Market list controls',
	searchLabel: 'Search markets',
	searchPlaceholder: 'Search downloaded markets',
	filterLabel: 'Market status filter',
	filterAll: 'All',
	filterOpen: 'Open',
	filterClosingSoon: 'Closing soon',
	filterResolved: 'Resolved',
	sortLabel: 'Sort',
	sortClosingSoon: 'Closing soon',
	sortLiquidity: 'Liquidity',
	resultCount: (shown: number, loaded: number) => (shown === loaded ? `${loaded.toString()} ${loaded === 1 ? 'market' : 'markets'}` : `${shown.toString()} of ${loaded.toString()} markets`),
	noMatches: 'No downloaded markets match.',
	discoverMarkets: 'Discover markets',
	marketsNoun: 'markets',
	clearFilters: 'Clear filters',
	questionDescription: 'Question description',
	noQuestionDescription: 'This question has no description.',
	contracts: 'Contracts',
	shareToken: 'Share token',
	ticket: 'Trade ticket',
	openTicket: (label: string) => `Open ${label.toLowerCase()}`,
	closeTicket: 'Close ticket',
} as const
