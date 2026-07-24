import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import type { OpenOracleGame } from '@zoltar/shared/openOracle'
import { calculateContribution, calculateNextAmount1, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, hasFreshSubmissionWindow, isSelfReport, meetsProfitThreshold } from './strategy.js'

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
	test('matches OpenOracle integer escalation and contribution formulas', () => {
		const newAmount1 = calculateNextAmount1(game)
		expect(newAmount1).toBe(1_150_000n)
		expect(calculateContribution(game, weth, weth, newAmount1, 2_300_000n)).toEqual({
			token1: 2_161_000n,
			token2: 300_000n,
		})
		expect(calculateContribution(game, rep, weth, newAmount1, 2_300_000n)).toEqual({
			token1: 150_000n,
			token2: 4_322_000n,
		})
	})

	test('uses executable hedge quotes, all fees, and gas for profitability', () => {
		const sell = evaluateSellRep(game, 1_300_000n, 10_000n)
		expect(sell.netProfitWeth).toBe(279_000n)
		expect(meetsProfitThreshold(sell, 20_000n, 100n)).toBe(true)

		const buy = evaluateBuyRep(game, 900_000n, 10_000n)
		expect(buy.hedgeAmountRep).toBe(2_022_000n)
		expect(buy.netProfitWeth).toBe(90_000n)
		expect(meetsProfitThreshold(buy, 100_000n, 100n)).toBe(false)
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

	test('rejects self-disputes because they use different contract accounting', () => {
		expect(isSelfReport(weth, weth)).toBe(true)
		expect(isSelfReport(weth, rep)).toBe(false)
	})

	test('rejects stale quotes and submission windows that shrink after approvals', () => {
		const window = {
			currentTime: 1_000n,
			deadline: 1_100n,
			minimumRemaining: 36n,
			quoteBlock: 20_000n,
			submissionBlock: 20_001n,
		}
		expect(hasFreshSubmissionWindow(window)).toBe(true)
		expect(hasFreshSubmissionWindow({ ...window, submissionBlock: 20_002n })).toBe(false)
		expect(hasFreshSubmissionWindow({ ...window, currentTime: 1_065n })).toBe(false)
		expect(hasFreshSubmissionWindow({ ...window, submissionBlock: 19_999n })).toBe(false)
	})
})
