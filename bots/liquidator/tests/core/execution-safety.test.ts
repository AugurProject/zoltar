import { describe, expect, test } from 'bun:test'
import { coordinatorAbi } from '../../src/contracts/abi.ts'
import { ambiguousRecoveryAction, PRIVATE_INTENT_FINALITY_BLOCKS, requireRecoveredTransactionSuccess, shouldStopAfterSuccessfulCycle } from '../../src/core/cycle-control.ts'
import { hasStagedLiquidation } from '../../src/core/staged-operations.ts'
import { stagedOperationOutcome } from '../../src/core/staged-outcome.ts'
import {
	assertExecutionActive,
	assertGasCostLimit,
	assertMarketPriceStillAllowed,
	assertRepLimits,
	assertStaleLiquidationExposureBound,
	conservativeStaleTopUp,
	requireFinalizedTransactionReceipt,
	planVaultMaintenance,
	requirePendingStagedOperation,
	requireSuccessfulStagedOperation,
	validateReceiptExpectation,
} from '../../src/execution/liquidation-executor.ts'
import { encodeAbiParameters, encodeEventTopics, getAddress, type TransactionReceipt } from '../helpers/ethereum.ts'
import { stagedOperationRecoveryRanges } from '../../src/execution/recovery.ts'

const coordinator = getAddress('0x0000000000000000000000000000000000000010')

function stagedOperationReceipt(success: boolean): TransactionReceipt {
	const topics = encodeEventTopics({
		abi: coordinatorAbi,
		args: { errorMessage: success ? '' : 'liquidation too close to threshold', operation: 0n, operationId: 1n, success },
		eventName: 'ExecutedStagedOperation',
	})
	if (topics.some(topic => topic === null)) throw new Error('Test event topics must not contain wildcards')
	return {
		blockHash: `0x${'11'.repeat(32)}`,
		blockNumber: 1n,
		cumulativeGasUsed: 1n,
		from: getAddress('0x0000000000000000000000000000000000000020'),
		gasUsed: 1n,
		logs: [
			{
				address: coordinator,
				blockHash: `0x${'11'.repeat(32)}`,
				blockNumber: 1n,
				data: encodeAbiParameters(
					[
						{ name: 'operation', type: 'uint8' },
						{ name: 'success', type: 'bool' },
						{ name: 'errorMessage', type: 'string' },
					],
					[0n, success, success ? '' : 'liquidation too close to threshold'],
				),
				topics: topics.filter(topic => topic !== null),
			},
		],
		status: 'success',
		to: coordinator,
		transactionHash: `0x${'22'.repeat(32)}`,
		transactionIndex: 0n,
	}
}

function queuedLiquidationReceipt(isPendingSlot: boolean): TransactionReceipt {
	const initiator = getAddress('0x0000000000000000000000000000000000000020')
	const target = getAddress('0x0000000000000000000000000000000000000030')
	const topics = encodeEventTopics({
		abi: coordinatorAbi,
		args: { initiatorVault: initiator, operationId: 1n, targetVault: target },
		eventName: 'StagedOperationQueued',
	})
	if (topics.some(topic => topic === null)) throw new Error('Test event topics must not contain wildcards')
	return {
		...stagedOperationReceipt(true),
		logs: [
			{
				address: coordinator,
				blockHash: `0x${'11'.repeat(32)}`,
				blockNumber: 1n,
				data: encodeAbiParameters(
					[
						{ name: 'operation', type: 'uint8' },
						{ name: 'operationAmountAttoRepOrAttoEth', type: 'uint256' },
						{ name: 'queuedAt', type: 'uint256' },
						{ name: 'validForSeconds', type: 'uint256' },
						{ name: 'snapshotTargetBackingUnits', type: 'uint256' },
						{ name: 'snapshotTargetCoverageCommitmentAttoEth', type: 'uint256' },
						{ name: 'snapshotTotalPoolHeldRepAttoRep', type: 'uint256' },
						{ name: 'snapshotTotalRepBackingUnits', type: 'uint256' },
						{ name: 'isPendingSlot', type: 'bool' },
					],
					[0n, 10n, 1n, 60n, 10n, 10n, 10n, 10n, isPendingSlot],
				),
				topics: topics.filter(topic => topic !== null),
			},
		],
	}
}

describe('liquidator execution safety', () => {
	test('chunks staged-operation recovery across bounded inclusive log ranges', () => {
		expect(stagedOperationRecoveryRanges(5n, 25_005n)).toEqual([
			{ fromBlock: 5n, toBlock: 10_004n },
			{ fromBlock: 10_005n, toBlock: 20_004n },
			{ fromBlock: 20_005n, toBlock: 25_005n },
		])
	})
	test('rechecks market consensus immediately before price-dependent submission', async () => {
		await expect(assertMarketPriceStillAllowed(async () => true)).resolves.toBeUndefined()
		await expect(assertMarketPriceStillAllowed(async () => false)).rejects.toThrow('Market consensus expired')
	})
	test('rechecks an operator pause at transaction boundaries', () => {
		expect(() => assertExecutionActive({ paused: false })).not.toThrow()
		expect(() => assertExecutionActive({ paused: true })).toThrow('Operator paused before transaction submission')
	})

	test('continues successful polling unless once mode is enabled', () => {
		expect(shouldStopAfterSuccessfulCycle(false)).toBe(false)
		expect(shouldStopAfterSuccessfulCycle(true)).toBe(true)
	})

	test('pauses instead of continuing after restart recovers a reverted transaction', () => {
		expect(() => requireRecoveredTransactionSuccess('reverted', `0x${'11'.repeat(32)}`)).toThrow('reverted')
		expect(() => requireRecoveredTransactionSuccess('success', `0x${'11'.repeat(32)}`)).not.toThrow()
	})

	test('stops a dependent transaction sequence while the first receipt awaits canonical finality', () => {
		let dependentTransactionStarted = false
		expect(() => {
			requireFinalizedTransactionReceipt('Approve REP', `0x${'11'.repeat(32)}`, { observed: true, receipt: undefined })
			dependentTransactionStarted = true
		}).toThrow('awaiting canonical finality')
		expect(dependentTransactionStarted).toBe(false)
	})

	test('retains ambiguous price-dependent intents until a receipt or private finality proof exists', () => {
		const publicIntent = { maxBlockNumber: 100n, mode: 'public' as const, requiresMarketEvidence: true }
		const privateIntent = { ...publicIntent, mode: 'private' as const }
		expect(ambiguousRecoveryAction(publicIntent, [1_000n, 1_000n])).toBe('retain')
		expect(ambiguousRecoveryAction(privateIntent, [100n + PRIVATE_INTENT_FINALITY_BLOCKS - 1n, 1_000n])).toBe('retain')
		expect(ambiguousRecoveryAction(privateIntent, [100n + PRIVATE_INTENT_FINALITY_BLOCKS, 1_000n])).toBe('expire-private')
		expect(ambiguousRecoveryAction({ ...publicIntent, requiresMarketEvidence: false }, [100n])).toBe('resubmit')
	})

	test('enforces per-pool and aggregate REP exposure for maintenance deposits', () => {
		expect(() =>
			assertRepLimits({
				currentPoolRepAttoRep: 90n,
				currentPoolHeldRepBalanceAttoRep: 150n,
				depositAmount: 11n,
				maximumPoolRepAttoRep: 100n,
				maximumTotalRepAttoRep: 1_000n,
			}),
		).toThrow('maximumRepPerPoolAttoRep')
		expect(() =>
			assertRepLimits({
				currentPoolRepAttoRep: 50n,
				currentPoolHeldRepBalanceAttoRep: 195n,
				depositAmount: 6n,
				maximumPoolRepAttoRep: 100n,
				maximumTotalRepAttoRep: 200n,
			}),
		).toThrow('maximumTotalDeployedRepAttoRep')
	})

	test('counts REP acquired by liquidation toward both exposure limits', () => {
		expect(() =>
			assertRepLimits({
				acquiredAmount: 20n,
				currentPoolRepAttoRep: 70n,
				currentPoolHeldRepBalanceAttoRep: 100n,
				depositAmount: 11n,
				maximumPoolRepAttoRep: 100n,
				maximumTotalRepAttoRep: 1_000n,
			}),
		).toThrow('maximumRepPerPoolAttoRep')
	})

	test('keeps fee redemption available when price-dependent maintenance is blocked', () => {
		const wallet = getAddress('0x0000000000000000000000000000000000000020')
		const pool = {
			botVault: {
				address: wallet,
				coverageCommitmentAttoEth: 10n,
				backingUnits: 0n,
				vaultRepBackingAttoRep: 0n,
				claimableFeesAttoEth: 2n,
			},
			isPriceValid: false,
			lastPrice: 0n,
			multiplierBps: 20_000n,
		}
		const strategy = {
			allowAutomaticWithdrawals: true,
			minimumRepWithdrawalAttoRep: 1n,
			redeemFeesAboveAttoEth: 1n,
			vaultTargetHealthBps: 12_500n,
			vaultTopUpHealthBps: 11_000n,
			vaultWithdrawHealthBps: 15_000n,
		}
		expect(planVaultMaintenance(pool, strategy, wallet, false)).toEqual({ kind: 'fees' })
		expect(planVaultMaintenance(pool, strategy, wallet, true)).toEqual({ kind: 'fees' })
	})

	test('does not redeem zero fees when the configured threshold is zero', () => {
		const wallet = getAddress('0x0000000000000000000000000000000000000020')
		const pool = {
			botVault: {
				address: wallet,
				coverageCommitmentAttoEth: 0n,
				backingUnits: 0n,
				vaultRepBackingAttoRep: 0n,
				claimableFeesAttoEth: 0n,
			},
			isPriceValid: false,
			lastPrice: 0n,
			multiplierBps: 20_000n,
		}
		const strategy = {
			allowAutomaticWithdrawals: false,
			minimumRepWithdrawalAttoRep: 1n,
			redeemFeesAboveAttoEth: 0n,
			vaultTargetHealthBps: 12_500n,
			vaultTopUpHealthBps: 11_000n,
			vaultWithdrawHealthBps: 15_000n,
		}
		expect(planVaultMaintenance(pool, strategy, wallet, false)).toBeUndefined()
		expect(planVaultMaintenance({ ...pool, botVault: { ...pool.botVault, claimableFeesAttoEth: 1n } }, strategy, wallet, false)).toEqual({ kind: 'fees' })
	})

	test('pre-funds stale liquidations against the configured higher price bound', () => {
		expect(
			conservativeStaleTopUp({
				callerCoverageCommitmentAttoEth: 0n,
				callerRepAttoRep: 0n,
				coverageCommitmentToTransferAttoEth: 10n * 10n ** 18n,
				fallbackPrice: 0n,
				minimumTopUp: 100n * 10n ** 18n,
				multiplierBps: 20_000n,
				referencePrice: 10n * 10n ** 18n,
				safetyBps: 15_000n,
				targetHealthBps: 12_500n,
			}),
		).toBe(375n * 10n ** 18n)
	})

	test('rejects stale full closes whose post-queue REP acquisition has no hard ceiling', () => {
		expect(() =>
			assertStaleLiquidationExposureBound({
				coverageCommitmentToTransferAttoEth: 1n,
				target: {
					address: getAddress('0x0000000000000000000000000000000000000030'),
					coverageCommitmentAttoEth: 1n,
					backingUnits: 10n,
					vaultRepBackingAttoRep: 10n,
					claimableFeesAttoEth: 0n,
				},
			}),
		).toThrow('cannot guarantee')
	})

	test('applies the gas cap to the padded signed gas limit', () => {
		expect(() => assertGasCostLimit(100_000n, 10n, 1_100_000n)).toThrow('maximumGasCostAttoEth')
		expect(() => assertGasCostLimit(100_000n, 10n, 1_300_000n)).not.toThrow()
	})

	test('does not treat a successful outer receipt as a successful failed staged operation', () => {
		expect(() => requireSuccessfulStagedOperation(stagedOperationReceipt(false), coordinator, 0)).toThrow('liquidation too close to threshold')
		expect(() => requireSuccessfulStagedOperation(stagedOperationReceipt(true), coordinator, 0)).not.toThrow()
	})

	test('requires a stale liquidation to occupy the pending settlement slot', () => {
		const initiator = getAddress('0x0000000000000000000000000000000000000020')
		const target = getAddress('0x0000000000000000000000000000000000000030')
		expect(() => requirePendingStagedOperation(queuedLiquidationReceipt(false), coordinator, initiator, target, 10n)).toThrow('pending settlement slot')
		expect(() => requirePendingStagedOperation(queuedLiquidationReceipt(true), coordinator, initiator, target, 10n)).not.toThrow()
	})

	test('applies the persisted semantic receipt expectation during recovery', () => {
		expect(() => validateReceiptExpectation(stagedOperationReceipt(false), { coordinator, operation: 0, type: 'staged-success' })).toThrow('liquidation too close to threshold')
		expect(() => validateReceiptExpectation(stagedOperationReceipt(true), { coordinator, operation: 0, type: 'staged-success' })).not.toThrow()
	})

	test('reconciles the eventual outcome of a queued stale liquidation', () => {
		const failedLog = stagedOperationReceipt(false).logs[0]
		const successfulLog = stagedOperationReceipt(true).logs[0]
		if (failedLog === undefined || successfulLog === undefined) throw new Error('Test receipt must contain an outcome log')
		expect(stagedOperationOutcome(failedLog, 1n)).toEqual({
			errorMessage: 'liquidation too close to threshold',
			operation: 0n,
			operationId: 1n,
			success: false,
		})
		expect(stagedOperationOutcome(successfulLog, 1n)?.success).toBe(true)
		expect(stagedOperationOutcome(successfulLog, 2n)).toBeUndefined()
	})

	test('suppresses a liquidation already staged by this bot across later cycles', () => {
		expect(
			hasStagedLiquidation(
				[
					{
						amount: 1n,
						id: 7n,
						initiatorVault: getAddress('0x0000000000000000000000000000000000000020'),
						isPendingSettlement: true,
						operation: 0n,
						queuedAt: 1n,
						snapshotTotalRepBackingUnits: 1n,
						snapshotTargetCoverageCommitmentAttoEth: 1n,
						snapshotTargetBackingUnits: 1n,
						snapshotTotalPoolHeldRepAttoRep: 1n,
						targetVault: getAddress('0x0000000000000000000000000000000000000030'),
						validForSeconds: 60n,
					},
				],
				getAddress('0x0000000000000000000000000000000000000020'),
				getAddress('0x0000000000000000000000000000000000000030'),
			),
		).toBe(true)
	})
})
