import { expect, test } from 'bun:test'
import { reviewChangeRows } from '../../src/dashboard/confirmation.ts'

test('review shows exact nested before and after settings', () => {
	expect(reviewChangeRows({ limits: { lockedWeth: '1.000000000000000001' }, pools: [{ questionId: '1' }] }, { limits: { lockedWeth: '2' }, pools: [{ questionId: '2' }] })).toEqual([
		{ label: 'Limits · Locked WETH', before: '1.000000000000000001', after: '2' },
		{ label: 'Pool 1 · Question ID', before: '1', after: '2' },
	])
})

test('review expands added and removed sources into their fields', () => {
	expect(reviewChangeRows({ sources: [] }, { sources: [{ address: '0xabc', minimumDepthEth: '2' }] })).toEqual([
		{ label: 'Source 1 · Address', before: '—', after: '0xabc' },
		{ label: 'Source 1 · Minimum depth ETH', before: '—', after: '2' },
	])
	expect(reviewChangeRows({ sources: [{ exchangeId: 'kraken', repMarket: 'REP/USD' }] }, { sources: [{ exchangeId: 'coinbase', repMarket: 'REP/USDT' }] })).toEqual([
		{ label: 'Source 1 · Exchange ID', before: 'kraken', after: 'coinbase' },
		{ label: 'Source 1 · REP market', before: 'REP/USD', after: 'REP/USDT' },
	])
	expect(reviewChangeRows({ sources: [{ address: '0xabc', minimumDepthEth: '2' }] }, { sources: [] })).toEqual([
		{ label: 'Source 1 · Address', before: '0xabc', after: '—' },
		{ label: 'Source 1 · Minimum depth ETH', before: '2', after: '—' },
	])
	expect(reviewChangeRows({ sources: [{ exchangeId: 'coinbase', repMarket: 'REP/ETH', ethMarket: null }] }, { sources: [] })).toEqual([
		{ label: 'Source 1 · Exchange ID', before: 'coinbase', after: '—' },
		{ label: 'Source 1 · REP market', before: 'REP/ETH', after: '—' },
	])
})
