import { describe, expect, test } from 'bun:test'
import { arrangeMarkets, coarseDuration, marketLiquidityAttoEth, marketOddsPercent, marketYesTenths, type MarketFilter } from '../../lib/marketListing.js'
import { hashWithoutTicketSide, marketTicketHref, readTicketSideParam } from '../../lib/ticketSide.js'
import type { LiveMarket } from '../../protocol/live.js'
import { FIXTURE_DAY, FIXTURE_NOW, fixtureAddress as address, liveMarketFixture as market } from '../support/liveMarketFixture.js'

const NOW = FIXTURE_NOW
const DAY = FIXTURE_DAY

describe('market odds and liquidity', () => {
	test('derives conditional YES odds from the reserves the same way the ticket does', () => {
		// YES is priced by the NO reserve share: a scarcer YES reserve means a likelier YES.
		const skewed = market({ pool: address('01'), yesReserve: 38n, noReserve: 62n })
		expect(marketYesTenths(skewed)).toBe(620)
		expect(marketOddsPercent(skewed)).toEqual({ yes: 62, no: 38 })
	})

	test('keeps whole-percent odds summing to 100 when rounding', () => {
		const odds = marketOddsPercent(market({ pool: address('01'), yesReserve: 1_000n - 625n, noReserve: 625n }))
		expect(odds).toEqual({ yes: 63, no: 37 })
		expect((odds?.yes ?? 0) + (odds?.no ?? 0)).toBe(100)
	})

	test('has no odds without a funded pair or authoritative data', () => {
		expect(marketOddsPercent(market({ pool: address('01'), pair: undefined }))).toBeUndefined()
		expect(marketOddsPercent(market({ pool: address('01'), yesReserve: 0n, noReserve: 0n }))).toBeUndefined()
		expect(marketOddsPercent(market({ pool: address('01'), loadError: 'unavailable' }))).toBeUndefined()
	})

	test('values the reserves at the pair spot price in settlement collateral', () => {
		// Genesis rate: 10^18 attoShares per attoETH. Balanced 1-token reserves are worth one token of collateral.
		expect(marketLiquidityAttoEth(market({ pool: address('01') }))).toBe(10n ** 18n)
		// 2·Y·N / (Y + N) with Y = 1, N = 3 tokens is 1.5 tokens.
		expect(marketLiquidityAttoEth(market({ pool: address('01'), yesReserve: 10n ** 36n, noReserve: 3n * 10n ** 36n }))).toBe(15n * 10n ** 17n)
		// Once collateral exists, the pool's own share rate applies.
		expect(marketLiquidityAttoEth(market({ pool: address('01'), shareTokenSupplyAttoShares: 4n * 10n ** 36n, settlementCollateralAttoEth: 2n * 10n ** 18n }))).toBe(5n * 10n ** 17n)
		expect(marketLiquidityAttoEth(market({ pool: address('01'), yesReserve: 0n, noReserve: 0n }))).toBe(0n)
		expect(marketLiquidityAttoEth(market({ pool: address('01'), pair: undefined }))).toBeUndefined()
	})
})

describe('market filters and search', () => {
	const CLOSING_SOON_WINDOW = 7n * DAY
	const open = market({ pool: address('01') })
	const closingSoon = market({ pool: address('02'), endTime: NOW + CLOSING_SOON_WINDOW })
	const ended = market({ pool: address('03'), endTime: NOW - DAY })
	const resolved = market({ pool: address('04'), endTime: NOW - DAY, questionOutcome: 1, tradingStatus: 5 })
	const broken = market({ pool: address('05'), loadError: 'unavailable' })
	// Newest-first keeps the arrangement a pure filter here: registration order reversed.
	const filtered = (markets: readonly LiveMarket[], filter: MarketFilter, query = '') => arrangeMarkets(markets, { filter, query, sort: 'newest' }, NOW).toReversed()

	test('open takes only markets that accept new risk', () => {
		expect(filtered([open, closingSoon, ended, resolved, broken], 'open')).toEqual([open, closingSoon])
	})

	test('closing soon is open and ends within the window, inclusive', () => {
		expect(filtered([open, closingSoon, ended, resolved], 'closing-soon')).toEqual([closingSoon])
		expect(filtered([market({ pool: address('06'), endTime: NOW + CLOSING_SOON_WINDOW + 1n })], 'closing-soon')).toEqual([])
	})

	test('resolved takes markets with a final question outcome, not merely ended or unavailable ones', () => {
		expect(filtered([open, ended, resolved, broken], 'resolved')).toEqual([resolved])
		expect(filtered([market({ pool: address('07'), questionOutcome: 2 })], 'resolved')).toHaveLength(1)
	})

	test('all keeps every loaded market, including unavailable ones', () => {
		expect(filtered([open, ended, resolved, broken], 'all')).toEqual([open, ended, resolved, broken])
	})

	test('search matches every term across title, description, and addresses, ignoring case', () => {
		const rain = market({ pool: address('0a'), title: 'Will it rain in Paris?', description: 'Measured at Orly.' })
		const matches = (query: string) => filtered([rain], 'all', query).length === 1
		expect(matches('  ')).toBe(true)
		expect(matches('PARIS rain')).toBe(true)
		expect(matches('orly')).toBe(true)
		expect(matches('paris snow')).toBe(false)
		expect(matches(address('0a').toLowerCase())).toBe(true)
		expect(matches(address('ee').slice(0, 10))).toBe(true)
	})
})

describe('market ordering', () => {
	const first = market({ pool: address('01'), endTime: NOW + 20n * DAY, yesReserve: 10n ** 36n, noReserve: 10n ** 36n })
	const second = market({ pool: address('02'), endTime: NOW + 2n * DAY, yesReserve: 5n * 10n ** 36n, noReserve: 5n * 10n ** 36n })
	const third = market({ pool: address('03'), endTime: NOW - DAY, yesReserve: 3n * 10n ** 36n, noReserve: 3n * 10n ** 36n })
	const unpaired = market({ pool: address('04'), pair: undefined, endTime: NOW + DAY })
	const loaded = [first, second, third, unpaired]
	const pools = (markets: readonly LiveMarket[]) => markets.map(candidate => candidate.pool)

	test('newest reverses registration order', () => {
		expect(pools(arrangeMarkets(loaded, { filter: 'all', query: '', sort: 'newest' }, NOW))).toEqual(pools([unpaired, third, second, first]))
	})

	test('closing soon lists open markets by end time, then ended ones', () => {
		expect(pools(arrangeMarkets(loaded, { filter: 'all', query: '', sort: 'closing-soon' }, NOW))).toEqual(pools([unpaired, second, first, third]))
	})

	test('liquidity sorts deepest first and leaves markets without a pair last', () => {
		expect(pools(arrangeMarkets(loaded, { filter: 'all', query: '', sort: 'liquidity' }, NOW))).toEqual(pools([second, third, first, unpaired]))
	})

	test('applies the filter and search before sorting', () => {
		expect(pools(arrangeMarkets(loaded, { filter: 'open', query: '', sort: 'liquidity' }, NOW))).toEqual(pools([second, first, unpaired]))
		expect(arrangeMarkets(loaded, { filter: 'resolved', query: '', sort: 'newest' }, NOW)).toEqual([])
		expect(pools(arrangeMarkets(loaded, { filter: 'all', query: address('02'), sort: 'newest' }, NOW))).toEqual(pools([second]))
	})

	test('does not reorder the caller-owned list', () => {
		arrangeMarkets(loaded, { filter: 'all', query: '', sort: 'liquidity' }, NOW)
		expect(pools(loaded)).toEqual(pools([first, second, third, unpaired]))
	})
})

describe('card close times', () => {
	test('keep only the largest whole unit so cards scan quickly', () => {
		expect(coarseDuration(365n * DAY + 23n * 3_600n)).toEqual({ amount: 365n, unit: 'day' })
		expect(coarseDuration(DAY - 1n)).toEqual({ amount: 23n, unit: 'hour' })
		expect(coarseDuration(-(90n * 60n))).toEqual({ amount: 1n, unit: 'hour' })
		expect(coarseDuration(59n)).toEqual({ amount: 0n, unit: 'minute' })
	})
})

describe('ticket side preselection', () => {
	test('reads only YES or NO from the side parameter', () => {
		expect(readTicketSideParam('?side=yes')).toBe('YES')
		expect(readTicketSideParam('?universe=1&side=NO')).toBe('NO')
		expect(readTicketSideParam('?side=invalid')).toBeUndefined()
		expect(readTicketSideParam('')).toBeUndefined()
	})

	test('builds a market link that keeps the current hash parameters', () => {
		const pool = address('01')
		expect(marketTicketHref(pool, 'YES', '')).toBe(`#/market/${pool}?side=yes`)
		expect(marketTicketHref(pool, 'NO', '?universe=2&side=yes')).toBe(`#/market/${pool}?universe=2&side=no`)
	})

	test('drops the one-shot side parameter from the hash it was consumed from', () => {
		const pool = address('01')
		expect(hashWithoutTicketSide(`#/market/${pool}?side=yes`)).toBe(`#/market/${pool}`)
		expect(hashWithoutTicketSide(`#/market/${pool}?universe=2&side=no`)).toBe(`#/market/${pool}?universe=2`)
	})
})
