import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { zoltarAbi } from '@zoltar/bot-shared/contracts/abi'
import { evaluateOperationCatalog, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { deriveChildUniverseId } from '../support/universe.ts'
import { snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	immutableTopologyCapacity: {
		maxPools: 100,
		maxQuestions: 100,
		maxStagedOperationsPerPool: 100,
		maxUniverses: 100,
		maxVaultsPerPool: 100,
		maximumAggregateItems: 10_000,
	},
	maximumBlockIntervalSeconds: 15,
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
})
