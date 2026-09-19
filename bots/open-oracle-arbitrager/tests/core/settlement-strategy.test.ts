import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { rewardWithdrawalDecision, rewardWithdrawalGasPlan, settlementDecision, settlementEconomics, settlementEligibilityMismatch, settlementTiming } from '#core/settlement-strategy'
import { parseSettlementSettings } from '#state/settlement-store'

const wallet = getAddress('0x00000000000000000000000000000000000000aa')
const coordinator = getAddress('0x00000000000000000000000000000000000000cc')
const GWEI = 10n ** 9n
const timedGame = { currentReporter: coordinator, flags: 7n, reportTimestamp: 1_000n, settlementTime: 480n, settlementTimestamp: 0n }

describe('settlement gas plan', () => {
	test('carries the callback limit plus the 1/63 slack OpenOracle requires after the callback', () => {
		const settings = parseSettlementSettings(undefined)
		expect(settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 1n, rewardAttoEth: 1n, settings }).gas).toBe(250_000n + 4_000_000n + 63_492n)
		expect(settlementEconomics({ callbackGasLimit: 0n, gasPrice: 1n, rewardAttoEth: 1n, settings }).gas).toBe(250_000n)
		expect(rewardWithdrawalGasPlan()).toBe(60_000n)
	})
})

describe('settlement eligibility', () => {
	test('accepts only unsettled submitted reports past their window that the wallet did not report', () => {
		expect(settlementEligibilityMismatch(timedGame, 50n, 1_480n, wallet)).toBeUndefined()
		expect(settlementEligibilityMismatch(timedGame, 50n, 1_479n, wallet)).toBe('Settlement window has not ended')
		expect(settlementEligibilityMismatch({ ...timedGame, settlementTimestamp: 1_500n }, 50n, 1_600n, wallet)).toBe('Report is already settled')
		expect(settlementEligibilityMismatch({ ...timedGame, reportTimestamp: 0n }, 50n, 1_600n, wallet)).toBe('Report has not been submitted')
		expect(settlementEligibilityMismatch({ ...timedGame, currentReporter: wallet }, 50n, 1_600n, wallet)).toBe('Own report settles through the position lifecycle')
		expect(settlementEligibilityMismatch({ ...timedGame, currentReporter: wallet }, 50n, 1_600n, undefined)).toBeUndefined()
	})

	test('measures the window in blocks when the report is block timed', () => {
		const blockGame = { ...timedGame, flags: 0n, reportTimestamp: 100n, settlementTime: 20n }
		expect(settlementEligibilityMismatch(blockGame, 119n, 9_999n, wallet)).toBe('Settlement window has not ended')
		expect(settlementEligibilityMismatch(blockGame, 120n, 0n, wallet)).toBeUndefined()
		expect(settlementTiming(blockGame, 125n, 0n)).toEqual({ elapsed: 5n, windowUnit: 'blocks' })
		expect(settlementTiming(timedGame, 0n, 1_500n)).toEqual({ elapsed: 20n, windowUnit: 'seconds' })
	})
})

describe('settlement economics and decision', () => {
	const settings = { ...parseSettlementSettings(undefined), maxGasPriceAttoEthPerGas: 10n * GWEI, minimumProfitAttoWeth: 10n ** 15n }

	test('nets the reward against the settle plan plus an amortised reward withdrawal', () => {
		const economics = settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 2n * GWEI, rewardAttoEth: 17_043_310_270_400_101n, settings })
		expect(economics.gas).toBe(4_313_492n)
		expect(economics.projectedGasCostAttoEth).toBe((4_313_492n + 60_000n) * 2n * GWEI)
		expect(economics.netAttoEth).toBe(17_043_310_270_400_101n - economics.projectedGasCostAttoEth)
		expect(economics.profitable).toBeTrue()
		expect(economics.withinGasPriceCap).toBeTrue()
	})

	test('rejects rewards that do not clear the minimum net and gas prices above the cap', () => {
		const thin = settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 4n * GWEI, rewardAttoEth: 17_043_310_270_400_101n, settings })
		expect(thin.netAttoEth).toBeLessThan(settings.minimumProfitAttoWeth)
		expect(thin.profitable).toBeFalse()
		expect(settlementEconomics({ callbackGasLimit: 0n, gasPrice: 1n, rewardAttoEth: 0n, settings }).profitable).toBeFalse()
		expect(settlementEconomics({ callbackGasLimit: 0n, gasPrice: 11n * GWEI, rewardAttoEth: 10n ** 18n, settings }).withinGasPriceCap).toBeFalse()
	})

	test('explains the first gate that blocks execution in economic-then-operator order', () => {
		const ready = { economics: { profitable: true, withinGasPriceCap: true }, enabled: true, execute: true, inFlight: false, paused: false, signerReady: true, withinDailyGasBudget: true }
		expect(settlementDecision(ready)).toBe('eligible')
		expect(settlementDecision({ ...ready, economics: { profitable: false, withinGasPriceCap: false } })).toBe('unprofitable')
		expect(settlementDecision({ ...ready, economics: { profitable: true, withinGasPriceCap: false } })).toBe('gas-price-cap')
		expect(settlementDecision({ ...ready, withinDailyGasBudget: false })).toBe('risk-limit')
		expect(settlementDecision({ ...ready, enabled: false })).toBe('disabled')
		expect(settlementDecision({ ...ready, execute: false })).toBe('dry-run-settlement')
		expect(settlementDecision({ ...ready, signerReady: false })).toBe('signer-unavailable')
		expect(settlementDecision({ ...ready, paused: true })).toBe('paused')
		expect(settlementDecision({ ...ready, inFlight: true })).toBe('in-flight')
	})

	test('withdraws accrued rewards only at the threshold, under the gas cap, within the daily gas budget, and when the operator can sign', () => {
		const dailyGas = { limitAttoWeth: 5n * 10n ** 16n, spentAttoWeth: 0n }
		const ready = { dailyGas, enabled: true, execute: true, gasPrice: GWEI, inFlight: false, paused: false, settings, signerReady: true, unclaimedRewardAttoEth: 10n ** 16n }
		expect(rewardWithdrawalDecision({ ...ready, unclaimedRewardAttoEth: undefined })).toBe('unavailable')
		expect(rewardWithdrawalDecision({ ...ready, unclaimedRewardAttoEth: 10n ** 16n - 1n })).toBe('below-threshold')
		expect(rewardWithdrawalDecision({ ...ready, gasPrice: 11n * GWEI })).toBe('gas-price-cap')
		expect(rewardWithdrawalDecision({ ...ready, dailyGas: { ...dailyGas, spentAttoWeth: 5n * 10n ** 16n - 60_000n * GWEI + 1n } })).toBe('risk-limit')
		expect(rewardWithdrawalDecision({ ...ready, enabled: false })).toBe('disabled')
		expect(rewardWithdrawalDecision({ ...ready, execute: false })).toBe('dry-run')
		expect(rewardWithdrawalDecision({ ...ready, signerReady: false })).toBe('signer-unavailable')
		expect(rewardWithdrawalDecision({ ...ready, paused: true })).toBe('paused')
		expect(rewardWithdrawalDecision({ ...ready, inFlight: true })).toBe('in-flight')
		expect(rewardWithdrawalDecision(ready)).toBe('due')
	})
})
