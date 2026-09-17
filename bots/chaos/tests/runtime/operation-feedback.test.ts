import { expect, test } from 'bun:test'
import { manualExecutionFeedback, type ManualExecution } from '../../src/runtime/operation-feedback.ts'
import { createDurableWorkflow } from '../../src/runtime/workflows.ts'
import { evaluateSelectableOperationDefinition } from '../../src/operations/catalog.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { manualOperationFixture } from './manual-operation-fixture.ts'

function fixture() {
	const { configuration, state, scan } = manualOperationFixture()
	const plan = evaluateSelectableOperationDefinition('open-oracle.weth.wrap', scan.snapshot, planningOptions(configuration.settings, 7)).plan
	if (plan === undefined) throw new Error('Expected plan')
	const workflow = createDurableWorkflow(plan)
	state.workflows.push(workflow)
	const execution: ManualExecution = { previewId: 'preview', definitionId: plan.definitionId, status: 'completed', message: '', live: true, explorerUrl: 'https://sepolia.etherscan.io', planId: plan.id, previousTerminalWorkflowIds: new Set() }
	const step = workflow.steps[0]
	if (step === undefined) throw new Error('Expected step')
	return { state, plan, workflow, execution, step }
}

test('failed, partially executed, and signed operations never claim confirmation or an unsigned skip', () => {
	const { state, workflow, execution, step } = fixture()
	step.transactionHash = `0x${'ab'.repeat(32)}`
	step.status = 'signed'
	workflow.status = 'waiting-transaction'
	expect(manualExecutionFeedback(execution, state).message).toContain('Submission is not yet confirmed')
	step.status = 'failed'
	step.failure = 'Receipt reverted'
	workflow.status = 'abandoned'
	expect(manualExecutionFeedback(execution, state)).toMatchObject({ outcome: 'failed', status: 'failed', reason: 'Receipt reverted' })
	step.status = 'confirmed'
	workflow.status = 'running'
	execution.status = 'pending'
	expect(manualExecutionFeedback(execution, state).outcome).toBe('executing')
	execution.status = 'completed'
	expect(manualExecutionFeedback(execution, state).outcome).toBe('recovery')
	workflow.status = 'waiting-continuation'
	expect(manualExecutionFeedback(execution, state).outcome).toBe('recovery')
	workflow.status = 'waiting-obligation'
	expect(manualExecutionFeedback(execution, state).outcome).toBe('confirming')
})

test('public execution data excludes private diagnostics and unsafe explorer URLs', () => {
	const { state, execution, step, workflow } = fixture()
	step.transactionHash = `0x${'ab'.repeat(32)}`
	step.failure = 'RPC https://secret.example/key failed'
	workflow.status = 'failed'
	for (const url of ['javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com?token=secret']) {
		execution.explorerUrl = url
		const result = manualExecutionFeedback(execution, state)
		expect(result.transactions[0]?.explorerUrl).toBeUndefined()
		expect(JSON.stringify(result)).not.toContain('secret')
		expect(JSON.stringify(result)).not.toContain('previousTerminalWorkflowIds')
	}
})

test('receipt rollback replaces cached workflow state and subsequent recovery remains visible', () => {
	const { state, workflow, execution, step } = fixture()
	workflow.status = 'waiting-transaction'
	step.status = 'submitted'
	step.transactionHash = `0x${'ab'.repeat(32)}`
	expect(manualExecutionFeedback(execution, state).outcome).toBe('submitted')
	const journal = structuredClone(state.workflows)
	workflow.status = 'completed'
	step.status = 'confirmed'
	// Failed persistence restores cloned journal objects, invalidating the original reference.
	state.workflows = journal
	const restored = manualExecutionFeedback(execution, state)
	expect(restored.outcome).toBe('submitted')
	expect(restored.transactions[0]?.status).toBe('submitted')
	const recovered = state.workflows[0]
	const recoveredStep = recovered?.steps[0]
	if (recovered === undefined || recoveredStep === undefined) throw new Error('Expected restored workflow')
	recovered.status = 'completed'
	recoveredStep.status = 'confirmed'
	expect(manualExecutionFeedback(execution, state).outcome).toBe('confirmed')
	state.workflows = []
	expect(manualExecutionFeedback(execution, state).transactions[0]?.hash).toBe(step.transactionHash)
})
