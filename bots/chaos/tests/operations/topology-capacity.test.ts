import { describe, expect, test } from 'bun:test'
import { evaluateOperationCatalog } from '../../src/operations/catalog.ts'
import type { EcosystemSnapshot, PlanningOptions } from '../../src/operations/types.ts'
import { ZOLTAR_OPERATIONS } from '../../src/operations/zoltar.ts'
import { deriveChildUniverseId } from '../../src/monitoring/protocol-index.ts'
import { address, snapshotFixture } from './fixture.ts'

const QUESTION_DISCOVERY_RESIDENT_UTF8_BYTES = 32 * 1024 * 1024
const MAXIMUM_QUESTION_LABEL_UTF8_BYTES = 4 * 1024 * 1024
const MAXIMUM_UINT256_DECIMAL = ((1n << 256n) - 1n).toString()

const immutableTopologyCapacity = {
	maxPools: 2,
	maxQuestions: 3,
	maxStagedOperationsPerPool: 2,
	maxUniverses: 2,
	maxVaultsPerPool: 2,
	maximumAggregateItems: 4,
} as const

const capacityOptions: PlanningOptions = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	immutableTopologyCapacity,
	maximumBlockIntervalSeconds: 15,
	seed: 1,
}

function operation(snapshot: EcosystemSnapshot, definitionId: string, options: PlanningOptions = capacityOptions) {
	const evaluated = evaluateOperationCatalog(snapshot, options).find(candidate => candidate.definition.id === definitionId)
	if (evaluated === undefined) throw new Error(`Missing operation ${definitionId}`)
	return evaluated
}

function zoltarDefinition(definitionId: string) {
	const definition = ZOLTAR_OPERATIONS.find(candidate => candidate.id === definitionId)
	if (definition === undefined) throw new Error(`Missing Zoltar operation ${definitionId}`)
	return definition
}

describe('immutable topology planning capacity', () => {
	test('allows one question at resident limit minus one and blocks the repeated creation at the exact limit', () => {
		const snapshot = snapshotFixture()
		const options = { ...capacityOptions, immutableTopologyCapacity: { ...immutableTopologyCapacity, maxQuestions: 2, maximumAggregateItems: 10 } }
		expect(snapshot.questions).toHaveLength(1)
		expect(operation(snapshot, 'zoltar.question.create-binary', options).plan).toBeDefined()

		const question = snapshot.questions[0]
		if (question === undefined) throw new Error('Question fixture is missing')
		snapshot.questions.push({ ...question, id: '78' })
		const repeated = operation(snapshot, 'zoltar.question.create-binary', options)
		expect(repeated.plan).toBeUndefined()
		expect(repeated.eligibility.blockers.join(' ')).toContain('question discovery resident limit')
	})

	test('counts each question record and every outcome label at the aggregate item boundary', () => {
		for (const [definitionId, addedItems] of [
			['zoltar.question.create-binary', 3],
			['zoltar.question.create-categorical', 4],
			['zoltar.question.create-scalar', 1],
		] as const) {
			const snapshot = snapshotFixture()
			const maximumAggregateItems = 3 + addedItems
			const options: PlanningOptions = {
				...capacityOptions,
				immutableTopologyCapacity: {
					...immutableTopologyCapacity,
					maxQuestions: 4,
					maximumAggregateItems,
				},
			}
			expect(operation(snapshot, definitionId, options).plan, definitionId).toBeDefined()

			const existing = snapshot.questions[0]
			if (existing === undefined) throw new Error('Question fixture is missing')
			snapshot.questions.push({ ...existing, id: '78', kind: 'scalar', outcomeLabels: [] })
			const blocked = operation(snapshot, definitionId, options)
			expect(blocked.plan, definitionId).toBeUndefined()
			expect(blocked.eligibility.blockers.join(' '), definitionId).toContain(`${maximumAggregateItems.toString()}-item discovery aggregate limit`)
		}
	})

	test('allows the final question byte at the resident boundary and blocks one additional byte', () => {
		const options: PlanningOptions = {
			...capacityOptions,
			immutableTopologyCapacity: {
				maxPools: 1,
				maxQuestions: 20,
				maxStagedOperationsPerPool: 1,
				maxUniverses: 1,
				maxVaultsPerPool: 1,
				maximumAggregateItems: 100,
			},
		}
		const definition = zoltarDefinition('zoltar.question.create-binary')
		const baseline = snapshotFixture()
		const baselinePlan = definition.buildPlan(baseline, options)
		const questionId = baselinePlan?.metadata['questionId']
		if (typeof questionId !== 'string') throw new Error('Question plan did not expose its deterministic identifier')
		const plannedQuestion = {
			createdAt: MAXIMUM_UINT256_DECIMAL,
			endTime: (BigInt(baseline.anchor.timestamp) + 86_400n).toString(),
			id: questionId,
			kind: 'binary' as const,
			numTicks: '0',
			outcomeLabels: ['Yes', 'No'],
			startTime: baseline.anchor.timestamp,
		}
		const plannedBytes = Buffer.byteLength(JSON.stringify(plannedQuestion), 'utf8')
		const snapshot = snapshotFixture()
		snapshot.questions = Array.from({ length: 8 }, (_, index) => ({
			createdAt: '1',
			endTime: '2',
			id: (index + 1).toString(),
			kind: 'categorical' as const,
			numTicks: '0',
			outcomeLabels: ['x'],
			startTime: '1',
		}))
		const initialBytes = snapshot.questions.reduce((total, question) => total + Buffer.byteLength(JSON.stringify(question), 'utf8'), 0)
		let remaining = QUESTION_DISCOVERY_RESIDENT_UTF8_BYTES - plannedBytes - initialBytes
		if (remaining <= 0) throw new Error('Question byte-boundary fixture has no filler budget')
		for (const question of snapshot.questions) {
			const label = question.outcomeLabels[0]
			if (label === undefined) throw new Error('Question byte-boundary label is missing')
			const addedBytes = Math.min(remaining, MAXIMUM_QUESTION_LABEL_UTF8_BYTES - Buffer.byteLength(label, 'utf8'))
			question.outcomeLabels[0] = `${label}${'x'.repeat(addedBytes)}`
			remaining -= addedBytes
		}
		expect(remaining).toBe(0)
		expect(definition.buildPlan(snapshot, options)).toBeDefined()

		const expandable = snapshot.questions.find(question => Buffer.byteLength(question.outcomeLabels[0] ?? '', 'utf8') < MAXIMUM_QUESTION_LABEL_UTF8_BYTES)
		if (expandable?.outcomeLabels[0] === undefined) throw new Error('Question byte-boundary fixture has no expandable label')
		expandable.outcomeLabels[0] += 'x'
		expect(definition.buildPlan(snapshot, options)).toBeUndefined()
		expect(definition.evaluate(snapshot, options).blockers.join(' ')).toContain('question discovery resident limit')
	})

	test('allows one child at the universe resident limit minus one when the resulting aggregate reaches its exact limit', () => {
		const snapshot = snapshotFixture()
		const universe = snapshot.universes[0]
		if (universe === undefined) throw new Error('Universe fixture is missing')
		universe.forkTime = '1'
		universe.forkQuestionId = '77'
		expect(operation(snapshot, 'zoltar.child.deploy').plan).toBeDefined()

		snapshot.universes.push({ ...universe, forkQuestionId: '0', forkTime: '0', id: '88', knownChildOutcomes: [], migrationRepSplitProgressByOutcome: {} })
		const repeated = operation(snapshot, 'zoltar.child.deploy')
		expect(repeated.plan).toBeUndefined()
		expect(repeated.eligibility.blockers.join(' ')).toContain('universe discovery resident limit')
	})

	test('guards the child universe implicitly deployed by migration split while preserving an existing exact-limit route', () => {
		const snapshot = snapshotFixture()
		const universe = snapshot.universes[0]
		const question = snapshot.questions[0]
		if (universe === undefined || question === undefined) throw new Error('Migration split fixture is incomplete')
		universe.forkTime = '1'
		universe.forkQuestionId = question.id
		universe.migrationBalance = '100'
		universe.migrationRepSplitProgressByOutcome = { '0': '0', '1': '100', '2': '100' }
		const fullOptions: PlanningOptions = {
			...capacityOptions,
			maxRepSpendAttoRep: 10n.toString(),
			immutableTopologyCapacity: {
				maxPools: 1,
				maxQuestions: 4,
				maxStagedOperationsPerPool: 1,
				maxUniverses: 1,
				maxVaultsPerPool: 1,
				maximumAggregateItems: 4,
			},
		}
		const blocked = operation(snapshot, 'zoltar.migration.split', fullOptions)
		expect(blocked.plan).toBeUndefined()
		expect(blocked.eligibility.blockers.join(' ')).toContain('universe discovery resident limit')

		const childId = deriveChildUniverseId(BigInt(universe.id), 0n).toString()
		snapshot.universes.push({
			...universe,
			forkQuestionId: '0',
			forkTime: '0',
			forkingOutcomeIndex: '0',
			id: childId,
			knownChildOutcomes: [],
			migrationBalance: '0',
			migrationRepSplitProgressByOutcome: {},
			parentUniverseId: universe.id,
		})
		const exactOptions: PlanningOptions = {
			...fullOptions,
			immutableTopologyCapacity: {
				maxPools: 1,
				maxQuestions: 4,
				maxStagedOperationsPerPool: 1,
				maxUniverses: 2,
				maxVaultsPerPool: 1,
				maximumAggregateItems: 4,
			},
		}
		const existingRoute = operation(snapshot, 'zoltar.migration.split', exactOptions)
		expect(existingRoute.plan?.metadata['childUniverseId']).toBe(childId)
	})

	test('allows one pool at the resident limit minus one when every resulting aggregate reaches its exact limit', () => {
		const snapshot = snapshotFixture()
		const question = snapshot.questions[0]
		const pool = snapshot.pools[0]
		if (question === undefined || pool === undefined) throw new Error('Pool deployment fixture is incomplete')
		snapshot.questions.push({ ...question, id: '78' }, { ...question, id: '79' })
		const plan = operation(snapshot, 'statoblast.pool.deploy').plan
		if (plan === undefined) throw new Error('Pool deployment should fit at limit minus one')
		expect(plan.metadata['questionId']).not.toBe('77')

		snapshot.pools.push({ ...pool, address: address(88), questionId: String(plan.metadata['questionId']), vaults: [] })
		const repeated = operation(snapshot, 'statoblast.pool.deploy')
		expect(repeated.plan).toBeUndefined()
		expect(repeated.eligibility.blockers.join(' ')).toContain('pool discovery resident limit')
	})

	test('fails topology creation closed when planning capacity is absent or any configured aggregate product is unsafe', () => {
		const snapshot = snapshotFixture()
		const withoutCapacity = { maximumBlockIntervalSeconds: 15, seed: 1 }
		expect(operation(snapshot, 'zoltar.question.create-binary', withoutCapacity).eligibility.blockers).toContain('Immutable topology discovery capacity is unavailable or invalid')

		const question = snapshot.questions[0]
		if (question === undefined) throw new Error('Question fixture is missing')
		snapshot.questions.push({ ...question, id: '78' })
		for (const dimension of ['maxUniverses', 'maxVaultsPerPool', 'maxStagedOperationsPerPool'] as const) {
			const invalidAggregate: PlanningOptions = {
				...capacityOptions,
				immutableTopologyCapacity: {
					...immutableTopologyCapacity,
					[dimension]: 3,
				},
			}
			expect(operation(snapshot, 'statoblast.pool.deploy', invalidAggregate).eligibility.blockers, dimension).toContain('Immutable topology discovery capacity is unavailable or invalid')
		}
	})
})
