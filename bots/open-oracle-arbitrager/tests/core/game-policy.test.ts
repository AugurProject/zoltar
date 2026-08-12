import { describe, expect, test } from 'bun:test'
import type { Address } from '#ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { gamePolicyMismatch, retainedReportIds, type CoordinatorGamePolicy } from '#core/game-policy'

const coordinator = '0x0000000000000000000000000000000000000001' as Address
const other = '0x0000000000000000000000000000000000000002' as Address
const openOracle = '0x0000000000000000000000000000000000000003' as Address
const weth = '0x0000000000000000000000000000000000000004' as Address
const rep = '0x0000000000000000000000000000000000000005' as Address
const feeRecipient = '0x0000000000000000000000000000000000000006' as Address

const policy = {
	callbackGasLimit: 4_000_000n,
	coordinator,
	disputeDelay: 60n,
	feePercentage: 10_000n,
	flags: OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_STORE_ALL,
	multiplier: 140n,
	openOracle,
	protocolFee: 20_000n,
	protocolFeeRecipient: feeRecipient,
	settlementTime: 86_400n,
	token1: weth,
	token2: rep,
} satisfies CoordinatorGamePolicy

const report = {
	game: {
		callbackContract: coordinator,
		callbackGasLimit: policy.callbackGasLimit,
		currentAmount1: 1_000_000n,
		currentAmount2: 2_000_000n,
		currentReporter: other,
		disputeDelay: policy.disputeDelay,
		escalationHalt: 10_000_000n,
		feePercentage: policy.feePercentage,
		flags: policy.flags,
		lastReportOppoTime: 99n,
		multiplier: policy.multiplier,
		numReports: 2n,
		protocolFee: policy.protocolFee,
		protocolFeeRecipient: policy.protocolFeeRecipient,
		reportTimestamp: 100n,
		settlementTime: policy.settlementTime,
		settlementTimestamp: 0n,
		settlerRewardAttoEth: 1n,
		token1: weth,
		token2: rep,
	},
	helper: {
		blockNumber: 90n,
		blockTimestamp: 95n,
		creator: coordinator,
		reportId: 7n,
	},
} satisfies OpenOracleStatePreimage

describe('trusted coordinator game policy', () => {
	test('accepts only the exact safe coordinator template', () => {
		expect(gamePolicyMismatch(report, [policy], openOracle)).toBeUndefined()
		expect(gamePolicyMismatch({ ...report, helper: { ...report.helper, creator: other } }, [policy], openOracle)).toBe('Report creator is not an approved coordinator')
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, callbackContract: other } }, [policy], openOracle)).toBe('Settlement callback is not the report coordinator')
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, callbackGasLimit: 4_000_001n } }, [policy], openOracle)).toBe('Callback gas limit differs from the approved coordinator template')
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, multiplier: 141n } }, [policy], openOracle)).toBe('Multiplier differs from the approved coordinator template')
	})

	test('rejects unsafe parameters even when a configured coordinator exposes them', () => {
		const unsafeCallback = { ...policy, callbackGasLimit: 2n ** 32n - 1n }
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, callbackGasLimit: unsafeCallback.callbackGasLimit } }, [unsafeCallback], openOracle)).toBe('Callback gas limit exceeds the arbitrager safety bound')
		const unsafeSettlement = { ...policy, settlementTime: 604_801n }
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, settlementTime: unsafeSettlement.settlementTime } }, [unsafeSettlement], openOracle)).toBe('Settlement time exceeds the arbitrager safety bound')
		const unsafeMultiplier = { ...policy, multiplier: 201n }
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, multiplier: unsafeMultiplier.multiplier } }, [unsafeMultiplier], openOracle)).toBe('Multiplier exceeds the arbitrager safety bound')
		const noStoredState = { ...policy, flags: policy.flags & ~OPEN_ORACLE_FLAG_STORE_ALL }
		expect(gamePolicyMismatch({ ...report, game: { ...report.game, flags: noStoredState.flags } }, [noStoredState], openOracle)).toBe('Stored OpenOracle state is required for durable lifecycle recovery')
	})

	test('retains only approved reports in execution mode and bounds diagnostic reports', () => {
		const reports = new Map([
			[1n, { latest: report }],
			[2n, { latest: { ...report, helper: { ...report.helper, creator: other, reportId: 2n } } }],
			[3n, { latest: { ...report, helper: { ...report.helper, creator: other, reportId: 3n } } }],
		])
		expect([...retainedReportIds(reports, [policy], openOracle, 2)]).toEqual([1n])
		expect([...retainedReportIds(reports, [], openOracle, 2)]).toEqual([3n, 2n])
	})
})
