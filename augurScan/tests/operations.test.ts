import { expect, test } from 'bun:test'
import {
	auctionDemandCurve,
	auctionLifecycle,
	candlestickBuckets,
	ESCALATION_OUTCOME,
	fixedWindowTwap,
	poolCapacity,
	priceFreshness,
	quoteDecimalsFallback,
	reportLifecycle,
	swapAnalytics,
	vaultRisk,
} from '../src/operations.ts'

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

test('matches the Solidity vault health constraints and keeps scanner severity separate', () => {
	const healthy = vaultRisk({
		poolHeldBackingAttoRep: String(200),
		disputeStakedAttoRep: String(0),
		openInterestAttoEth: (10n ** 18n).toString(),
		repPerEth1e18: '100',
		securityMultiplierBps: '15000',
		targetHealthFactorBps: '12000',
		badDebtAttoEth: String(0),
	})
	expect(healthy.protocolState).toBe('healthy')
	expect(healthy.healthFactorBps).toBe('13333')
	expect(healthy.scannerSeverity).toBe('healthy')

	const warning = vaultRisk({
		poolHeldBackingAttoRep: String(179),
		disputeStakedAttoRep: String(0),
		openInterestAttoEth: (10n ** 18n).toString(),
		repPerEth1e18: '100',
		securityMultiplierBps: '15000',
		targetHealthFactorBps: '12000',
		badDebtAttoEth: String(0),
	})
	expect(warning).toMatchObject({ protocolState: 'healthy', scannerSeverity: 'warning', healthFactorBps: '11933' })

	const liquidatable = vaultRisk({
		poolHeldBackingAttoRep: String(149),
		disputeStakedAttoRep: String(0),
		openInterestAttoEth: (10n ** 18n).toString(),
		repPerEth1e18: '100',
		securityMultiplierBps: '15000',
		targetHealthFactorBps: '12000',
		badDebtAttoEth: String(0),
	})
	expect(liquidatable).toMatchObject({ protocolState: 'liquidatable', scannerSeverity: 'critical' })
})

test('derives exact pool capacity without treating over-utilization as negative availability', () => {
	expect(poolCapacity('25', '100')).toEqual({ usedAttoEth: String(25), capacityAttoEth: String(100), availableAttoEth: String(75), utilizationBps: '2500' })
	expect(poolCapacity('125', '100')).toMatchObject({ availableAttoEth: String(0), utilizationBps: '12500' })
})

test('reconstructs pre-swap reserves and exact price impact from Swap evidence', () => {
	expect(
		swapAnalytics({
			yesForNo: true,
			amountIn: '100',
			amountOut: '90',
			feeAmount: '1',
			resultingYesReserve: '1100',
			resultingNoReserve: '910',
		}),
	).toMatchObject({
		direction: 'YES to NO',
		reserveInBefore: '1000',
		reserveOutBefore: '1000',
		spotPriceBefore: { numerator: '1000', denominator: '1000' },
		executionPrice: { numerator: '90', denominator: '100' },
		priceImpact: { state: 'Available', numerator: '1', denominator: '10', bps: '1000' },
	})
})

test('computes fixed-window TWAP with explicit coverage', () => {
	const observations = [
		{ timestamp: '10', numerator: '1', denominator: '2' },
		{ timestamp: '20', numerator: '3', denominator: '2' },
	]
	expect(fixedWindowTwap(observations, '10', '30')).toEqual({
		state: 'Available',
		numerator: '1',
		denominator: '1',
		coverageSeconds: '20',
		windowSeconds: '20',
	})
	expect(fixedWindowTwap(observations.slice(1), '10', '30')).toMatchObject({ state: 'Partial coverage', coverageSeconds: '10' })
})

test('aggregates auction demand descending by tick and builds exact candles', () => {
	expect(
		auctionDemandCurve([
			{ tick: '2', amountAttoEth: String(10) },
			{ tick: '1', amountAttoEth: String(3) },
			{ tick: '2', amountAttoEth: String(5) },
		]),
	).toEqual([
		{ tick: '2', amountAttoEth: String(15), cumulativeDemandAttoEth: String(15) },
		{ tick: '1', amountAttoEth: String(3), cumulativeDemandAttoEth: String(18) },
	])
	expect(
		candlestickBuckets(
			[
				{ timestamp: '10', numerator: '1', denominator: '2' },
				{ timestamp: '20', numerator: '3', denominator: '2' },
				{ timestamp: '30', numerator: '1', denominator: '1' },
			],
			'60',
		),
	).toEqual([
		expect.objectContaining({
			bucketStart: '0',
			open: { numerator: '1', denominator: '2' },
			high: { numerator: '3', denominator: '2' },
			low: { numerator: '1', denominator: '2' },
			close: { numerator: '1', denominator: '1' },
			observations: 3,
		}),
	])
})
