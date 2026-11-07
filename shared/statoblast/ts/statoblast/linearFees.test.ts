import { expect, test } from 'bun:test'
import { previewLinearFeeCheckpoint } from './linearFees.js'

const state = { linearFee: { rateAttoEthPerSecond: 3n, endTime: 100n }, currentTimestamp: 30n, feeEndTimestamp: 90n, lastUpdatedFeeAccumulator: 10n, settlementCollateralAttoEth: 300n }

test('linear fees debit the fixed funded slope without exponential decay or checkpoint-frequency bias', () => {
	const full = previewLinearFeeCheckpoint(state)
	expect(full).toEqual({ estimatedRetentionFeeAttoEth: 60n, settlementCollateralAfterFeesAttoEth: 240n })
	const first = previewLinearFeeCheckpoint({ ...state, currentTimestamp: 20n })
	if (first === undefined) throw new Error('Expected valid funded fees')
	expect(previewLinearFeeCheckpoint({ ...state, settlementCollateralAttoEth: first.settlementCollateralAfterFeesAttoEth, lastUpdatedFeeAccumulator: 20n })?.settlementCollateralAfterFeesAttoEth).toBe(full?.settlementCollateralAfterFeesAttoEth)
})

test('linear projection stops at both funded expiry and the earlier question or fork cutoff', () => {
	expect(previewLinearFeeCheckpoint({ ...state, currentTimestamp: 1000n })?.estimatedRetentionFeeAttoEth).toBe(240n)
	expect(previewLinearFeeCheckpoint({ ...state, currentTimestamp: 1000n, feeEndTimestamp: 1000n })?.estimatedRetentionFeeAttoEth).toBe(270n)
	expect(previewLinearFeeCheckpoint({ ...state, currentTimestamp: 5n })?.estimatedRetentionFeeAttoEth).toBe(0n)
	expect(previewLinearFeeCheckpoint({ ...state, linearFee: { rateAttoEthPerSecond: 0n, endTime: 0n } })?.estimatedRetentionFeeAttoEth).toBe(0n)
	expect(previewLinearFeeCheckpoint({ ...state, settlementCollateralAttoEth: 59n })).toBeUndefined()
})
