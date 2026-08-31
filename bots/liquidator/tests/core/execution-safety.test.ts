import { describe, expect, test } from 'bun:test'
import { coordinatorAbi } from '../../src/contracts/abi.ts'
import { ambiguousRecoveryAction, PRIVATE_INTENT_FINALITY_BLOCKS, recoveryWorkBlocksExecution, requireRecoveredTransactionSuccess, shouldStopAfterSuccessfulCycle } from '../../src/core/cycle-control.ts'
import { hasStagedLiquidation } from '../../src/core/staged-operations.ts'
import { stagedOperationOutcome } from '../../src/core/staged-outcome.ts'
import {
	assertExecutionActive,
	assertGasCostLimit,
	assertGasCostLimitForBaseFee,
	assertMarketPriceStillAllowed,
	assertRepLimits,
	assertStaleLiquidationExposureBound,
	conservativeStaleTopUp,
	liquidationExecutionStep,
	requireFinalizedTransactionReceipt,
	planVaultMaintenance,
	requirePendingStagedOperation,
	requireSuccessfulStagedOperation,
	validateReceiptExpectation,
} from '../../src/execution/liquidation-executor.ts'
import { encodeAbiParameters, encodeEventTopics, getAddress, type TransactionReceipt } from '../helpers/ethereum.ts'
import { nextStagedHistoricalRecoveryRange, recordStagedRecoveryChunk, recordStagedRecoveryGap, stagedOperationRecoveryRanges, stagedRecoveryAnchorMatches } from '../../src/execution/recovery.ts'
import { availableExecutionObservations } from '../../src/monitoring/execution-quorum.ts'

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
	const operator = getAddress('0x0000000000000000000000000000000000000020')
	const target = getAddress('0x0000000000000000000000000000000000000030')
	const queuedTopics = encodeEventTopics({
		abi: coordinatorAbi,
		args: { operationId: 1n, operator, targetVault: target },
		eventName: 'StagedOperationQueued',
	})
	const routeTopics = encodeEventTopics({ abi: coordinatorAbi, args: { operationId: 1n, operator, receiverVault: operator }, eventName: 'LiquidationRouteStaged' })
	if (queuedTopics.some(topic => topic === null) || routeTopics.some(topic => topic === null)) throw new Error('Test event topics must not contain wildcards')
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
						{ name: 'snapshotTargetCapacityOwnershipAttoRep', type: 'uint256' },
						{ name: 'snapshotTargetOpenInterestAttoEth', type: 'uint256' },
						{ name: 'snapshotTargetDisputeStakedAttoRep', type: 'uint256' },
						{ name: 'snapshotTotalPoolHeldAttoRep', type: 'uint256' },
						{ name: 'snapshotTotalRepBackingUnits', type: 'uint256' },
						{ name: 'isPendingSlot', type: 'bool' },
					],
					[0n, 10n, 1n, 60n, 10n, 10n, 10n, 0n, 10n, 10n, isPendingSlot],
				),
				topics: queuedTopics.filter(topic => topic !== null),
			},
			{
				address: coordinator,
				blockHash: `0x${'11'.repeat(32)}`,
				blockNumber: 1n,
				data: encodeAbiParameters(
					[
						{ name: 'targetVault', type: 'address' },
						{ name: 'approvalId', type: 'bytes32' },
						{ name: 'requestedDebtAttoEth', type: 'uint256' },
						{ name: 'reservedDebtAttoEth', type: 'uint256' },
					],
					[target, `0x${'00'.repeat(32)}`, 10n, 0n],
				),
				topics: routeTopics.filter(topic => topic !== null),
			},
		],
	}
}

describe('liquidator execution safety', () => {
	test('tolerates one offline scan but never hides malformed state behind two agreeing scans', async () => {
		const agreeing = { endpoint: 'rpc-a', state: { blockHash: '0xabc' } }
		const healthy = [Promise.resolve(agreeing), Promise.resolve({ ...agreeing, endpoint: 'rpc-b' }), Promise.reject(new TypeError('fetch failed'))]
		const available = availableExecutionObservations('liquidation snapshot', await Promise.allSettled(healthy), observation => ({ endpoint: observation.endpoint, value: observation.state }), 2)
		expect(available).toHaveLength(2)

		const malformed = [Promise.resolve(agreeing), Promise.resolve({ ...agreeing, endpoint: 'rpc-b' }), Promise.reject(new Error('Constant-product pair returned malformed state'))]
		const malformedSettled = await Promise.allSettled(malformed)
		expect(() => availableExecutionObservations('liquidation snapshot', malformedSettled, observation => ({ endpoint: observation.endpoint, value: observation.state }), 2)).toThrow('malformed state')
	})

	test('classifies insufficient transport-only scan observations as degraded connectivity under the explicit quorum policy', () => {
		const unavailable = new TypeError('fetch failed')
		const settled: PromiseSettledResult<{ endpoint: string; value: bigint }>[] = [
			{ status: 'fulfilled', value: { endpoint: 'rpc-a', value: 1n } },
			{ reason: unavailable, status: 'rejected' },
			{ reason: unavailable, status: 'rejected' },
		]
		try {
			availableExecutionObservations('scan', settled, value => value, 2)
			throw new Error('Expected an insufficient transport quorum')
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			if (!(error instanceof Error)) throw error
			expect(error.name).toBe('ConnectivityDegradedError')
		}
	})
	test('fails closed when an available execution reader disagrees on wallet REP balance', async () => {
		const observations = await Promise.allSettled([Promise.resolve({ endpoint: 'rpc-a', walletRepByToken: [['0xrep', 10n]] }), Promise.resolve({ endpoint: 'rpc-b', walletRepByToken: [['0xrep', 10n]] }), Promise.resolve({ endpoint: 'rpc-c', walletRepByToken: [['0xrep', 11n]] })])
		expect(() => availableExecutionObservations('liquidation execution snapshot', observations, observation => ({ endpoint: observation.endpoint, value: observation.walletRepByToken }), 2)).toThrow('RPC disagreement')
	})
	test('chunks staged-operation recovery across bounded inclusive log ranges', () => {
		expect(stagedOperationRecoveryRanges(5n, 25_005n)).toEqual([{ fromBlock: 24_750n, toBlock: 25_005n }])
	})

	test('invalidates a staged-operation recovery cursor when its canonical anchor changes or moves above the head', () => {
		const pending = { recoveryAnchorBlock: 100n, recoveryAnchorHash: `0x${'11'.repeat(32)}` as const }
		expect(stagedRecoveryAnchorMatches(pending, 110n, `0x${'11'.repeat(32)}`)).toBe(true)
		expect(stagedRecoveryAnchorMatches(pending, 110n, `0x${'22'.repeat(32)}`)).toBe(false)
		expect(stagedRecoveryAnchorMatches(pending, 99n, undefined)).toBe(false)
	})

	test('retains a provisional staged outcome without advancing past it and marks exhausted history complete', () => {
		const pending = {
			coordinator,
			operationId: 1n,
			queuedBlock: 1n,
			target: getAddress('0x0000000000000000000000000000000000000030'),
		}
		const candidate = {
			blockHash: `0x${'11'.repeat(32)}` as const,
			blockNumber: 10n,
			errorMessage: '',
			operation: 0n,
			operationId: 1n,
			success: true,
			transactionHash: `0x${'22'.repeat(32)}` as const,
		}
		recordStagedRecoveryChunk(pending, { fromBlock: 10n, toBlock: 20n }, candidate, false)
		expect(pending).toMatchObject({ candidateOutcome: candidate })
		expect(Reflect.has(pending, 'latestRecoveryBlock')).toBe(false)
		recordStagedRecoveryChunk(pending, { fromBlock: 1n, toBlock: 9n }, undefined, true)
		expect(pending).toMatchObject({ historicalRecoveryComplete: true })
		expect(Reflect.has(pending, 'nextHistoricalBlock')).toBe(true)
		expect(Reflect.get(pending, 'nextHistoricalBlock')).toBeUndefined()
	})

	test('adds a head-jump gap above an active historical backfill without losing coverage', () => {
		const pending = {
			coordinator,
			historicalRecoveryComplete: false,
			latestRecoveryBlock: 1_000n,
			nextHistoricalBlock: 488n,
			operationId: 1n,
			queuedBlock: 1n,
			target: getAddress('0x0000000000000000000000000000000000000030'),
		}
		recordStagedRecoveryGap(pending, 1_001n, 1_745n)
		expect(pending.nextHistoricalBlock).toBe(1_744n)

		const covered = [{ fromBlock: 1_745n, toBlock: 2_000n }]
		for (;;) {
			const range = nextStagedHistoricalRecoveryRange(pending, 256n)
			if (range === undefined) break
			covered.push(range)
			recordStagedRecoveryChunk(pending, range, undefined, true)
		}
		const ascending = covered.toSorted((left, right) => (left.fromBlock < right.fromBlock ? -1 : 1))
		expect(ascending[0]?.fromBlock).toBe(1n)
		expect(ascending.at(-1)?.toBlock).toBe(2_000n)
		for (let index = 1; index < ascending.length; index++) expect(ascending[index]?.fromBlock).toBe((ascending[index - 1]?.toBlock ?? 0n) + 1n)

		const recovery = { ...pending, historicalRecoveryComplete: false, nextHistoricalBlock: 1_744n }
		const gapRange = nextStagedHistoricalRecoveryRange(recovery, 256n)
		expect(gapRange).toEqual({ fromBlock: 1_489n, toBlock: 1_744n })
		expect(gapRange !== undefined && gapRange.fromBlock <= 1_600n && gapRange.toBlock >= 1_600n).toBe(true)
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
				currentPoolAttoRep: 90n,
				currentTotalAttoRep: 150n,
				depositAmountAttoRep: 11n,
				maximumPoolAttoRep: 100n,
				maximumTotalAttoRep: 1_000n,
			}),
		).toThrow('maximumAttoRepPerPool')
		expect(() =>
			assertRepLimits({
				currentPoolAttoRep: 50n,
				currentTotalAttoRep: 195n,
				depositAmountAttoRep: 6n,
				maximumPoolAttoRep: 100n,
				maximumTotalAttoRep: 200n,
			}),
		).toThrow('maximumTotalDeployedRep')
	})

	test('counts REP acquired by liquidation toward both exposure limits', () => {
		expect(() =>
			assertRepLimits({
				acquiredAmountAttoRep: 20n,
				currentPoolAttoRep: 70n,
				currentTotalAttoRep: 100n,
				depositAmountAttoRep: 11n,
				maximumPoolAttoRep: 100n,
				maximumTotalAttoRep: 1_000n,
			}),
		).toThrow('maximumAttoRepPerPool')
	})

	test('deposits liquidation top-ups without capacity ownership and rescans before staging', () => {
		const step = liquidationExecutionStep(100n * 10n ** 18n)
		expect(step.kind).toBe('deposit-and-rescreen')
		if (step.kind !== 'deposit-and-rescreen') throw new Error('Expected a deposit-and-rescreen step')
		expect((100n * 10n ** 18n * 10_000n) / step.targetHealthFactorBps).toBe(0n)
		expect(liquidationExecutionStep(0n)).toEqual({ kind: 'stage' })
	})

	test('preserves a prefund through the fresh scan and then stages the rescreened candidate', () => {
		const wallet = getAddress('0x0000000000000000000000000000000000000020')
		const pool = {
			botVault: {
				address: wallet,
				backingUnits: 30n,
				badDebtAttoEth: 0n,
				capacityOwnershipAttoRep: 0n,
				claimableFeesAttoEth: 0n,
				disputeStakedAttoRep: 0n,
				openInterestAttoEth: 0n,
				vaultAttoRepBacking: 30n,
			},
			isPriceValid: true,
			lastPrice: 1n,
			minimumVaultRepDepositAttoRep: 30n,
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
		expect(planVaultMaintenance(pool, strategy, wallet, true, true)).toBeUndefined()
		expect(liquidationExecutionStep(0n)).toEqual({ kind: 'stage' })
	})

	test('keeps fee redemption available when price-dependent maintenance is blocked', () => {
		const wallet = getAddress('0x0000000000000000000000000000000000000020')
		const pool = {
			botVault: {
				address: wallet,
				badDebtAttoEth: 0n,
				capacityOwnershipAttoRep: 0n,
				openInterestAttoEth: 10n,
				backingUnits: 0n,
				vaultAttoRepBacking: 0n,
				claimableFeesAttoEth: 2n,
				disputeStakedAttoRep: 0n,
			},
			isPriceValid: false,
			lastPrice: 0n,
			minimumVaultRepDepositAttoRep: 1n,
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
				badDebtAttoEth: 0n,
				capacityOwnershipAttoRep: 0n,
				openInterestAttoEth: 0n,
				backingUnits: 0n,
				vaultAttoRepBacking: 0n,
				claimableFeesAttoEth: 0n,
				disputeStakedAttoRep: 0n,
			},
			isPriceValid: false,
			lastPrice: 0n,
			minimumVaultRepDepositAttoRep: 1n,
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
				callerOpenInterestAttoEth: 0n,
				callerAttoRep: 0n,
				requestedDebtAttoEth: 10n * 10n ** 18n,
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
				requestedDebtAttoEth: 1n,
				target: {
					address: getAddress('0x0000000000000000000000000000000000000030'),
					badDebtAttoEth: 0n,
					capacityOwnershipAttoRep: 1n,
					openInterestAttoEth: 1n,
					backingUnits: 10n,
					vaultAttoRepBacking: 10n,
					claimableFeesAttoEth: 0n,
					disputeStakedAttoRep: 0n,
				},
			}),
		).toThrow('cannot guarantee')
	})

	test('applies the gas cap to the padded signed gas limit', () => {
		expect(() => assertGasCostLimit(100_000n, 10n, 1_100_000n)).toThrow('maximumGasCostAttoEth')
		expect(() => assertGasCostLimit(100_000n, 10n, 1_300_000n)).not.toThrow()
	})

	test('applies the exact signed-transaction fee horizon to the gas-cap precheck', () => {
		const baseFeePerGas = 10n * 10n ** 9n
		const capThatOnlyCoversTheFormerDoubleBaseFeeEstimate = 3_000_000_000_000_000n
		expect(() => assertGasCostLimitForBaseFee(100_000n, baseFeePerGas, capThatOnlyCoversTheFormerDoubleBaseFeeEstimate)).toThrow('maximumGasCostAttoEth')
	})

	test('does not treat a successful outer receipt as a successful failed staged operation', () => {
		expect(() => requireSuccessfulStagedOperation(stagedOperationReceipt(false), coordinator, 0)).toThrow('liquidation too close to threshold')
		expect(() => requireSuccessfulStagedOperation(stagedOperationReceipt(true), coordinator, 0)).not.toThrow()
	})

	test('requires a stale liquidation to occupy the pending settlement slot', () => {
		const initiator = getAddress('0x0000000000000000000000000000000000000020')
		const target = getAddress('0x0000000000000000000000000000000000000030')
		expect(() => requirePendingStagedOperation(queuedLiquidationReceipt(false), coordinator, initiator, initiator, target, 10n)).toThrow('pending settlement slot')
		expect(() => requirePendingStagedOperation(queuedLiquidationReceipt(true), coordinator, initiator, initiator, target, 10n)).not.toThrow()
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

	test('blocks new execution until transaction and staged-operation recovery both finish', async () => {
		const state: { pendingStagedOperations: object[]; pendingTransactions: object[] } = {
			pendingStagedOperations: [],
			pendingTransactions: [{}],
		}
		const order: string[] = []
		const blocked = await recoveryWorkBlocksExecution(
			state,
			async () => {
				order.push('transactions')
				state.pendingTransactions = []
				state.pendingStagedOperations = [{}]
				return false
			},
			async () => {
				order.push('staged')
			},
		)

		expect(blocked).toBe(true)
		expect(order).toEqual(['transactions', 'staged'])

		const recovered = await recoveryWorkBlocksExecution(
			state,
			async () => false,
			async () => {
				state.pendingStagedOperations = []
			},
		)
		expect(recovered).toBe(false)
	})

	test('suppresses a liquidation already staged by this bot across later cycles', () => {
		expect(
			hasStagedLiquidation(
				[
					{
						operationAmountAttoRepOrAttoEth: 1n,
						id: 7n,
						liquidationApprovalId: `0x${'00'.repeat(32)}`,
						isPendingSettlement: true,
						operation: 0n,
						operator: getAddress('0x0000000000000000000000000000000000000020'),
						queuedAt: 1n,
						receiverVault: getAddress('0x0000000000000000000000000000000000000020'),
						reservedLiquidationDebtAttoEth: 0n,
						snapshotTotalRepBackingUnits: 1n,
						snapshotTargetCapacityOwnershipAttoRep: 1n,
						snapshotTargetDisputeStakedAttoRep: 0n,
						snapshotTargetOpenInterestAttoEth: 1n,
						snapshotTargetBackingUnits: 1n,
						snapshotTotalPoolHeldAttoRep: 1n,
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
