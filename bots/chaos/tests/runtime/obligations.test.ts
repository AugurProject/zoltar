import { describe, expect, test } from 'bun:test'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'
import {
	abandonLifecycleObligation,
	beginLifecycleObligation,
	completeLifecycleObligation,
	failLifecycleObligation,
	lifecyclePresenceBlockerMessage,
	MAXIMUM_ACTIVE_LIFECYCLE_OBLIGATIONS,
	obligationForPlan,
	retryLifecycleObligation,
	synchronizeLifecycleObligations as synchronizeLifecycleObligationsAtAnchor,
	waitForCanonicalLifecycleConfirmation,
} from '../../src/runtime/obligations.ts'
import { markWorkflowStepWaitingCanonical } from '../../src/runtime/workflows.ts'
import { compactDurableState, MAXIMUM_OBLIGATION_TOMBSTONE_COUNT, type DurableObligation, type DurableObligationTombstone, type DurableWorkflow } from '../../src/state/operator-state.ts'

function obligationState() {
	return {
		lastScannedBlock: 10n,
		lifecyclePresenceBlocker: undefined,
		obligationTombstones: [] as DurableObligationTombstone[],
		obligations: [] as DurableObligation[],
		pendingTransactions: [],
		workflows: [] as DurableWorkflow[],
	}
}

function synchronizeLifecycleObligations(state: ReturnType<typeof obligationState>, evaluations: readonly EvaluatedOperation[], canonicalPresence: ReturnType<typeof presence>, presenceComplete: boolean, currentBlock: bigint, currentTimestamp = 0n) {
	return synchronizeLifecycleObligationsAtAnchor(state, evaluations, canonicalPresence, presenceComplete, currentBlock, currentTimestamp)
}

function plan(block: string): OperationPlan {
	return {
		classification: 'lifecycle-obligation',
		createdAtBlock: block,
		definitionId: 'open-oracle.settle',
		ecosystem: 'open-oracle',
		id: `settle:${block}`,
		label: 'Settle report',
		metadata: { reportId: '7' },
		obligation: true,
		planningSeed: 1,
		postconditions: [],
		priority: 'urgent',
		risk: 'low',
		steps: [
			{
				data: '0x1234',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '100000',
				id: 'settle',
				label: 'Settle report 7',
				preflightCalls: [],
				to: '0x0000000000000000000000000000000000000001',
				walletAssetDebits: [],
			},
		],
	}
}

function evaluation(value: OperationPlan): EvaluatedOperation {
	return {
		definition: {
			classification: 'lifecycle-obligation',
			contract: value.ecosystem === 'statoblast' ? 'SecurityPool' : 'OpenOracle',
			description: 'settles',
			discoveryInputs: [],
			ecosystem: value.ecosystem,
			id: value.definitionId,
			label: value.label,
			method: value.ecosystem === 'statoblast' ? 'withdrawForkedEscalationDeposits' : 'settle',
			risk: 'low',
		},
		eligibility: { blockers: [], eligible: true },
		plan: value,
	}
}

function carryPlan(parentDepositIndex: string, block = '10'): OperationPlan {
	return {
		...plan(block),
		definitionId: 'statoblast.escalation.withdraw-forked',
		ecosystem: 'statoblast',
		id: `withdraw-forked:${parentDepositIndex}:${block}`,
		label: 'Withdraw forked escalation deposit',
		metadata: {
			game: '0x0000000000000000000000000000000000000002',
			outcome: 1,
			parentDepositIndex,
			pool: '0x0000000000000000000000000000000000000003',
			sourceGame: '0x0000000000000000000000000000000000000004',
			sourceNodeId: parentDepositIndex,
		},
	}
}

function refundPlan(refundGeneration: string, block = '10'): OperationPlan {
	return {
		...plan(block),
		definitionId: 'statoblast.auction.withdraw-refund',
		ecosystem: 'statoblast',
		id: `withdraw-refund:${refundGeneration}:${block}`,
		label: 'Withdraw deferred auction refund',
		metadata: {
			auction: '0x0000000000000000000000000000000000000005',
			refundGeneration,
		},
	}
}

function presence(value: OperationPlan, blocksNovelty = true) {
	return [
		{
			blocksNovelty,
			definitionId: value.definitionId,
			ecosystem: value.ecosystem,
			metadata: value.metadata,
		},
	]
}

describe('durable lifecycle obligations', () => {
	test('durably blocks novelty for a fresh canonical identity without fabricating executable work', () => {
		const value = plan('10')
		const state = obligationState()

		synchronizeLifecycleObligations(state, [], [...presence(value), ...presence(value)], true, 10n, 0n)

		expect(state.lifecyclePresenceBlocker).toEqual(
			expect.objectContaining({
				count: 1,
				firstDefinitionId: value.definitionId,
				firstEcosystem: value.ecosystem,
				observedAtBlock: '10',
				presenceComplete: true,
			}),
		)
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('tracks a future lifecycle identity without blocking unrelated novelty before it is actionable', () => {
		const value = plan('10')
		const state = obligationState()

		synchronizeLifecycleObligations(state, [], presence(value, false), true, 10n)

		expect(state.lifecyclePresenceBlocker).toBeUndefined()
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('defers an existing obligation while its raw identity is temporarily nonactionable and promotes it when actionability returns', () => {
		const value = plan('10')
		const state = obligationState()

		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		expect(state.obligations[0]?.status).toBe('pending')

		synchronizeLifecycleObligations(state, [], presence(value, false), true, 11n)
		expect(state.obligations[0]?.status).toBe('deferred')
		expect(state.lifecyclePresenceBlocker).toBeUndefined()

		synchronizeLifecycleObligations(state, [evaluation(plan('12'))], presence(value), true, 12n)
		expect(state.obligations[0]?.status).toBe('pending')
		expect(state.obligations).toHaveLength(1)
		expect(state.workflows).toHaveLength(1)
	})

	test('retains an aggregate presence blocker through incomplete absence and clears it on complete absence', () => {
		const value = plan('10')
		const state = obligationState()

		synchronizeLifecycleObligations(state, [], presence(value), false, 10n, 0n)
		const blocker = state.lifecyclePresenceBlocker
		expect(blocker).toEqual(expect.objectContaining({ count: 1, presenceComplete: false }))

		synchronizeLifecycleObligations(state, [], [], false, 11n, 0n)
		expect(state.lifecyclePresenceBlocker).toEqual(blocker)

		synchronizeLifecycleObligations(state, [], [], true, 12n, 0n)
		expect(state.lifecyclePresenceBlocker).toBeUndefined()
	})

	test('replaces a raw presence blocker with one real obligation when the identity becomes actionable', () => {
		const value = plan('10')
		const state = obligationState()

		synchronizeLifecycleObligations(state, [], presence(value), true, 10n, 0n)
		expect(state.lifecyclePresenceBlocker).toBeDefined()

		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(value), true, 11n, 0n)

		expect(state.lifecyclePresenceBlocker).toBeUndefined()
		expect(state.obligations).toHaveLength(1)
		expect(state.workflows).toHaveLength(1)
	})

	test('creates actionable work before retaining the blocker for other raw identities', () => {
		const actionable = plan('10')
		const blocked = carryPlan('41')
		const state = obligationState()

		synchronizeLifecycleObligations(state, [evaluation(actionable)], [...presence(actionable), ...presence(blocked)], true, 10n, 0n)

		expect(obligationForPlan(state, actionable)).toBeDefined()
		expect(state.lifecyclePresenceBlocker).toEqual(expect.objectContaining({ count: 1, firstDefinitionId: blocked.definitionId }))
		expect(state.workflows).toHaveLength(1)
	})

	test('keeps later due batches blocked when the first batch has a terminal tombstone', () => {
		const first = plan('10')
		const later = { ...plan('10'), metadata: { reportId: '8' } }
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(first)], presence(first), true, 10n)
		const obligation = obligationForPlan(state, first)
		const workflow = state.workflows[0]
		if (obligation === undefined || workflow === undefined) throw new Error('Missing first lifecycle batch fixture')
		workflow.status = 'completed'
		workflow.completedAt = new Date().toISOString()
		expect(completeLifecycleObligation(state, obligation)).toBeTrue()
		state.obligations = []
		state.workflows = []

		synchronizeLifecycleObligations(state, [], [...presence(first), ...presence(later)], true, 11n)

		expect(state.lifecyclePresenceBlocker).toMatchObject({ count: 1, reason: 'unplanned-due-identity' })
		expect(state.obligationTombstones[0]?.lastSeenBlock).toBe('11')
	})

	test('bounds a maximum-size actionable backlog before durable state materialization', () => {
		const values = Array.from({ length: 10_000 }, (_, index) => ({
			...plan('10'),
			id: `settle:${index.toString()}`,
			metadata: { reportId: index.toString() },
		}))
		const state = obligationState()

		synchronizeLifecycleObligations(
			state,
			values.map(evaluation),
			values.flatMap(value => presence(value)),
			true,
			10n,
		)

		expect(state.obligations).toHaveLength(MAXIMUM_ACTIVE_LIFECYCLE_OBLIGATIONS)
		expect(state.workflows).toHaveLength(MAXIMUM_ACTIVE_LIFECYCLE_OBLIGATIONS)
		expect(state.lifecyclePresenceBlocker).toMatchObject({
			count: values.length - MAXIMUM_ACTIVE_LIFECYCLE_OBLIGATIONS,
			reason: 'unplanned-due-identity',
		})
	})

	test('reserves a durable tombstone slot before materializing lifecycle work', () => {
		const value = plan('10')
		const state = obligationState()
		state.obligationTombstones = Array.from({ length: MAXIMUM_OBLIGATION_TOMBSTONE_COUNT }, (_, index) => ({
			id: `historical:${index.toString()}`,
			resolution: 'abandoned',
			resolutionReason: 'Previously reconciled lifecycle identity',
			resolvedAt: '2026-08-30T00:00:00.000Z',
			resolvedAtBlock: '1',
		}))

		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
		expect(state.lifecyclePresenceBlocker).toMatchObject({ count: 1, reason: 'unplanned-due-identity' })

		state.obligationTombstones.pop()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 11n)
		const obligation = obligationForPlan(state, value)
		const workflow = state.workflows[0]
		if (obligation === undefined || workflow === undefined) throw new Error('Missing tombstone-capacity lifecycle fixture')
		workflow.status = 'completed'
		workflow.completedAt = new Date().toISOString()
		expect(completeLifecycleObligation(state, obligation)).toBeTrue()
		expect(state.obligationTombstones).toHaveLength(MAXIMUM_OBLIGATION_TOMBSTONE_COUNT)
		expect(() => compactDurableState({ ...state, activities: [] })).not.toThrow()
	})

	test('fails closed when an actionable identity is absent from canonical presence', () => {
		const value = plan('10')
		const state = obligationState()

		expect(() => synchronizeLifecycleObligations(state, [evaluation(value)], [], true, 10n, 0n)).toThrow('missing from canonical presence')
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('fails closed when an actionable plan is mislabeled as non-obstructing presence', () => {
		const value = plan('10')
		const state = obligationState()

		expect(() => synchronizeLifecycleObligations(state, [evaluation(value)], presence(value, false), true, 10n, 0n)).toThrow('missing from obstructing canonical presence')
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('refreshes an anchored plan without duplicating the protocol obligation', () => {
		const state = obligationState()
		const first = plan('10')
		synchronizeLifecycleObligations(state, [evaluation(first)], presence(first), true, 10n)
		const obligation = obligationForPlan(state, first)
		expect(obligation).toBeDefined()
		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(plan('11')), true, 11n)
		expect(state.obligations).toHaveLength(1)
		expect(state.workflows).toHaveLength(1)
		expect(state.workflows[0]?.planId).toBe('settle:11')
	})

	test('tracks attempts and completes only with the durable workflow', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		beginLifecycleObligation(obligation)
		expect(obligation.attemptCount).toBe(1)
		expect(obligation.automaticRetryCount).toBe(0)
		expect(completeLifecycleObligation(state, obligation)).toBeFalse()
		const workflow = state.workflows[0]
		if (workflow === undefined) throw new Error('Missing test workflow')
		workflow.status = 'completed'
		workflow.completedAt = new Date().toISOString()
		expect(completeLifecycleObligation(state, obligation)).toBeTrue()
		expect(obligation.status).toBe('completed')
	})

	test('keeps finalized canonical-confirmation work pending until complete presence removes the identity', () => {
		const value = { ...plan('10'), deadlineTimestamp: '1' }
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		const workflow = state.workflows[0]
		const step = workflow?.steps[0]
		if (workflow === undefined || step === undefined) throw new Error('Missing test workflow')
		step.evidence = [
			{
				abi: 'event CanonicalProgress(address indexed target, uint256 value)',
				canonicalLifecycleConfirmation: true,
				emitter: step.to,
				equals: '1',
				field: 'value',
				indexed: { target: step.to },
				kind: 'decoded-event-field',
				signature: 'CanonicalProgress(address,uint256)',
				topic0: `0x${'22'.repeat(32)}`,
			},
		]
		beginLifecycleObligation(obligation)
		markWorkflowStepWaitingCanonical(workflow, step.id, `0x${'11'.repeat(32)}`)
		waitForCanonicalLifecycleConfirmation(obligation)

		synchronizeLifecycleObligations(state, [], [], false, 11n, 2n)
		expect(workflow.status).toBe('waiting-obligation')
		expect(obligation.status).toBe('pending')
		expect(state.obligationTombstones).toHaveLength(0)

		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 12n, 2n)
		expect(workflow.status).toBe('waiting-obligation')
		expect(obligationForPlan(state, value)).toBeUndefined()

		synchronizeLifecycleObligations(state, [], [], true, 13n, 2n)
		expect(workflow.status).toBe('completed')
		expect(obligation.status).toBe('completed')
		expect(state.obligationTombstones).toContainEqual(expect.objectContaining({ id: obligation.id, resolution: 'completed', resolvedAtBlock: '13' }))
	})

	test('keeps off-page carry identities live while complete absence resolves them without wedging unrelated obligations', () => {
		const waitingCarry = carryPlan('40')
		const pendingCarry = carryPlan('41')
		const unrelated = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(waitingCarry), evaluation(pendingCarry), evaluation(unrelated)], [...presence(waitingCarry), ...presence(pendingCarry), ...presence(unrelated)], true, 10n)

		const waitingObligation = obligationForPlan(state, waitingCarry)
		const pendingObligation = obligationForPlan(state, pendingCarry)
		const unrelatedObligation = obligationForPlan(state, unrelated)
		const waitingWorkflow = state.workflows.find(workflow => workflow.id === waitingObligation?.workflowId)
		const waitingStep = waitingWorkflow?.steps[0]
		const waitingParentDepositIndex = waitingCarry.metadata['parentDepositIndex']
		if (waitingObligation === undefined || pendingObligation === undefined || unrelatedObligation === undefined || waitingWorkflow === undefined || waitingStep === undefined || waitingParentDepositIndex === undefined) {
			throw new Error('Missing paged carry lifecycle fixture')
		}
		waitingStep.evidence = [
			{
				abi: 'event CarryDepositConsumed(uint256 indexed parentDepositIndex)',
				canonicalLifecycleConfirmation: true,
				emitter: waitingStep.to,
				equals: waitingParentDepositIndex,
				field: 'parentDepositIndex',
				indexed: {},
				kind: 'decoded-event-field',
				signature: 'CarryDepositConsumed(uint256)',
				topic0: `0x${'44'.repeat(32)}`,
			},
		]
		beginLifecycleObligation(waitingObligation)
		markWorkflowStepWaitingCanonical(waitingWorkflow, waitingStep.id, `0x${'55'.repeat(32)}`)
		waitForCanonicalLifecycleConfirmation(waitingObligation)

		// The rotating proof/action page contains neither carry item, but the
		// complete lightweight presence set still proves that both identities exist.
		synchronizeLifecycleObligations(state, [], [...presence(waitingCarry), ...presence(pendingCarry)], true, 11n)

		expect(waitingWorkflow.status).toBe('waiting-obligation')
		expect(waitingObligation.status).toBe('pending')
		expect(pendingObligation).toMatchObject({ blockers: ['The lifecycle item is not currently eligible at the canonical snapshot'], status: 'pending' })
		expect(unrelatedObligation.status).toBe('abandoned')
		expect(state.obligationTombstones).toContainEqual(expect.objectContaining({ id: unrelatedObligation.id, resolution: 'abandoned', resolvedAtBlock: '11' }))

		// Once complete lightweight discovery removes the carry identities, a
		// submitted item completes and an unsubmitted item is terminally superseded.
		synchronizeLifecycleObligations(state, [], [], true, 12n)

		expect(waitingWorkflow.status).toBe('completed')
		expect(waitingObligation.status).toBe('completed')
		expect(pendingObligation.status).toBe('abandoned')
		expect(state.obligationTombstones).toContainEqual(expect.objectContaining({ id: waitingObligation.id, resolution: 'completed', resolvedAtBlock: '12' }))
		expect(state.obligationTombstones).toContainEqual(expect.objectContaining({ id: pendingObligation.id, resolution: 'abandoned', resolvedAtBlock: '12' }))
	})

	test('recovers a completed workflow with a fresh canonical tombstone after a crash', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		const workflow = state.workflows[0]
		if (workflow === undefined) throw new Error('Missing test workflow')
		workflow.status = 'completed'
		workflow.completedAt = new Date().toISOString()

		synchronizeLifecycleObligations(state, [], [], true, 100n)

		expect(obligation.status).toBe('completed')
		expect(state.obligationTombstones).toEqual([
			expect.objectContaining({
				id: obligation.id,
				resolution: 'completed',
				resolvedAtBlock: '100',
			}),
		])
		synchronizeLifecycleObligations(state, [], [], true, 164n)
		expect(state.obligationTombstones).toHaveLength(1)
		synchronizeLifecycleObligations(state, [], [], true, 165n)
		expect(state.obligationTombstones).toHaveLength(0)
	})

	test('keeps a failed lifecycle instance terminal until an operator reconciles it', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		const workflow = state.workflows[0]
		if (workflow === undefined) throw new Error('Missing test workflow')
		workflow.status = 'failed'
		failLifecycleObligation(obligation, new Error('confirmed transaction failed'), false)

		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(plan('11')), true, 11n)

		expect(state.obligations).toHaveLength(1)
		expect(state.workflows).toHaveLength(1)
		expect(state.obligations[0]?.status).toBe('failed')
		expect(obligationForPlan(state, plan('11'))).toBeUndefined()
	})

	test('retries only unsigned failures and preserves the prior attempt audit', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		const workflow = state.workflows[0]
		if (workflow === undefined) throw new Error('Missing test workflow')
		const step = workflow.steps[0]
		if (step === undefined) throw new Error('Missing test workflow step')
		workflow.status = 'failed'
		step.status = 'failed'
		failLifecycleObligation(obligation, 'unsigned failure', false)
		retryLifecycleObligation(state, obligation)
		expect(obligation.status).toBe('pending')
		expect(obligation.lastError).toBe('unsigned failure')

		workflow.status = 'failed'
		step.status = 'failed'
		step.transactionHash = `0x${'11'.repeat(32)}`
		step.failureKind = 'semantic-failure'
		failLifecycleObligation(obligation, 'on-chain failure', false)
		expect(() => retryLifecycleObligation(state, obligation)).toThrow('unavailable after a semantically uncertain on-chain transaction')

		step.failureKind = 'receipt-reverted'
		retryLifecycleObligation(state, obligation)
		expect(obligation).toMatchObject({ lastError: 'on-chain failure', status: 'pending' })
		expect(workflow).toMatchObject({ status: 'blocked' })
		expect(step).toMatchObject({
			failure: 'Explicit operator retry requested after a finalized revert or verified nonce cancellation',
			status: 'blocked',
		})
		expect(step.failureKind).toBeUndefined()
		expect(step.transactionHash).toBeUndefined()
	})

	test('terminally supersedes a missing lifecycle item without claiming competitor success', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		const workflow = state.workflows[0]
		const step = workflow?.steps[0]
		if (obligation === undefined || workflow === undefined || step === undefined) throw new Error('Missing lifecycle fixture')
		obligation.status = 'failed'
		workflow.status = 'failed'
		step.status = 'failed'
		step.failureKind = 'receipt-reverted'
		step.transactionHash = `0x${'22'.repeat(32)}`

		synchronizeLifecycleObligations(state, [], [], true, 20n)

		expect(obligation).toMatchObject({ status: 'abandoned' })
		expect(obligation.resolutionReason).toContain('without claiming semantic success')
		expect(workflow).toMatchObject({ status: 'abandoned' })
		expect(state.obligationTombstones).toEqual([expect.objectContaining({ id: obligation.id, resolution: 'abandoned', resolvedAtBlock: '20' })])
	})

	test('keeps a present but temporarily ineligible lifecycle item pending', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)

		synchronizeLifecycleObligations(state, [], presence(value), true, 11n)

		expect(state.obligations[0]).toMatchObject({
			blockers: ['The lifecycle item is not currently eligible at the canonical snapshot'],
			status: 'pending',
		})
		expect(state.obligationTombstones).toHaveLength(0)
	})

	test('refreshes a rolling transaction horizon without superseding the obligation', () => {
		const first = { ...plan('10'), lastValidBlockNumber: '11' }
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(first)], presence(first), true, 10n)

		synchronizeLifecycleObligations(state, [], presence(first), true, 12n)

		expect(state.obligations[0]?.status).toBe('pending')
		expect(state.obligationTombstones).toHaveLength(0)

		const refreshed = { ...plan('13'), lastValidBlockNumber: '14' }
		synchronizeLifecycleObligations(state, [evaluation(refreshed)], presence(refreshed), true, 13n)

		expect(state.workflows).toHaveLength(1)
		expect(state.workflows[0]?.lastValidBlockNumber).toBe('14')
		expect(state.obligations[0]?.status).toBe('pending')
	})

	test('defers an expired execute identity while retaining its successor', () => {
		const execute = {
			...plan('10'),
			deadlineTimestamp: '1000',
			definitionId: 'statoblast.staged.execute',
			ecosystem: 'statoblast' as const,
			metadata: { coordinator: '0x0000000000000000000000000000000000000001', operationId: '7', operationType: 1 },
		}
		const expire: OperationPlan = {
			...execute,
			definitionId: 'statoblast.staged.expire',
			id: 'expire:11',
		}
		delete expire.deadlineTimestamp
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(execute)], presence(execute), true, 10n, 900n)

		synchronizeLifecycleObligations(state, [evaluation(expire)], [...presence(execute, false), ...presence(expire)], true, 11n, 1_001n)

		expect(state.obligations.find(candidate => candidate.operationId === execute.definitionId)).toMatchObject({ status: 'deferred' })
		expect(state.obligations.find(candidate => candidate.operationId === expire.definitionId)).toMatchObject({ status: 'pending' })
		expect(state.obligationTombstones).toHaveLength(0)
	})

	test('refreshes a deadline after the same raw identity becomes actionable again', () => {
		const first = { ...plan('10'), deadlineTimestamp: '1000' }
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(first)], presence(first), true, 10n, 900n)

		synchronizeLifecycleObligations(state, [], presence(first, false), true, 11n, 1_001n)
		expect(state.obligations[0]?.status).toBe('deferred')
		expect(state.obligationTombstones).toHaveLength(0)

		const refreshed = { ...plan('12'), deadlineTimestamp: '2000' }
		synchronizeLifecycleObligations(state, [evaluation(refreshed)], presence(refreshed), true, 12n, 1_100n)

		expect(state.obligations).toHaveLength(1)
		expect(state.workflows).toHaveLength(1)
		expect(state.workflows[0]?.deadlineTimestamp).toBe('2000')
		expect(state.obligations[0]?.status).toBe('pending')
	})

	test('does not automatically supersede semantically uncertain on-chain work', () => {
		const value = { ...plan('10'), deadlineTimestamp: '1000' }
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n, 900n)
		const obligation = state.obligations[0]
		const workflow = state.workflows[0]
		const step = workflow?.steps[0]
		if (obligation === undefined || workflow === undefined || step === undefined) throw new Error('Missing lifecycle fixture')
		obligation.status = 'failed'
		workflow.status = 'failed'
		step.status = 'failed'
		step.failureKind = 'semantic-failure'
		step.transactionHash = `0x${'33'.repeat(32)}`

		synchronizeLifecycleObligations(state, [], [], true, 20n, 1_001n)

		expect(obligation.status).toBe('failed')
		expect(workflow.status).toBe('failed')
		expect(state.obligationTombstones).toHaveLength(0)
	})

	test('backs off then automatically rediscovers a canonically present finalized lifecycle revert', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n, 900n)
		const obligation = obligationForPlan(state, value)
		const workflow = state.workflows[0]
		const step = workflow?.steps[0]
		if (obligation === undefined || workflow === undefined || step === undefined) throw new Error('Missing lifecycle fixture')
		obligation.status = 'failed'
		workflow.status = 'failed'
		step.status = 'failed'
		step.failureKind = 'receipt-reverted'
		step.transactionHash = `0x${'22'.repeat(32)}`
		obligation.attemptCount = 1
		obligation.automaticRetryCount = 0

		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(value), true, 11n, 1_000n)

		expect(state.obligations[0]?.status).toBe('deferred')
		expect(obligation.automaticRetryCount).toBe(1)
		expect(obligation.notBefore).toBe(new Date(1_060_000).toISOString())
		expect(obligation.blockers[0]).toContain('automatic retry')
		expect(state.workflows[0]?.status).toBe('failed')

		synchronizeLifecycleObligations(state, [evaluation(plan('12'))], presence(value), true, 12n, 1_059n)
		expect(state.obligations[0]?.status).toBe('deferred')
		expect(obligation.automaticRetryCount).toBe(1)

		synchronizeLifecycleObligations(state, [evaluation(plan('13'))], presence(value), true, 13n, 1_060n)
		expect(state.obligations[0]?.status).toBe('pending')
		expect(obligation.notBefore).toBeUndefined()
		expect(state.workflows[0]?.status).toBe('planned')
		expect(workflow.steps[0]).toMatchObject({ status: 'planned' })
		expect(workflow.steps[0]?.failureKind).toBeUndefined()
		expect(workflow.steps[0]?.transactionHash).toBeUndefined()
		expect(state.obligationTombstones).toHaveLength(0)
	})

	test('counts only the terminal finalized failure after successful prerequisite execution entries', () => {
		const base = plan('10')
		const terminalStep = base.steps[0]
		if (terminalStep === undefined) throw new Error('Missing lifecycle terminal step fixture')
		const value: OperationPlan = {
			...base,
			steps: [{ ...terminalStep, id: 'prepare-one', label: 'Prepare one' }, { ...terminalStep, id: 'prepare-two', label: 'Prepare two' }, terminalStep],
		}
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n, 900n)
		const obligation = obligationForPlan(state, value)
		const workflow = state.workflows[0]
		const firstStep = workflow?.steps[0]
		const secondStep = workflow?.steps[1]
		const failedStep = workflow?.steps[2]
		if (obligation === undefined || workflow === undefined || firstStep === undefined || secondStep === undefined || failedStep === undefined) {
			throw new Error('Missing multi-step lifecycle fixture')
		}

		beginLifecycleObligation(obligation)
		firstStep.status = 'confirmed'
		firstStep.confirmedAt = new Date(910_000).toISOString()
		beginLifecycleObligation(obligation)
		secondStep.status = 'confirmed'
		secondStep.confirmedAt = new Date(920_000).toISOString()
		beginLifecycleObligation(obligation)
		failedStep.status = 'failed'
		failedStep.failureKind = 'receipt-reverted'
		failedStep.transactionHash = `0x${'33'.repeat(32)}`
		workflow.status = 'failed'
		workflow.completedAt = new Date(930_000).toISOString()
		failLifecycleObligation(obligation, 'terminal transaction reverted', false)

		expect(obligation).toMatchObject({ attemptCount: 3, automaticRetryCount: 0, status: 'failed' })
		synchronizeLifecycleObligations(state, [evaluation({ ...value, createdAtBlock: '11', id: 'settle:11' })], presence(value), true, 11n, 1_000n)

		expect(obligation).toMatchObject({ attemptCount: 3, automaticRetryCount: 1, status: 'deferred' })
		expect(obligation.notBefore).toBe(new Date(1_060_000).toISOString())
		expect(obligation.blockers[0]).toContain('automatic retry')

		synchronizeLifecycleObligations(state, [evaluation({ ...value, createdAtBlock: '12', id: 'settle:12' })], presence(value), true, 12n, 1_001n)
		expect(obligation.automaticRetryCount).toBe(1)
	})

	test('requires operator reconciliation after bounded finalized lifecycle retry attempts are exhausted', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n, 900n)
		const obligation = obligationForPlan(state, value)
		const workflow = state.workflows[0]
		const step = workflow?.steps[0]
		if (obligation === undefined || workflow === undefined || step === undefined) throw new Error('Missing lifecycle fixture')
		obligation.status = 'failed'
		obligation.attemptCount = 30
		obligation.automaticRetryCount = 2
		workflow.status = 'failed'
		step.status = 'failed'
		step.failureKind = 'receipt-reverted'
		step.transactionHash = `0x${'22'.repeat(32)}`

		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(value), true, 11n, 1_000n)

		expect(obligation.status).toBe('failed')
		expect(obligation.automaticRetryCount).toBe(3)
		expect(obligation.notBefore).toBeUndefined()
		expect(obligation.blockers[0]).toContain('automatic retry limit')
		expect(workflow.status).toBe('failed')
	})

	test('records an abandonment tombstone that prevents rediscovery from recreating work', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		failLifecycleObligation(obligation, 'operator review required', false)
		abandonLifecycleObligation(state, obligation, 'Manually completed outside this bot')
		expect(obligation.status).toBe('abandoned')
		expect(state.obligationTombstones).toEqual([expect.objectContaining({ id: obligation.id, resolution: 'abandoned' })])
		state.obligations = []
		state.workflows = []
		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(plan('11')), true, 11n)
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('allows a later deferred-refund episode after the prior generation is tombstoned', () => {
		const first = refundPlan(`0x${'11'.repeat(32)}`)
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(first)], presence(first), true, 10n)
		const firstObligation = obligationForPlan(state, first)
		const firstWorkflow = state.workflows[0]
		if (firstObligation === undefined || firstWorkflow === undefined) throw new Error('Missing first refund episode fixture')
		firstWorkflow.status = 'completed'
		firstWorkflow.completedAt = new Date().toISOString()
		expect(completeLifecycleObligation(state, firstObligation)).toBeTrue()

		const later = refundPlan(`0x${'22'.repeat(32)}`, '12')
		synchronizeLifecycleObligations(state, [evaluation(later)], presence(later), true, 12n)

		expect(state.obligationTombstones).toContainEqual(expect.objectContaining({ id: firstObligation.id, resolution: 'completed' }))
		expect(state.obligations).toHaveLength(2)
		expect(obligationForPlan(state, later)).toMatchObject({ metadata: later.metadata, status: 'pending' })
	})

	test('starts terminal tombstone retention at the first complete canonical absence', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		abandonLifecycleObligation(state, obligation, 'Protocol item was reconciled manually')
		synchronizeLifecycleObligations(state, [evaluation(plan('20'))], presence(plan('20')), true, 20n)
		expect(state.obligationTombstones[0]?.lastSeenBlock).toBe('20')
		synchronizeLifecycleObligations(state, [], [], true, 84n)
		expect(state.obligationTombstones[0]?.observedAbsentAtBlock).toBe('84')
		expect(state.obligationTombstones).toHaveLength(1)
		synchronizeLifecycleObligations(state, [], [], true, 148n)
		expect(state.obligationTombstones).toHaveLength(1)
		synchronizeLifecycleObligations(state, [], [], true, 149n)
		expect(state.obligationTombstones).toHaveLength(0)
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('retains a long-lived completed tombstone through first absence and restarts retention after a return', () => {
		const value = plan('2')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 2n)
		const workflow = state.workflows[0]
		if (workflow === undefined) throw new Error('Missing completed lifecycle fixture')
		workflow.status = 'completed'
		workflow.completedAt = new Date().toISOString()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 2n)

		synchronizeLifecycleObligations(state, [], [], true, 100n)
		expect(state.obligationTombstones[0]).toMatchObject({ observedAbsentAtBlock: '100', resolution: 'completed' })
		expect(state.obligationTombstones).toHaveLength(1)

		synchronizeLifecycleObligations(state, [evaluation(plan('101'))], presence(value), true, 101n)
		expect(state.lifecyclePresenceBlocker).toMatchObject({ count: 1, reason: 'completed-identity-returned' })
		expect(state.obligationTombstones[0]?.lastSeenBlock).toBe('101')

		synchronizeLifecycleObligations(state, [], [], true, 200n)
		expect(state.lifecyclePresenceBlocker).toBeUndefined()
		expect(state.obligationTombstones[0]?.observedAbsentAtBlock).toBe('200')
		synchronizeLifecycleObligations(state, [], [], true, 264n)
		expect(state.obligationTombstones).toHaveLength(1)
		synchronizeLifecycleObligations(state, [], [], true, 265n)
		expect(state.obligationTombstones).toHaveLength(0)
	})

	test('blocks novelty when a completed identity returns after confirmed canonical absence', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		const workflow = state.workflows[0]
		if (obligation === undefined || workflow === undefined) throw new Error('Missing completed lifecycle fixture')
		workflow.status = 'completed'
		workflow.completedAt = new Date().toISOString()

		synchronizeLifecycleObligations(state, [], [], true, 11n)
		expect(state.obligationTombstones[0]).toMatchObject({ observedAbsentAtBlock: '11', resolution: 'completed' })

		synchronizeLifecycleObligations(state, [evaluation(plan('12'))], presence(value), true, 12n)

		expect(state.obligations).toHaveLength(1)
		expect(state.workflows).toHaveLength(1)
		const blocker = state.lifecyclePresenceBlocker
		if (blocker === undefined) throw new Error('Missing completed-identity reorganization blocker')
		expect(blocker).toMatchObject({ count: 1, reason: 'completed-identity-returned' })
		expect(lifecyclePresenceBlockerMessage(blocker)).toContain('canonical reorganization is reconciled manually')
		expect(state.obligationTombstones[0]?.lastSeenBlock).toBe('12')
	})

	test('retains an active tombstone while execution policy makes its plan unavailable', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		abandonLifecycleObligation(state, obligation, 'Operator deliberately resolved this protocol item elsewhere')

		synchronizeLifecycleObligations(state, [], presence(value, false), true, 100n)
		synchronizeLifecycleObligations(state, [], presence(value, false), true, 200n)
		synchronizeLifecycleObligations(state, [evaluation(plan('200'))], presence(plan('200')), true, 200n)

		expect(state.obligationTombstones).toHaveLength(1)
		expect(state.obligationTombstones[0]?.lastSeenBlock).toBe('200')
		expect(state.lifecyclePresenceBlocker).toBeUndefined()
		expect(state.obligations).toHaveLength(1)
		expect(state.obligations[0]?.status).toBe('abandoned')
	})

	test('does not age tombstones while canonical presence discovery is incomplete', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		abandonLifecycleObligation(state, obligation, 'Operator deliberately resolved this protocol item elsewhere')

		synchronizeLifecycleObligations(state, [], [], false, 1_000n)

		expect(state.obligationTombstones).toHaveLength(1)
		expect(state.obligations).toHaveLength(1)
	})
})
