import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '../support/bot-shared.ts'
import { securityPoolForkerAbi, zoltarAbi } from '../../src/contracts/abi.ts'
import { canonicalLifecyclePresence, eligibleOperationPlans, evaluateOperationCatalog, reevaluateOperationContinuation, urgentOperationPlans } from '../../src/operations/catalog.ts'
import { deriveChildUniverseId } from '../../src/monitoring/protocol-index.ts'
import { eventTopic } from '../../src/operations/planning.ts'
import { snapshotFixture } from './fixture.ts'

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
			{
				abi: 'event ChildRepSplit(address indexed parent, uint256 indexed outcomeIndex, uint256 childPoolRepSplitAttoRep, uint256 pendingChildAttoRep)',
				emitter: snapshot.deployments.securityPoolForker,
				equals: '100',
				field: 'childPoolRepSplitAttoRep',
				indexed: { outcomeIndex: '0', parent: pool.address },
				kind: 'decoded-event-field',
				signature: 'ChildRepSplit(address,uint256,uint256,uint256)',
				topic0: eventTopic('ChildRepSplit(address,uint256,uint256,uint256)'),
			},
		])

		const policyDisabled = { ...options, allowIrreversibleOperations: false }
		expect(urgentOperationPlans(snapshot, policyDisabled).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, policyDisabled)).toContainEqual({ definitionId: 'statoblast.fork.migrate-rep', ecosystem: 'statoblast', metadata: plan.metadata })

		pool.forkRepMigrationProgressByOutcome['0'] = '100'
		expect(canonicalLifecyclePresence(snapshot, policyDisabled).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
	})

	test('retains raw pool migration presence when the private inclusion margin has closed', () => {
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
		pool.forkRepMigrationProgressByOutcome['0'] = '101'
		expect(() => canonicalLifecyclePresence(snapshot, options)).toThrow('REP migration progress exceeds its fork target')
	})
})
