import { expect, test } from 'bun:test'
import { auctionLifecycle, ESCALATION_OUTCOME, priceFreshness, quoteDecimalsFallback, reportLifecycle } from '../src/operations.ts'

test('uses Solidity BinaryOutcome ordering for escalation catalog totals', () => {
	expect(ESCALATION_OUTCOME).toEqual({ invalid: '0', yes: '1', no: '2' })
})

test('uses contract-kind quote decimals when token metadata is unavailable', () => {
	expect(quoteDecimalsFallback('usdc')).toBe(6)
	expect(quoteDecimalsFallback('weth')).toBe(18)
	expect(quoteDecimalsFallback(undefined)).toBe(18)
})

test('derives OpenOracle boundaries with the report clock selected by flags', () => {
	expect(
		reportLifecycle({
			eventName: 'ReportSubmitted',
			flags: '1',
			reportTimestamp: '100',
			disputeDelay: '10',
			settlementTime: '30',
			indexedBlock: '5',
			indexedTimestamp: '109',
		}),
	).toMatchObject({ state: 'Waiting for dispute window', clock: 'timestamp', nextTransition: '110' })
	expect(
		reportLifecycle({
			eventName: 'ReportDisputed',
			flags: '0',
			reportTimestamp: '100',
			disputeDelay: '10',
			settlementTime: '30',
			indexedBlock: '110',
			indexedTimestamp: '1',
		}),
	).toMatchObject({ state: 'Dispute window open', clock: 'block', nextTransition: '130' })
	expect(
		reportLifecycle({
			eventName: 'ReportSubmitted',
			flags: '0',
			reportTimestamp: '100',
			disputeDelay: '10',
			settlementTime: '30',
			indexedBlock: '130',
			indexedTimestamp: '1',
		}),
	).toMatchObject({ state: 'Settleable', settlementBoundary: '130' })
})

test('keeps settlement and unavailable evidence explicit', () => {
	expect(reportLifecycle({ eventName: 'ReportSettled', indexedBlock: '1', indexedTimestamp: '1' })).toEqual({ state: 'Settled', clock: 'block' })
	expect(reportLifecycle({ eventName: 'ReportSubmitted', indexedBlock: '1', indexedTimestamp: '1' }).state).toBe('Awaiting indexed evidence')
})

test('derives auction lifecycle and price freshness at exact boundaries', () => {
	expect(
		auctionLifecycle({ started: true, finalized: false, startTimestamp: '10', endTimestamp: '20', indexedTimestamp: '20', bidCount: 1, settlementCount: 0 }),
	).toBe('Awaiting finalization')
	expect(auctionLifecycle({ started: true, finalized: true, indexedTimestamp: '20', bidCount: 2, settlementCount: 1 })).toBe('Bid settlements outstanding')
	expect(priceFreshness('100', '90', 10n)).toEqual({ state: 'Fresh', ageSeconds: '10' })
	expect(priceFreshness('101', '90', 10n)).toEqual({ state: 'Stale', ageSeconds: '11' })
})
