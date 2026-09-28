import { describe, expect, test } from 'bun:test'
import { largestInsuredExit, tradingExitAvailability, tradingHoldingsValue, tradingProfitAndLoss } from '../../src/trading-pnl.ts'

const rate = { settlementCollateralAttoEth: 2_000n, shareSupplyAttoShares: 1_000n }
const holdings = (invalidShares: bigint, yesShares: bigint, noShares: bigint, lpTokens = 0n) => ({ invalidShares, yesShares, noShares, lpTokens })

// Independent brute-force mirror of TwoWayConstantProductMath.quoteExactOutput plus the router's exit constraint.
const bruteForceExit = (longShares: bigint, invalidShares: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint) => {
	let best = 0n
	for (let sets = 1n; sets < reserveOut && sets <= invalidShares && sets <= longShares; sets++) {
		const net = (reserveIn * sets + (reserveOut - sets) - 1n) / (reserveOut - sets)
		const input = (net * 10_000n + (10_000n - feeBps) - 1n) / (10_000n - feeBps)
		if (sets + input <= longShares) best = sets
	}
	return best
}

describe('trading holdings valuation', () => {
	test('finds the largest insured exit that the pair and balances allow', () => {
		expect(largestInsuredExit(true, 6n, 6n, { yes: 1_000n, no: 1_000n }, 30n)).toBe(2n)
		for (const [longShares, invalidShares, yes, no, fee] of [
			[50n, 50n, 300n, 100n, 30n],
			[90n, 20n, 100n, 400n, 0n],
			[7n, 100n, 40n, 40n, 9_999n],
			[500n, 500n, 60n, 30n, 100n],
		] as const) {
			expect(largestInsuredExit(true, longShares, invalidShares, { yes, no }, fee)).toBe(bruteForceExit(longShares, invalidShares, yes, no, fee))
			expect(largestInsuredExit(false, longShares, invalidShares, { yes, no }, fee)).toBe(bruteForceExit(longShares, invalidShares, no, yes, fee))
		}
	})

	test('redeems complete sets at the indexed exchange rate before exiting the directional remainder', () => {
		const value = tradingHoldingsValue(holdings(10n, 16n, 4n), { reserves: { yes: 1_000n, no: 1_000n }, feeBps: 30n, lpTotalSupply: 0n, completeSetRate: rate })
		// 4 complete sets, then 6 INVALID with 12 YES: the largest exit is 5 sets (5 + 7 YES swapped in).
		expect(value).toEqual({ valueAttoEth: 18n, completeSetsRedeemed: 4n, insuredExitSets: 5n, unvalued: { invalidShares: 1n, yesShares: 0n, noShares: 0n, lpTokens: 0n } })
	})

	test('removes LP tokens pro rata and exits against the reduced reserves', () => {
		const value = tradingHoldingsValue(holdings(100n, 0n, 0n, 50n), { reserves: { yes: 300n, no: 100n }, feeBps: 0n, lpTotalSupply: 100n, completeSetRate: rate })
		// 150 YES and 50 NO come out; 50 sets redeem, then 50 INVALID and 100 YES exit against 150/50 reserves.
		expect(value?.completeSetsRedeemed).toBe(50n)
		expect(value?.insuredExitSets).toBe(bruteForceExit(100n, 50n, 150n, 50n, 0n))
		expect(value?.unvalued.lpTokens).toBe(0n)
	})

	test('leaves shares that cannot reach ETH unvalued instead of pricing them', () => {
		expect(tradingHoldingsValue(holdings(0n, 5n, 3n), { reserves: { yes: 100n, no: 100n }, feeBps: 30n, lpTotalSupply: 0n, completeSetRate: rate })).toEqual({
			valueAttoEth: 0n,
			completeSetsRedeemed: 0n,
			insuredExitSets: 0n,
			unvalued: { invalidShares: 0n, yesShares: 5n, noShares: 3n, lpTokens: 0n },
		})
		expect(tradingHoldingsValue(holdings(4n, 4n, 0n, 7n), { feeBps: 30n, lpTotalSupply: 10n, completeSetRate: rate })?.unvalued).toEqual({ invalidShares: 4n, yesShares: 4n, noShares: 0n, lpTokens: 7n })
	})

	test('reports no valuation without an indexed complete-set exchange rate', () => {
		expect(tradingHoldingsValue(holdings(1n, 1n, 1n), { reserves: { yes: 10n, no: 10n }, feeBps: 0n, lpTotalSupply: 0n })).toBeUndefined()
		expect(tradingHoldingsValue(holdings(1n, 1n, 1n), { feeBps: 0n, lpTotalSupply: 0n, completeSetRate: { settlementCollateralAttoEth: 1n, shareSupplyAttoShares: 0n } })).toBeUndefined()
		expect(tradingHoldingsValue(holdings(1n, -2n, 1n), { feeBps: 0n, lpTotalSupply: 0n, completeSetRate: rate })).toBeUndefined()
	})
})

describe('trading profit and loss', () => {
	test('realizes the whole result once the position is closed', () => {
		expect(tradingProfitAndLoss(10n, 7n, holdings(0n, 0n, 0n), undefined)).toEqual({ costBasisAttoEth: 10n, proceedsAttoEth: 7n, holdingsValueAttoEth: 0n, realizedAttoEth: -3n, unrealizedAttoEth: 0n, netAttoEth: -3n, open: false })
	})

	test('uses cost recovery while the position is open', () => {
		expect(tradingProfitAndLoss(10n, 4n, holdings(6n, 6n, 0n), 2n)).toMatchObject({ realizedAttoEth: 0n, unrealizedAttoEth: -4n, netAttoEth: -4n, open: true })
		expect(tradingProfitAndLoss(10n, 13n, holdings(1n, 1n, 0n), 5n)).toMatchObject({ realizedAttoEth: 3n, unrealizedAttoEth: 5n, netAttoEth: 8n })
	})

	test('keeps realized profit but omits unrealized and net results without a valuation', () => {
		const result = tradingProfitAndLoss(10n, 12n, holdings(0n, 3n, 0n), undefined)
		expect(result).toEqual({ costBasisAttoEth: 10n, proceedsAttoEth: 12n, realizedAttoEth: 2n, open: true })
	})
})

describe('trading exit availability', () => {
	const operational = { systemState: '0', awaitingForkContinuation: false, escalationResolved: false }
	test('values holdings only while the pair can still execute a router exit', () => {
		expect(tradingExitAvailability({ asOfTimestamp: 100n, questionEndTime: 200n, poolState: operational, settlementObserved: false })).toEqual({ open: true })
		expect(tradingExitAvailability({ asOfTimestamp: 100n, questionEndTime: 200n, settlementObserved: false })).toEqual({ open: true })
		expect(tradingExitAvailability({ asOfTimestamp: 100n, settlementObserved: false })).toEqual({ open: false, reason: 'Question end time is not indexed' })
		expect(tradingExitAvailability({ asOfTimestamp: 200n, questionEndTime: 200n, poolState: operational, settlementObserved: false })).toMatchObject({ open: false, reason: 'Trading has closed because the question ended' })
		expect(tradingExitAvailability({ asOfTimestamp: 100n, questionEndTime: 200n, poolState: operational, settlementObserved: true })).toMatchObject({ reason: 'Trading has closed because the question resolved' })
		expect(tradingExitAvailability({ asOfTimestamp: 100n, questionEndTime: 200n, poolState: { ...operational, escalationResolved: true }, settlementObserved: false })).toMatchObject({ reason: 'Trading has closed because the question resolved' })
		expect(tradingExitAvailability({ asOfTimestamp: 100n, questionEndTime: 200n, poolState: { ...operational, systemState: '1' }, settlementObserved: false })).toMatchObject({ reason: 'Trading has closed because the pool is not operational' })
		expect(tradingExitAvailability({ asOfTimestamp: 100n, questionEndTime: 200n, poolState: { ...operational, awaitingForkContinuation: true }, settlementObserved: false })).toMatchObject({ open: false })
	})
})
