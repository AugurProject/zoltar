import { OperationRediscoveryRequired } from '../../src/execution/execution-context.ts'
import { describe, expect, test } from 'bun:test'
import { genesisInitializationPlan, selectExecutableOperationPlan, randomOperationPlans, urgentOperationPlans, type GenesisInitializationState } from '../../src/runtime/selection.ts'
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

function initializedState(overrides: Partial<GenesisInitializationState>): GenesisInitializationState {
	return {
		genesisUniversePresent: true,
		hasInitializedPair: true,
		hasInitializedUniswapPool: true,
		hasPair: true,
		hasPool: true,
		hasQuestion: true,
		hasSeededUniswapPool: true,
		hasUniswapPool: true,
		hasUniswapSeeder: true,
		hasWeth: true,
		hasWalletVault: true,
		tradingFactoryDeployed: true,
		tradingRouterDeployed: true,
		...overrides,
	}
}

describe('chaos operation selection', () => {
	test('selects the earliest urgent lifecycle obligation before random work', () => {
		const evaluations = [evaluation(plan('random', 'random')), evaluation(plan('later', 'urgent', '20')), evaluation(plan('earlier', 'urgent', '10'))]
		expect(urgentOperationPlans(evaluations).map(value => value.id)).toEqual(['earlier', 'later'])
	})

	test('selects uniformly by eligible definition index and ignores blocked plans', () => {
		const evaluations = [evaluation(plan('first', 'random')), evaluation(plan('blocked', 'random'), false), evaluation(plan('second', 'random'))]
		expect(randomOperationPlans(evaluations, ['first', 'second']).map(value => value.id)).toEqual(['first', 'second'])
	})

	test('enforces the selectable-definition canary allowlist at the final random selection boundary', () => {
		const evaluations = [evaluation(plan('first', 'random')), evaluation(plan('second', 'random'))]
		expect(randomOperationPlans(evaluations, ['second']).map(value => value.id)).toEqual(['second'])
		expect(randomOperationPlans(evaluations, [])).toEqual([])
	})

	test('keeps urgent lifecycle work selectable when the novelty allowlist is empty', () => {
		const evaluations = [evaluation(plan('random', 'random')), evaluation(plan('urgent', 'urgent', '20'))]
		expect(urgentOperationPlans(evaluations).map(value => value.id)).toEqual(['urgent'])
		expect(randomOperationPlans(evaluations, [])).toEqual([])
	})

	test('retries the earliest missing genesis prerequisite before later initialization work', () => {
		const evaluations = [evaluation(plan('trading.pair.create', 'random')), evaluation(plan('statoblast.vault.deposit-rep', 'random')), evaluation(plan('statoblast.pool.deploy', 'random'))]
		expect(genesisInitializationPlan(evaluations, initializedState({ hasInitializedPair: false, hasPair: false, hasPool: false, hasWalletVault: false }))?.definitionId).toBe('statoblast.pool.deploy')
		expect(genesisInitializationPlan([evaluation(plan('trading.pair.create', 'random'))], initializedState({ hasInitializedPair: false, hasPair: false }))?.definitionId).toBe('trading.pair.create')
		expect(genesisInitializationPlan(evaluations, initializedState({ genesisUniversePresent: false }))).toBeUndefined()
	})

	test('returns no candidates when no operation has an eligible plan', () => {
		const evaluations = [evaluation(undefined), evaluation(plan('blocked', 'random'), false)]
		expect(urgentOperationPlans(evaluations)).toEqual([])
		expect(randomOperationPlans(evaluations, ['blocked'])).toEqual([])
	})

	test('rejects malformed urgent deadlines instead of silently misordering work', () => {
		expect(() => urgentOperationPlans([evaluation(plan('bad', 'urgent', '-1'))])).toThrow('invalid deadline')
	})
})

test('rejects a reverting candidate before selecting an executable operation', async () => {
	const reverting = plan('statoblast.pool.deploy', 'random')
	const executable = plan('open-oracle.weth.wrap', 'random')
	const checked: string[] = []
	const rejected: string[] = []
	const result = await selectExecutableOperationPlan(
		[reverting, executable],
		async candidate => {
			checked.push(candidate.id)
			if (candidate === reverting) throw new OperationRediscoveryRequired('Security pool deployment failed')
		},
		candidate => {
			rejected.push(candidate.id)
		},
		() => 0,
	)
	expect(result).toBe(executable)
	expect(checked).toEqual([reverting.id, executable.id])
	expect(rejected).toEqual([reverting.id])
})

test('returns no selection when every candidate reverts and does not mutate candidates', async () => {
	const candidates = [plan('statoblast.pool.deploy', 'random')]
	expect(
		await selectExecutableOperationPlan(
			candidates,
			async () => {
				throw new OperationRediscoveryRequired('reverted')
			},
			() => {},
			() => 0,
		),
	).toBeUndefined()
	expect(candidates).toHaveLength(1)
})

test('propagates infrastructure and unexpected preflight failures without trying another operation', async () => {
	const failure = new Error('RPC quorum unavailable')
	let attempts = 0
	await expect(
		selectExecutableOperationPlan(
			[plan('one', 'random'), plan('two', 'random')],
			async () => {
				attempts += 1
				throw failure
			},
			() => {},
			() => 0,
		),
	).rejects.toBe(failure)
	expect(attempts).toBe(1)
})
