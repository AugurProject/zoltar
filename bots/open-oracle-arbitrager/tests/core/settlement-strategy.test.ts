import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { rewardWithdrawalDecision, rewardWithdrawalGasPlan, settlementDecision, settlementEconomics, settlementEligibilityMismatch, settlementMaxFeePerGas, settlementTiming, signedSettlementGasLimit } from '#core/settlement-strategy'
import { maximumFeePerGas, paddedTransactionGas } from '#execution/transaction-submission'
import { parseSettlementSettings } from '#state/settlement-store'

const wallet = getAddress('0x00000000000000000000000000000000000000aa')
const coordinator = getAddress('0x00000000000000000000000000000000000000cc')
const NANO_ETH = 10n ** 9n
const timedGame = { currentReporter: coordinator, flags: 7n, reportTimestamp: 1_000n, settlementTime: 480n, settlementTimestamp: 0n }

describe('settlement gas plan', () => {
	test('carries the callback limit plus the 1/63 slack OpenOracle requires after the callback', () => {
		const settings = parseSettlementSettings(undefined)
		expect(settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 1n, maxFeePerGas: 1n, rewardAttoEth: 1n, settings }).gas).toBe(250_000n + 4_000_000n + 63_492n)
		expect(settlementEconomics({ callbackGasLimit: 0n, gasPrice: 1n, maxFeePerGas: 1n, rewardAttoEth: 1n, settings }).gas).toBe(250_000n)
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
	const settings = { ...parseSettlementSettings(undefined), maxGasPriceAttoEthPerGas: 10n * NANO_ETH, minimumProfitAttoWeth: 10n ** 15n }

	test('nets the reward against the padded settle and reward-withdrawal limits the signatures carry, at the signed fee ceiling', () => {
		const economics = settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 2n * NANO_ETH, maxFeePerGas: 2n * NANO_ETH, rewardAttoEth: 17_043_310_270_400_101n, settings })
		expect(economics.gas).toBe(4_313_492n)
		// The signer adds 20% and 10,000 gas to every estimate; the budget reserves exactly what the two signatures can spend.
		expect(signedSettlementGasLimit(economics.gas)).toBe(paddedTransactionGas(4_313_492n))
		expect(signedSettlementGasLimit(economics.gas)).toBe(5_186_190n)
		expect(signedSettlementGasLimit(rewardWithdrawalGasPlan())).toBe(82_000n)
		expect(economics.projectedGasCostAttoEth).toBe((5_186_190n + 82_000n) * 2n * NANO_ETH)
		expect(economics.netAttoEth).toBe(17_043_310_270_400_101n - economics.projectedGasCostAttoEth)
		expect(economics.profitable).toBeTrue()
		expect(economics.withinGasPriceCap).toBeTrue()
		// The projected price only gates the cap; the cost is what the signature can pay when inclusion is delayed.
		const exposed = settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 2n * NANO_ETH, maxFeePerGas: 4n * NANO_ETH, rewardAttoEth: 17_043_310_270_400_101n, settings })
		expect(exposed.projectedGasCostAttoEth).toBe((5_186_190n + 82_000n) * 4n * NANO_ETH)
		expect(exposed.profitable).toBeFalse()
		expect(exposed.withinGasPriceCap).toBeTrue()
	})

	test('rejects rewards that do not clear the minimum net and gas prices above the cap', () => {
		const thin = settlementEconomics({ callbackGasLimit: 4_000_000n, gasPrice: 4n * NANO_ETH, maxFeePerGas: 4n * NANO_ETH, rewardAttoEth: 17_043_310_270_400_101n, settings })
		expect(thin.netAttoEth).toBeLessThan(settings.minimumProfitAttoWeth)
		expect(thin.profitable).toBeFalse()
		expect(settlementEconomics({ callbackGasLimit: 0n, gasPrice: 1n, maxFeePerGas: 1n, rewardAttoEth: 0n, settings }).profitable).toBeFalse()
		expect(settlementEconomics({ callbackGasLimit: 0n, gasPrice: 11n * NANO_ETH, maxFeePerGas: 10n * NANO_ETH, rewardAttoEth: 10n ** 18n, settings }).withinGasPriceCap).toBeFalse()
	})

	test('signs at the validity-horizon maximum but never above the operator gas price cap', () => {
		// 20 nanoETH compounds to roughly 382 nanoETH over the 25-block horizon; a 50 nanoETH cap bounds the signature and the plan to 50 nanoETH.
		expect(settlementMaxFeePerGas(20n * NANO_ETH, { maxGasPriceAttoEthPerGas: 50n * NANO_ETH })).toBe(50n * NANO_ETH)
		const uncapped = settlementMaxFeePerGas(20n * NANO_ETH, { maxGasPriceAttoEthPerGas: 10_000n * NANO_ETH })
		expect(uncapped).toBeGreaterThan(380n * NANO_ETH)
		expect(uncapped).toBeLessThan(385n * NANO_ETH)
		expect(settlementMaxFeePerGas(0n, { maxGasPriceAttoEthPerGas: 50n * NANO_ETH })).toBe(maximumFeePerGas(0n))
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
		const ready = { dailyGas, enabled: true, execute: true, gasPrice: NANO_ETH, inFlight: false, maxFeePerGas: NANO_ETH, paused: false, settings, signerReady: true, unclaimedRewardAttoEth: 10n ** 16n }
		expect(rewardWithdrawalDecision({ ...ready, unclaimedRewardAttoEth: undefined })).toBe('unavailable')
		expect(rewardWithdrawalDecision({ ...ready, unclaimedRewardAttoEth: 10n ** 16n - 1n })).toBe('below-threshold')
		expect(rewardWithdrawalDecision({ ...ready, gasPrice: 11n * NANO_ETH })).toBe('gas-price-cap')
		// The withdrawal is budgeted at the padded 82,000 gas its signature carries, not the 60,000 estimate.
		expect(rewardWithdrawalDecision({ ...ready, dailyGas: { ...dailyGas, spentAttoWeth: 5n * 10n ** 16n - 82_000n * NANO_ETH } })).toBe('due')
		expect(rewardWithdrawalDecision({ ...ready, dailyGas: { ...dailyGas, spentAttoWeth: 5n * 10n ** 16n - 82_000n * NANO_ETH + 1n } })).toBe('risk-limit')
		// The budget is charged at the signed ceiling, which is what a delayed inclusion can actually pay.
		expect(rewardWithdrawalDecision({ ...ready, dailyGas: { ...dailyGas, spentAttoWeth: 5n * 10n ** 16n - 82_000n * NANO_ETH }, maxFeePerGas: 2n * NANO_ETH })).toBe('risk-limit')
		expect(rewardWithdrawalDecision({ ...ready, enabled: false })).toBe('disabled')
		expect(rewardWithdrawalDecision({ ...ready, execute: false })).toBe('dry-run')
		expect(rewardWithdrawalDecision({ ...ready, signerReady: false })).toBe('signer-unavailable')
		expect(rewardWithdrawalDecision({ ...ready, paused: true })).toBe('paused')
		expect(rewardWithdrawalDecision({ ...ready, inFlight: true })).toBe('in-flight')
		expect(rewardWithdrawalDecision(ready)).toBe('due')
	})
})
