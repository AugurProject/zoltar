import { describe, expect, test } from 'bun:test'
import { genesisInitializationPlan, randomOperationPlans, selectOperationPlan, urgentOperationPlans } from '../../src/runtime/selection.ts'
import type { EvaluatedOperation, OperationPlan } from '../../src/operations/types.ts'

function plan(id: string, priority: OperationPlan['priority'], deadlineTimestamp?: string): OperationPlan {
	return {
		classification: priority === 'urgent' ? 'lifecycle-obligation' : 'selectable',
		createdAtBlock: '1',
		definitionId: id,
		ecosystem: 'zoltar',
		id,
		label: id,
		metadata: {},
		obligation: priority === 'urgent',
		planningSeed: 1,
		postconditions: [],
		priority,
		risk: 'low',
		steps: [],
		...(deadlineTimestamp === undefined ? {} : { deadlineTimestamp }),
	}
}

function evaluation(value: OperationPlan | undefined, eligible = true): EvaluatedOperation {
	return {
		definition: {
			classification: value?.classification ?? 'selectable',
			contract: 'Test',
			description: 'test operation',
			discoveryInputs: [],
			ecosystem: value?.ecosystem ?? 'zoltar',
			id: value?.definitionId ?? 'blocked',
			label: value?.label ?? 'blocked',
			method: 'test',
			risk: value?.risk ?? 'low',
		},
		eligibility: { blockers: eligible ? [] : ['blocked'], eligible },
		...(value === undefined ? {} : { plan: value }),
	}
}

describe('chaos operation selection', () => {
	test('selects the earliest urgent lifecycle obligation before random work', () => {
		const evaluations = [evaluation(plan('random', 'random')), evaluation(plan('later', 'urgent', '20')), evaluation(plan('earlier', 'urgent', '10'))]
		expect(urgentOperationPlans(evaluations).map(value => value.id)).toEqual(['earlier', 'later'])
		expect(selectOperationPlan(evaluations, () => 0)?.id).toBe('earlier')
	})

	test('selects uniformly by eligible definition index and ignores blocked plans', () => {
		const evaluations = [evaluation(plan('first', 'random')), evaluation(plan('blocked', 'random'), false), evaluation(plan('second', 'random'))]
		expect(randomOperationPlans(evaluations).map(value => value.id)).toEqual(['first', 'second'])
		expect(selectOperationPlan(evaluations, () => 1)?.id).toBe('second')
	})

	test('enforces the selectable-definition canary allowlist at the final random selection boundary', () => {
		const evaluations = [evaluation(plan('first', 'random')), evaluation(plan('second', 'random'))]
		expect(randomOperationPlans(evaluations, ['second']).map(value => value.id)).toEqual(['second'])
		expect(randomOperationPlans(evaluations, [])).toEqual([])
		expect(selectOperationPlan(evaluations, () => 0, ['second'])?.id).toBe('second')
		expect(selectOperationPlan(evaluations, () => 0, [])).toBeUndefined()
	})

	test('keeps urgent lifecycle work selectable when the novelty allowlist is empty', () => {
		const evaluations = [evaluation(plan('random', 'random')), evaluation(plan('urgent', 'urgent', '20'))]
		expect(selectOperationPlan(evaluations, () => 0, [])?.id).toBe('urgent')
	})

	test('retries the earliest missing genesis prerequisite before later initialization work', () => {
		const evaluations = [evaluation(plan('trading.pair.create', 'random')), evaluation(plan('statoblast.vault.deposit-rep', 'random')), evaluation(plan('statoblast.pool.deploy', 'random'))]
		expect(genesisInitializationPlan(evaluations, { genesisUniversePresent: true, hasInitializedPair: false, hasPair: false, hasPool: false, hasQuestion: true, hasWalletVault: false })?.definitionId).toBe('statoblast.pool.deploy')
		expect(genesisInitializationPlan([evaluation(plan('trading.pair.create', 'random'))], { genesisUniversePresent: true, hasInitializedPair: false, hasPair: false, hasPool: true, hasQuestion: true, hasWalletVault: true })?.definitionId).toBe('trading.pair.create')
		expect(genesisInitializationPlan(evaluations, { genesisUniversePresent: false, hasInitializedPair: false, hasPair: false, hasPool: false, hasQuestion: false, hasWalletVault: false })).toBeUndefined()
	})

	test('returns undefined when no operation has an eligible plan', () => {
		expect(selectOperationPlan([evaluation(undefined), evaluation(plan('blocked', 'random'), false)])).toBeUndefined()
	})

	test('rejects an injected random source outside the candidate range', () => {
		expect(() => selectOperationPlan([evaluation(plan('only', 'random'))], () => 1)).toThrow('Random operation index')
	})

	test('rejects malformed urgent deadlines instead of silently misordering work', () => {
		expect(() => urgentOperationPlans([evaluation(plan('bad', 'urgent', '-1'))])).toThrow('invalid deadline')
	})
})
