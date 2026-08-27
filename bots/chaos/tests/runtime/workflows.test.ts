import { describe, expect, test } from 'bun:test'
import type { OperationPlan } from '../../src/operations/types.ts'
import {
	blockInterruptedWorkflows,
	captureWorkflowIntentSubmissionJournal,
	createDurableWorkflow,
	completeWorkflowFromCanonicalConfirmation,
	durableWorkflowPlan,
	markWorkflowForRediscovery,
	markWorkflowIntentBroadcastAttempt,
	markWorkflowStepConfirmed,
	markWorkflowStepSigned,
	markWorkflowStepWaitingCanonical,
	refreshWorkflowContinuation,
	retainWorkflow,
	restoreWorkflowIntentSubmissionJournal,
	workflowFailureHasTransaction,
	workflowNeedsContinuation,
} from '../../src/runtime/workflows.ts'
import type { DurableWorkflow, PendingTransactionIntent } from '../../src/state/operator-state.ts'

function plan(): OperationPlan {
	return {
		classification: 'selectable',
		createdAtBlock: '1',
		definitionId: 'open-oracle.dust',
		ecosystem: 'open-oracle',
		id: 'plan:1',
		label: 'Dust supported tokens',
		metadata: {},
		obligation: false,
		planningSeed: 1,
		postconditions: ['Dust sentinels are initialized'],
		priority: 'random',
		risk: 'low',
		steps: [
			{
				data: '0x1234',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '100000',
				id: 'dust',
				label: 'Dust tokens',
				preflightCalls: [
					{
						caller: '0x0000000000000000000000000000000000000002',
						data: '0xabcd',
						expectedResult: '0x1234',
						label: 'Downstream mutation',
						to: '0x0000000000000000000000000000000000000003',
					},
				],
				to: '0x0000000000000000000000000000000000000001',
				walletAssetDebits: [],
			},
		],
	}
}

function workflowStatus(workflow: DurableWorkflow): DurableWorkflow['status'] {
	return workflow.status
}

function twoStepPlan(): OperationPlan {
	const value = plan()
	return {
		...value,
		steps: [
			{
				data: '0x1111',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '100000',
				id: 'approve',
				label: 'Approve',
				preflightCalls: [],
				to: '0x0000000000000000000000000000000000000001',
				walletAssetDebits: [],
			},
			{
				data: '0x2222',
				evidence: [{ kind: 'receipt-success' }],
				gasLimit: '200000',
				id: 'act',
				label: 'Act',
				preflightCalls: [],
				to: '0x0000000000000000000000000000000000000002',
				walletAssetDebits: [],
			},
		],
	}
}

function canonicalConfirmationPlan(position: 'prerequisite' | 'terminal' = 'terminal'): OperationPlan {
	const value = twoStepPlan()
	const confirmationIndex = position === 'prerequisite' ? 0 : 1
	return {
		...value,
		classification: 'lifecycle-obligation',
		obligation: true,
		priority: 'urgent',
		steps: value.steps.map((step, index) =>
			index === confirmationIndex
				? {
						...step,
						evidence: [
							{
								abi: 'event ChildRepSplit(address indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep)',
								canonicalLifecycleConfirmation: true,
								emitter: '0x0000000000000000000000000000000000000001',
								equals: '100',
								field: 'childPoolRepSplitAttoRep',
								indexed: { outcomeIndex: '0', parent: '0x0000000000000000000000000000000000000002' },
								kind: 'decoded-event-field',
								signature: 'ChildRepSplit(address,uint256,uint256,uint256)',
								topic0: '0x1111111111111111111111111111111111111111111111111111111111111111',
							},
						],
					}
				: step,
		),
	}
}

describe('durable chaos workflows', () => {
	test('reuses a retained plan only for the same canonical workflow identity', () => {
		const original: OperationPlan = { ...plan(), metadata: { reportId: '1', selfDispute: false } }
		const state = { workflows: [] as DurableWorkflow[] }
		const retained = retainWorkflow(state, original)
		expect(retainWorkflow(state, { ...original, metadata: { selfDispute: false, reportId: '1' } })).toBe(retained)
		expect(state.workflows).toHaveLength(1)
		expect(() => retainWorkflow(state, { ...original, definitionId: 'open-oracle.settle' })).toThrow(/plan id .* collides with a different operation identity/i)
		expect(() => retainWorkflow(state, { ...original, ecosystem: 'trading' })).toThrow(/plan id .* collides with a different operation identity/i)
		expect(() => retainWorkflow(state, { ...original, metadata: { reportId: '2', selfDispute: false } })).toThrow(/plan id .* collides with a different operation identity/i)
		expect(state.workflows).toHaveLength(1)
	})

	test('tracks a signed step through workflow completion', () => {
		const workflow = createDurableWorkflow(plan())
		expect(durableWorkflowPlan(workflow).steps[0]?.preflightCalls).toEqual([
			{
				caller: '0x0000000000000000000000000000000000000002',
				data: '0xabcd',
				expectedResult: '0x1234',
				label: 'Downstream mutation',
				to: '0x0000000000000000000000000000000000000003',
			},
		])
		const hash = `0x${'11'.repeat(32)}` as const
		markWorkflowStepSigned(workflow, 'dust', 'intent:1', hash)
		expect(workflow.status).toBe('waiting-transaction')
		markWorkflowStepConfirmed(workflow, 'dust', hash)
		expect(workflow.status).toBe('completed')
		expect(workflow.steps[0]?.status).toBe('confirmed')
	})

	test('reserves canonical confirmation for a lifecycle obligation terminal step', () => {
		const terminalPlan = canonicalConfirmationPlan()
		expect(() => createDurableWorkflow({ ...terminalPlan, classification: 'selectable', obligation: false })).toThrow('outside a lifecycle obligation')
		expect(() => createDurableWorkflow(canonicalConfirmationPlan('prerequisite'))).toThrow('terminal step')

		const workflow = createDurableWorkflow(terminalPlan)
		expect(() => markWorkflowStepWaitingCanonical(workflow, 'act', `0x${'11'.repeat(32)}`)).toThrow('before every prerequisite is confirmed')
		markWorkflowStepConfirmed(workflow, 'approve', `0x${'22'.repeat(32)}`)
		markWorkflowStepWaitingCanonical(workflow, 'act', `0x${'33'.repeat(32)}`)
		expect(workflow.status).toBe('waiting-obligation')
		completeWorkflowFromCanonicalConfirmation(workflow)
		expect(workflow.status).toBe('completed')
	})

	test('journals an uncertain broadcast consistently before network submission', () => {
		const workflow = createDurableWorkflow(plan())
		const hash = `0x${'11'.repeat(32)}` as const
		markWorkflowStepSigned(workflow, 'dust', 'intent:1', hash)
		const intent: Pick<PendingTransactionIntent, 'status' | 'stepId' | 'submissionBlock' | 'submittedAt'> = {
			status: 'signed',
			stepId: 'dust',
			submissionBlock: undefined,
			submittedAt: undefined,
		}
		markWorkflowIntentBroadcastAttempt(workflow, intent, 12n)
		expect(intent.status).toBe('confirmation-unknown')
		expect(intent.submissionBlock).toBe(12n)
		expect(intent.submittedAt).toBeDefined()
		expect(workflow.steps[0]?.status).toBe('submitted')
	})

	test('restores a signed write-ahead intent only when submission is deferred before the network call', () => {
		const workflow = createDurableWorkflow(plan())
		const hash = `0x${'11'.repeat(32)}` as const
		markWorkflowStepSigned(workflow, 'dust', 'intent:1', hash)
		const intent: Pick<PendingTransactionIntent, 'status' | 'stepId' | 'submissionBlock' | 'submittedAt'> = {
			status: 'signed',
			stepId: 'dust',
			submissionBlock: undefined,
			submittedAt: undefined,
		}
		const journal = captureWorkflowIntentSubmissionJournal(workflow, intent)
		markWorkflowIntentBroadcastAttempt(workflow, intent, 12n)

		restoreWorkflowIntentSubmissionJournal(workflow, intent, journal)

		expect(intent).toEqual({ status: 'signed', stepId: 'dust' })
		expect(workflow.status).toBe('waiting-transaction')
		expect(workflow.steps[0]?.status).toBe('signed')
	})

	test('closes interrupted unsigned random work while retaining pending intents', () => {
		const interrupted: DurableWorkflow = createDurableWorkflow(plan())
		interrupted.status = 'running'
		const recoverable = createDurableWorkflow(plan())
		recoverable.status = 'waiting-transaction'
		const state = {
			pendingTransactions: [{ workflowId: recoverable.id }],
			workflows: [interrupted, recoverable],
		}
		blockInterruptedWorkflows(state)
		expect(state.workflows[0]?.status).toBe('abandoned')
		expect(state.workflows[1]?.status).toBe('waiting-transaction')
	})

	test('allows unsigned preflight failures to be rediscovered but latches on-chain failures', () => {
		const unsigned = createDurableWorkflow(plan())
		unsigned.status = 'failed'
		const unsignedStep = unsigned.steps[0]
		if (unsignedStep === undefined) throw new Error('Missing unsigned test step')
		unsignedStep.status = 'failed'
		markWorkflowForRediscovery(unsigned, 'anchored simulation changed')
		expect(workflowStatus(unsigned)).toBe('abandoned')

		const onChain = createDurableWorkflow(plan())
		onChain.status = 'failed'
		const onChainStep = onChain.steps[0]
		if (onChainStep === undefined) throw new Error('Missing on-chain test step')
		onChainStep.status = 'failed'
		onChainStep.transactionHash = `0x${'22'.repeat(32)}`
		expect(workflowFailureHasTransaction(onChain)).toBeTrue()
		expect(() => markWorkflowForRediscovery(onChain, 'semantic mismatch')).toThrow('cannot be reset')
	})

	test('preserves a confirmed prefix and resumes only an exact canonical continuation', () => {
		const original = twoStepPlan()
		const workflow = createDurableWorkflow(original)
		const confirmedHash = `0x${'33'.repeat(32)}` as const
		markWorkflowStepConfirmed(workflow, 'approve', confirmedHash)
		workflow.status = 'running'
		blockInterruptedWorkflows({ pendingTransactions: [], workflows: [workflow] })
		expect(workflowStatus(workflow)).toBe('waiting-continuation')
		expect(workflowNeedsContinuation(workflow)).toBeTrue()

		const action = original.steps[1]
		if (action === undefined) throw new Error('Missing action step')
		const refreshed: OperationPlan = {
			...original,
			createdAtBlock: '2',
			id: 'plan:2',
			steps: [action],
		}
		refreshWorkflowContinuation(workflow, refreshed)
		expect(workflow.steps.map(step => [step.id, step.status])).toEqual([
			['approve', 'confirmed'],
			['act', 'planned'],
		])
		const restored = durableWorkflowPlan(workflow)
		expect(restored.createdAtBlock).toBe('2')
		expect(restored.steps.map(step => step.id)).toEqual(['approve', 'act'])
	})

	test('fails closed when canonical rediscovery changes a confirmed step', () => {
		const original = twoStepPlan()
		const workflow = createDurableWorkflow(original)
		markWorkflowStepConfirmed(workflow, 'approve', `0x${'44'.repeat(32)}`)
		workflow.status = 'waiting-continuation'
		const changedApproval = original.steps[0]
		if (changedApproval === undefined) throw new Error('Missing approval step')
		expect(() =>
			refreshWorkflowContinuation(workflow, {
				...original,
				createdAtBlock: '2',
				id: 'plan:2',
				steps: [{ ...changedApproval, data: '0x9999' }],
			}),
		).toThrow('changed destination, calldata, or value')
	})
})
