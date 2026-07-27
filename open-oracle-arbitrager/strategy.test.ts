import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import type { OpenOracleGame } from '@zoltar/shared/openOracle'
import { decimalSignedEth } from './operator-state.js'
import { calculateContribution, calculateNextAmount1, calculateTrackedNetProfitEth, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, executorFunding, hasFreshSubmissionWindow, hedgeSlippageReserveWeth, hedgeWethLimit, isSelfReport, meetsProfitThreshold } from './strategy.js'

const weth = '0x0000000000000000000000000000000000000001' as Address
const rep = '0x0000000000000000000000000000000000000002' as Address
const game = {
	currentAmount1: 1_000_000n,
	currentAmount2: 2_000_000n,
	escalationHalt: 10_000_000n,
	feePercentage: 10_000n,
	multiplier: 115n,
	protocolFee: 100_000n,
	token1: weth,
	token2: rep,
} satisfies Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'escalationHalt' | 'feePercentage' | 'multiplier' | 'protocolFee' | 'token1' | 'token2'>

describe('OpenOracle arbitrage strategy', () => {
	test('serializes negative modeled opportunity profit with the sign before the whole number', () => {
		expect(decimalSignedEth(-255_235_735_754_674_523n)).toBe('-0.255235735754674523')
	})

	test('matches full submission, immediate credit, and locked replacement economics in both OpenOracle branches', () => {
		const newAmount1 = calculateNextAmount1(game)
		expect(newAmount1).toBe(1_150_000n)
		const cheapRepReplacement = { amount1: newAmount1, amount2: 1_800_000n }
		expect(calculateContribution(game, weth, weth, cheapRepReplacement.amount1, cheapRepReplacement.amount2)).toEqual({
			token1: 2_161_000n,
			token2: 0n,
		})
		expect(game.currentAmount2 - cheapRepReplacement.amount2).toBe(200_000n)
		expect(cheapRepReplacement).toEqual({ amount1: 1_150_000n, amount2: 1_800_000n })

		const expensiveRepReplacement = { amount1: newAmount1, amount2: 2_300_000n }
		expect(calculateContribution(game, rep, weth, expensiveRepReplacement.amount1, expensiveRepReplacement.amount2)).toEqual({
			token1: 150_000n,
			token2: 4_322_000n,
		})
		expect(expensiveRepReplacement.amount1 - game.currentAmount1).toBe(150_000n)
		expect(expensiveRepReplacement).toEqual({ amount1: 1_150_000n, amount2: 2_300_000n })
	})

	test('uses executable hedge quotes, all fees, and gas for profitability', () => {
		const sell = evaluateSellRep(game, 1_300_000n, 10_000n)
		expect(sell.netProfitWeth).toBe(279_000n)
		expect(meetsProfitThreshold(sell, 20_000n, 100n)).toBe(true)

		const buy = evaluateBuyRep(game, 900_000n, 10_000n)
		expect(buy.hedgeAmountRep).toBe(2_022_000n)
		expect(buy.netProfitWeth).toBe(90_000n)
		expect(meetsProfitThreshold(buy, 100_000n, 100n)).toBe(false)
		expect(calculateTrackedNetProfitEth(buy.profitBeforeGasWeth, 110_000n)).toBe(-10_000n)
	})

	test('increments by one after the escalation halt', () => {
		expect(
			calculateNextAmount1({
				currentAmount1: 10_000_000n,
				escalationHalt: 10_000_000n,
				multiplier: 115n,
			}),
		).toBe(10_000_001n)
	})

	test('derives the contract swap side from the strict replacement-ratio comparison', () => {
		expect(deriveTokenToSwap(game, 1_150_000n, 2_300_001n)).toBe(rep)
		expect(deriveTokenToSwap(game, 1_150_000n, 2_300_000n)).toBe(weth)
		expect(deriveTokenToSwap(game, 1_150_000n, 2_299_999n)).toBe(weth)
	})

	test('funds the atomic hedge and applies conservative slippage limits in both directions', () => {
		const newAmount1 = calculateNextAmount1(game)
		expect(executorFunding(game, newAmount1, 1_800_000n, 0n)).toEqual({
			token1: 2_161_000n,
			token2: 2_000_000n,
		})
		expect(hedgeWethLimit('sell-rep', 1_000_000n, 50n)).toBe(995_000n)
		expect(executorFunding(game, newAmount1, 2_300_001n, 1_010_000n)).toEqual({
			token1: 1_160_000n,
			token2: 2_300_001n,
		})
		expect(hedgeWethLimit('buy-rep', 1_000_000n, 50n)).toBe(1_005_000n)
		expect(hedgeSlippageReserveWeth('sell-rep', 101n, 100n)).toBe(2n)
		expect(hedgeSlippageReserveWeth('buy-rep', 101n, 100n)).toBe(2n)
	})

	test('rejects self-disputes because they use different contract accounting', () => {
		expect(isSelfReport(weth, weth)).toBe(true)
		expect(isSelfReport(weth, rep)).toBe(false)
		expect(isSelfReport(undefined, weth)).toBe(false)
	})

	test('rejects stale quotes and submission windows that shrink after approvals', () => {
		const window = {
			currentTime: 1_000n,
			deadline: 1_100n,
			minimumRemaining: 36n,
			quoteBlock: 20_000n,
			submissionBlock: 20_000n,
		}
		expect(hasFreshSubmissionWindow(window)).toBe(true)
		expect(hasFreshSubmissionWindow({ ...window, submissionBlock: 20_001n })).toBe(false)
		expect(hasFreshSubmissionWindow({ ...window, currentTime: 1_065n })).toBe(false)
		expect(hasFreshSubmissionWindow({ ...window, submissionBlock: 19_999n })).toBe(false)
	})
})
