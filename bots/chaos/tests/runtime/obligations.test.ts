import { describe, expect, test } from 'bun:test'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'
import { abandonLifecycleObligation, beginLifecycleObligation, completeLifecycleObligation, failLifecycleObligation, obligationForPlan, retryLifecycleObligation, synchronizeLifecycleObligations as synchronizeLifecycleObligationsAtAnchor, waitForCanonicalLifecycleConfirmation } from '../../src/runtime/obligations.ts'
import { markWorkflowStepWaitingCanonical } from '../../src/runtime/workflows.ts'
import type { DurableObligation, DurableObligationTombstone, DurableWorkflow } from '../../src/state/operator-state.ts'

function obligationState() {
	return {
		lastScannedBlock: 10n,
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
			contract: 'OpenOracle',
			description: 'settles',
			discoveryInputs: [],
			ecosystem: 'open-oracle',
			id: value.definitionId,
			label: value.label,
			method: 'settle',
			risk: 'low',
		},
		eligibility: { blockers: [], eligible: true },
		plan: value,
	}
}

function presence(value: OperationPlan) {
	return [
		{
			definitionId: value.definitionId,
			ecosystem: value.ecosystem,
			metadata: value.metadata,
		},
	]
}

describe('durable lifecycle obligations', () => {
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
		expect(obligation).toMatchObject({ status: 'pending' })
		expect(workflow).toMatchObject({ status: 'blocked' })
		expect(step).toMatchObject({ status: 'blocked' })
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

	test('supersedes an expired execute identity while retaining its successor', () => {
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

		synchronizeLifecycleObligations(state, [evaluation(expire)], [...presence(execute), ...presence(expire)], true, 11n, 1_001n)

		expect(state.obligations.find(candidate => candidate.operationId === execute.definitionId)).toMatchObject({ status: 'abandoned' })
		expect(state.obligations.find(candidate => candidate.operationId === expire.definitionId)).toMatchObject({ status: 'pending' })
		expect(state.obligationTombstones).toEqual([expect.objectContaining({ resolution: 'abandoned', resolutionReason: expect.stringContaining('deadline passed') })])
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

	test('does not auto-reconcile a failed lifecycle item while canonical presence remains', () => {
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

		synchronizeLifecycleObligations(state, [evaluation(plan('11'))], presence(value), true, 11n)

		expect(obligation.status).toBe('failed')
		expect(state.obligationTombstones).toHaveLength(0)
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

	test('retires terminal tombstones only after canonical absence beyond reorg retention', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		abandonLifecycleObligation(state, obligation, 'Protocol item was reconciled manually')
		synchronizeLifecycleObligations(state, [evaluation(plan('20'))], presence(plan('20')), true, 20n)
		expect(state.obligationTombstones[0]?.lastSeenBlock).toBe('20')
		synchronizeLifecycleObligations(state, [], [], true, 84n)
		expect(state.obligationTombstones).toHaveLength(1)
		synchronizeLifecycleObligations(state, [], [], true, 85n)
		expect(state.obligationTombstones).toHaveLength(0)
		expect(state.obligations).toHaveLength(0)
		expect(state.workflows).toHaveLength(0)
	})

	test('retains an active tombstone while execution policy makes its plan unavailable', () => {
		const value = plan('10')
		const state = obligationState()
		synchronizeLifecycleObligations(state, [evaluation(value)], presence(value), true, 10n)
		const obligation = obligationForPlan(state, value)
		if (obligation === undefined) throw new Error('Missing test obligation')
		abandonLifecycleObligation(state, obligation, 'Operator deliberately resolved this protocol item elsewhere')

		synchronizeLifecycleObligations(state, [], presence(value), true, 100n)
		synchronizeLifecycleObligations(state, [], presence(value), true, 200n)
		synchronizeLifecycleObligations(state, [evaluation(plan('200'))], presence(plan('200')), true, 200n)

		expect(state.obligationTombstones).toHaveLength(1)
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
