import { describe, expect, test } from 'bun:test'
import { validateStepReceiptEvidence } from '../../src/execution/receipt-validation.ts'
import { STATOBLAST_OPERATIONS } from '../../src/operations/statoblast.ts'
import type { EcosystemSnapshot, OperationEvidence, OperationPlanDraft, OperationStep, PlanningOptions } from '../../src/operations/types.ts'
import { hash, snapshotFixture } from './fixture.ts'

const options: PlanningOptions = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 1,
}

const receipt = {
	blockHash: hash(101),
	blockNumber: 101n,
	logs: [],
	status: 'success' as const,
	transactionHash: hash(102),
}

function dueFeeSnapshot() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const question = snapshot.questions[0]
	const vault = pool?.vaults[0]
	if (pool === undefined || question === undefined || vault === undefined) throw new Error('Statoblast fixture is incomplete')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 100n).toString()
	pool.lastUpdatedFeeAccumulator = (BigInt(snapshot.anchor.timestamp) - 10n).toString()
	pool.feeIndex = '42'
	vault.feeIndex = '41'
	return snapshot
}

function planFor(snapshot: EcosystemSnapshot, definitionId: string) {
	const definition = STATOBLAST_OPERATIONS.find(candidate => candidate.id === definitionId)
	if (definition === undefined) throw new Error(`Missing operation definition ${definitionId}`)
	const plan = definition.buildPlan(snapshot, options)
	if (plan === undefined) throw new Error(`Operation ${definitionId} did not build a fixture plan`)
	return plan
}

function storageEvidence(step: OperationStep) {
	return step.evidence.filter((evidence): evidence is Extract<OperationEvidence, { kind: 'storage-postcondition' }> => evidence.kind === 'storage-postcondition')
}

function validateAlreadyAchieved(plan: OperationPlanDraft) {
	const step = plan.steps[0]
	if (step === undefined) throw new Error(`${plan.definitionId} is missing its keeper step`)
	const storage = storageEvidence(step).map(evidence => {
		if (evidence.expected === undefined) throw new Error(`${evidence.functionName} is missing its idempotent target`)
		return { after: evidence.expected, before: evidence.expected, evidence }
	})
	expect(storage).not.toHaveLength(0)
	expect(() => validateStepReceiptEvidence(step, receipt, { storage })).not.toThrow()
}

describe('idempotent Statoblast keeper evidence', () => {
	test('accepts an already-achieved pool checkpoint without requiring this receipt to emit', () => {
		const snapshot = dueFeeSnapshot()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Statoblast pool fixture is missing')
		for (const definitionId of ['statoblast.pool.checkpoint-collateral', 'statoblast.pool.checkpoint-retention']) {
			const plan = planFor(snapshot, definitionId)
			const step = plan.steps[0]
			if (step === undefined) throw new Error(`${definitionId} is missing its keeper step`)
			expect(step.evidence).toEqual([
				{
					abi: 'function lastUpdatedFeeAccumulator() view returns (uint256)',
					args: [],
					contract: pool.address,
					expected: snapshot.anchor.timestamp,
					functionName: 'lastUpdatedFeeAccumulator',
					kind: 'storage-postcondition',
					relation: 'at-least',
				},
			])
			validateAlreadyAchieved(plan)
		}
	})

	test('accepts keeper-raced vault fee updates and redemptions at the anchored targets', () => {
		const snapshot = dueFeeSnapshot()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Statoblast pool fixture is missing')
		for (const definitionId of ['statoblast.vault.update-fees', 'statoblast.vault.redeem-fees']) {
			const plan = planFor(snapshot, definitionId)
			const step = plan.steps[0]
			if (step === undefined) throw new Error(`${definitionId} is missing its keeper step`)
			expect(storageEvidence(step)).toEqual([
				{
					abi: 'function feeIndex() view returns (uint256)',
					args: [],
					contract: pool.address,
					expected: '42',
					functionName: 'feeIndex',
					kind: 'storage-postcondition',
					relation: 'at-least',
				},
				{
					abi: 'function lastUpdatedFeeAccumulator() view returns (uint256)',
					args: [],
					contract: pool.address,
					expected: snapshot.anchor.timestamp,
					functionName: 'lastUpdatedFeeAccumulator',
					kind: 'storage-postcondition',
					relation: 'at-least',
				},
			])
			validateAlreadyAchieved(plan)
		}
	})

	test('rejects stale pool accounting even when the transaction receipt succeeds', () => {
		const snapshot = dueFeeSnapshot()
		const plan = planFor(snapshot, 'statoblast.pool.checkpoint-collateral')
		const step = plan.steps[0]
		const evidence = step === undefined ? undefined : storageEvidence(step)[0]
		if (step === undefined || evidence === undefined) throw new Error('Checkpoint evidence is missing')
		expect(() =>
			validateStepReceiptEvidence(step, receipt, {
				storage: [
					{
						after: (BigInt(snapshot.anchor.timestamp) - 1n).toString(),
						before: (BigInt(snapshot.anchor.timestamp) - 10n).toString(),
						evidence,
					},
				],
			}),
		).toThrow('to be at least')
	})
})
