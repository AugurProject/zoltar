import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeAbiParameters, toHex } from '../support/bot-shared.ts'
import { securityPoolForkerAbi, zoltarAbi } from '../../src/contracts/abi.ts'
import { stepReceiptEvidenceDisposition, validateStepReceiptEvidence } from '../../src/execution/receipt-validation.ts'
import { canonicalLifecyclePresence, eligibleOperationPlans, evaluateOperationCatalog, reevaluateOperationContinuation, urgentOperationPlans } from '../../src/operations/catalog.ts'
import type { OperationEvidence } from '../../src/operations/types.ts'
import { deriveChildUniverseId } from '../../src/monitoring/protocol-index.ts'
import { beginLifecycleObligation, completeLifecycleObligation, obligationForPlan, synchronizeLifecycleObligations, waitForCanonicalLifecycleConfirmation } from '../../src/runtime/obligations.ts'
import { createDurableWorkflow, markWorkflowStepConfirmed, markWorkflowStepWaitingCanonical } from '../../src/runtime/workflows.ts'
import type { DurableObligation, DurableObligationTombstone, DurableWorkflow } from '../../src/state/operator-state.ts'
import { hash, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: 1_000n.toString(),
	maxRepSpendAttoRep: 10n.toString(),
	minimumEthReserveAttoEth: 0n.toString(),
	minimumRepReserveAttoRep: 0n.toString(),
	seed: 0x1234_5678,
} as const

function forkedSnapshot() {
	const snapshot = snapshotFixture()
	const universe = snapshot.universes[0]
	const pool = snapshot.pools[0]
	const question = snapshot.questions[0]
	if (universe === undefined || pool === undefined || question === undefined) throw new Error('Fork migration fixture is incomplete')
	universe.forkTime = '1999999000'
	universe.forkQuestionId = question.id
	pool.systemState = 1
	pool.forkActivationTime = '1999999000'
	return { pool, snapshot, universe }
}

describe('indexed REP migration operations', () => {
	test('builds one bounded exact Zoltar split interval and advances its durable identity', () => {
		const { snapshot, universe } = forkedSnapshot()
		universe.migrationBalance = '100'
		universe.migrationRepSplitProgressByOutcome = { '0': '20', '1': '100', '2': '100' }
		const first = eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'zoltar.migration.split')
		if (first === undefined) throw new Error('Expected an indexed migration split plan')
		const amount = BigInt(String(first.metadata['amountAttoRep']))
		const resulting = BigInt(String(first.metadata['resultingCumulativeAttoRep']))
		expect(first.risk).toBe('irreversible')
		expect(first.metadata).toMatchObject({
			childUniverseId: deriveChildUniverseId(0n, 0n).toString(),
			outcomeIndex: '0',
			startingCumulativeAttoRep: 20n.toString(),
			universeId: '0',
		})
		expect(amount).toBeGreaterThan(0n)
		expect(amount).toBeLessThanOrEqual(10n)
		expect(resulting).toBe(20n + amount)
		expect(first.steps[0]?.walletAssetDebits).toEqual([])
		const step = first.steps[0]
		if (step === undefined) throw new Error('Expected a split step')
		expect(decodeFunctionData({ abi: zoltarAbi, data: step.data })).toEqual({ args: [0n, amount, [0n]], functionName: 'splitMigrationRep' })
		expect(step.evidence.filter(evidence => evidence.kind === 'decoded-event-field').map(evidence => [evidence.field, evidence.equals])).toEqual([
			['recipient', snapshot.wallet.address],
			['outcomeIndex', '0'],
			['amountAttoRep', amount.toString()],
			['childMigrationRepAmountAttoRep', resulting.toString()],
		])
		expect(reevaluateOperationContinuation(snapshot, first, options).plan?.metadata).toEqual(first.metadata)

		universe.migrationRepSplitProgressByOutcome['0'] = resulting.toString()
		const next = eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'zoltar.migration.split')
		expect(next?.metadata['startingCumulativeAttoRep']).toBe(resulting.toString())
		expect(next?.id).not.toBe(first.id)
		universe.migrationRepSplitProgressByOutcome['0'] = universe.migrationBalance
		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'zoltar.migration.split')).toBeUndefined()
	})

	test('requires irreversible policy and fails closed when indexed split progress exceeds credit', () => {
		const { snapshot, universe } = forkedSnapshot()
		universe.migrationBalance = '100'
		universe.migrationRepSplitProgressByOutcome = { '0': '0', '1': '100', '2': '100' }
		const blocked = evaluateOperationCatalog(snapshot, { ...options, allowIrreversibleOperations: false }).find(operation => operation.definition.id === 'zoltar.migration.split')
		expect(blocked?.eligibility.blockers).toContain('Irreversible operations are disabled')
		expect(blocked?.plan).toBeUndefined()
		universe.migrationRepSplitProgressByOutcome['0'] = '101'
		expect(() => eligibleOperationPlans(snapshot, options)).toThrow('migration progress exceeds wallet credit')
	})

	test('enumerates singleton pool-held REP obligations from cumulative progress with an exact private deadline', () => {
		const { pool, snapshot } = forkedSnapshot()
		pool.forkRepMigrationTargetAttoRep = '100'
		pool.forkRepMigrationProgressByOutcome = {}
		const allRoutes = urgentOperationPlans(snapshot, options).filter(plan => plan.definitionId === 'statoblast.fork.migrate-rep')
		expect(allRoutes.map(plan => plan.metadata['outcome']).sort()).toEqual(['0', '1', '2'])
		expect(new Set(allRoutes.map(plan => plan.id)).size).toBe(3)
		for (const route of allRoutes) {
			const routeStep = route.steps[0]
			if (routeStep === undefined) throw new Error('Expected a singleton pool migration step')
			const decoded = decodeFunctionData({ abi: securityPoolForkerAbi, data: routeStep.data })
			expect(decoded.args?.[1]).toHaveLength(1)
		}
		pool.forkRepMigrationProgressByOutcome = { '0': '25', '1': '100', '2': '100' }
		const plans = urgentOperationPlans(snapshot, options).filter(plan => plan.definitionId === 'statoblast.fork.migrate-rep')
		expect(plans).toHaveLength(1)
		const plan = plans[0]
		if (plan === undefined) throw new Error('Expected a pool-held REP migration plan')
		expect(plan.metadata).toEqual({ outcome: '0', pool: pool.address, targetAttoRep: 100n.toString() })
		expect(plan.deadlineTimestamp).toBe('2004837400')
		expect(plan.risk).toBe('irreversible')
		const step = plan.steps[0]
		if (step === undefined) throw new Error('Expected a migrateRepToZoltar step')
		expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: step.data })).toEqual({ args: [pool.address, [0n]], functionName: 'migrateRepToZoltar' })
		expect(step.evidence).toEqual([
			expect.objectContaining({
				canonicalLifecycleConfirmation: true,
				equals: 100n.toString(),
				field: 'childPoolRepSplitAttoRep',
				indexed: { outcomeIndex: '0', parent: pool.address },
				kind: 'decoded-event-field',
				signature: 'ChildRepSplit(address,uint256,uint256,uint256)',
			}),
		])
		expect(() =>
			validateStepReceiptEvidence(step, {
				blockHash: hash(101),
				blockNumber: 101n,
				logs: [],
				status: 'success',
				transactionHash: hash(102),
			}),
		).toThrow('requires canonical lifecycle confirmation')

		const receipt = {
			blockHash: hash(101),
			blockNumber: 101n,
			logs: [],
			status: 'success' as const,
			transactionHash: hash(102),
		}
		expect(stepReceiptEvidenceDisposition(step, receipt)).toBe('waiting-canonical')
		const evidence = step.evidence[0] as Extract<OperationEvidence, { kind: 'decoded-event-field' }> | undefined
		if (evidence === undefined) throw new Error('Expected decoded ChildRepSplit evidence')
		const matchingReceipt = {
			...receipt,
			logs: [
				{
					address: evidence.emitter,
					data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [100n, 0n]),
					topics: [evidence.topic0, toHex(BigInt(pool.address), { size: 32 }), toHex(0n, { size: 32 })],
				},
			],
		}
		expect(stepReceiptEvidenceDisposition(step, matchingReceipt)).toBe('confirmed')
		expect(
			stepReceiptEvidenceDisposition(step, {
				...matchingReceipt,
				logs: matchingReceipt.logs.map(log => ({ ...log, topics: [evidence.topic0, toHex(BigInt(pool.address), { size: 32 }), toHex(1n, { size: 32 })] })),
			}),
		).toBe('waiting-canonical')
		const eventWorkflow = createDurableWorkflow(plan)
		markWorkflowStepConfirmed(eventWorkflow, step.id, matchingReceipt.transactionHash)
		expect(eventWorkflow.status).toBe('completed')

		const state = {
			lastScannedBlock: 100n,
			obligationTombstones: [] as DurableObligationTombstone[],
			obligations: [] as DurableObligation[],
			pendingTransactions: [],
			workflows: [] as DurableWorkflow[],
		}
		const initialEvaluations = evaluateOperationCatalog(snapshot, options)
		synchronizeLifecycleObligations(state, initialEvaluations, canonicalLifecyclePresence(snapshot, options), true, 100n, BigInt(snapshot.anchor.timestamp))
		const obligation = obligationForPlan(state, plan)
		if (obligation === undefined) throw new Error('Expected a durable REP migration obligation')
		const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
		if (workflow === undefined) throw new Error('Expected a durable REP migration workflow')
		beginLifecycleObligation(obligation)
		markWorkflowStepWaitingCanonical(workflow, step.id, receipt.transactionHash)
		waitForCanonicalLifecycleConfirmation(obligation)
		expect(completeLifecycleObligation(state, obligation)).toBeFalse()

		synchronizeLifecycleObligations(state, initialEvaluations, canonicalLifecyclePresence(snapshot, options), true, 101n, BigInt(snapshot.anchor.timestamp))
		expect(workflow.status).toBe('waiting-obligation')
		expect(obligation.status).toBe('pending')
		expect(obligationForPlan(state, plan)).toBeUndefined()

		const policyDisabled = { ...options, allowIrreversibleOperations: false }
		expect(urgentOperationPlans(snapshot, policyDisabled).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, policyDisabled)).toContainEqual({ definitionId: 'statoblast.fork.migrate-rep', ecosystem: 'statoblast', metadata: plan.metadata })

		pool.forkRepMigrationProgressByOutcome['0'] = '100'
		expect(canonicalLifecyclePresence(snapshot, policyDisabled).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
		synchronizeLifecycleObligations(state, evaluateOperationCatalog(snapshot, options), canonicalLifecyclePresence(snapshot, options), true, 102n, BigInt(snapshot.anchor.timestamp))
		expect(workflow.status).toBe('completed')
		expect(obligation.status).toBe('completed')
		expect(state.obligationTombstones).toContainEqual(expect.objectContaining({ id: obligation.id, resolution: 'completed', resolvedAtBlock: '102' }))
	})

	test('retains raw pool migration presence past actionability until indexed progress reaches the target', () => {
		const { pool, snapshot } = forkedSnapshot()
		pool.forkRepMigrationTargetAttoRep = '100'
		pool.forkRepMigrationProgressByOutcome = { '0': '25', '1': '100', '2': '100' }
		const deadline = BigInt(pool.forkActivationTime) + 8n * 7n * 24n * 60n * 60n
		snapshot.anchor.timestamp = (deadline - 100n).toString()
		expect(urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({
			definitionId: 'statoblast.fork.migrate-rep',
			ecosystem: 'statoblast',
			metadata: { outcome: '0', pool: pool.address, targetAttoRep: 100n.toString() },
		})
		snapshot.anchor.timestamp = (deadline + 1n).toString()
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({
			definitionId: 'statoblast.fork.migrate-rep',
			ecosystem: 'statoblast',
			metadata: { outcome: '0', pool: pool.address, targetAttoRep: 100n.toString() },
		})
		pool.forkRepMigrationProgressByOutcome['0'] = '101'
		expect(canonicalLifecyclePresence(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
	})

	test('materializes unresolved escalation entitlements for categorical and scalar routes above outcome two', () => {
		const { pool, snapshot, universe } = forkedSnapshot()
		const question = snapshot.questions[0]
		if (question === undefined) throw new Error('Fork question fixture is missing')
		pool.forkUnresolvedEscalation = true
		question.kind = 'categorical'
		question.outcomeLabels = ['Alpha', 'Beta', 'Gamma']
		pool.unresolvedEscalationMigrationReadyOutcomes = ['3']

		let plan = urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault-unresolved')
		expect(plan?.metadata['childOutcomeIndex']).toBe('3')
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({
			definitionId: 'statoblast.fork.migrate-vault-unresolved',
			ecosystem: 'statoblast',
			metadata: { childOutcomeIndex: '3', pool: pool.address },
		})

		const scalarOutcome = ((1n << 255n) | (37n << 120n) | 63n).toString()
		question.kind = 'scalar'
		question.numTicks = '100'
		question.outcomeLabels = []
		universe.knownChildOutcomes = [scalarOutcome]
		pool.unresolvedEscalationMigrationReadyOutcomes = [scalarOutcome]
		plan = urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault-unresolved')
		expect(plan?.metadata['childOutcomeIndex']).toBe(scalarOutcome)
		expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: plan?.steps[0]?.data ?? '0x' })).toEqual({ args: [pool.address, snapshot.wallet.address, BigInt(scalarOutcome)], functionName: 'migrateVaultWithUnresolvedEscalation' })
	})
})
