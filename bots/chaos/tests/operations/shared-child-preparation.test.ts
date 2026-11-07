import { expect, test } from 'bun:test'
import { decodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { securityPoolFactoryAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import { canonicalLifecyclePresence } from '../../src/operations/catalog.ts'
import { initializeChildHistory } from '../../src/operations/statoblast/child-preparation.ts'
import { forkDefinition } from '../../src/operations/statoblast/forks.ts'
import { assertWorkflowPrerequisiteLimit } from '../../src/operations/timing.ts'
import type { PlanningOptions } from '../../src/operations/types.ts'
import { address, snapshotFixture } from './fixture.ts'

const options: PlanningOptions = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	immutableTopologyCapacity: { maxPools: 10, maxQuestions: 10, maxUniverses: 10, maxVaultsPerPool: 10, maxStagedOperationsPerPool: 10, maximumAggregateItems: 100 },
	maximumBlockIntervalSeconds: 15,
	maxEthSpendAttoEth: (10n ** 18n).toString(),
	maxRepSpendAttoRep: (10n ** 18n).toString(),
	minimumEthReserveAttoEth: 0n.toString(),
	minimumRepReserveAttoRep: 0n.toString(),
	seed: 1,
}
function forkFixture() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const universe = snapshot.universes[0]
	const question = snapshot.questions[0]
	if (pool === undefined || universe === undefined || question === undefined) throw new Error('Missing fork fixture')
	pool.systemState = 1
	universe.forkTime = '1999999000'
	universe.forkQuestionId = question.id
	pool.childPoolPreparations['0'] = { portfolio: address(90), branchReady: true, sourcePool: pool.address, sourceGame: zeroAddress, childUniverseId: '88', childPool: zeroAddress, game: zeroAddress, historyOutcomesInitialized: 0, historyReady: false, feedRequired: true, dependenciesRequired: true }
	return { snapshot, pool }
}

test('shared child creation prepares its native namespace only after the shared branch is ready', () => {
	const { snapshot } = forkFixture()
	const plan = forkDefinition('create-child')
		.buildLifecyclePlans?.(snapshot, options)
		.find(plan => plan.metadata?.['outcome'] === '0')
	expect(plan?.steps.map(step => decodeFunctionData({ abi: [...securityPoolFactoryAbi, ...securityPoolForkerAbi], data: step.data }).functionName)).toEqual(['preparePortfolioQuestion'])
	if (plan === undefined) throw new Error('Missing shared child creation plan')
	expect(assertWorkflowPrerequisiteLimit(plan)).toBe(0)
	expect(plan.steps[0]?.evidence).toMatchObject([{ functionName: 'getPool', args: [snapshot.pools[0]?.questionId, '88'], relation: 'greater-than', expected: '0' }])
})

for (const expired of [false, true])
	test(`registered child history advances in one bounded transaction (${expired})`, () => {
		const { snapshot, pool } = forkFixture()
		const preparation = pool.childPoolPreparations['0']
		if (preparation === undefined) throw new Error('Missing child preparation')
		preparation.childPool = address(93)
		preparation.game = address(94)
		preparation.sourceGame = address(96)
		preparation.historyOutcomesInitialized = 1
		if (expired) snapshot.anchor.timestamp = (1999999000n + 8n * 7n * 86400n + 1n).toString()
		const plan = initializeChildHistory.buildPlan(snapshot, options)
		expect(plan?.steps).toHaveLength(1)
		expect(plan?.deadlineTimestamp).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options).find(item => item.definitionId === initializeChildHistory.id)?.metadata).toEqual(plan?.metadata)
		const step = plan?.steps[0]
		if (step === undefined) throw new Error('Missing initialization step')
		expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: step.data })).toMatchObject({ functionName: 'materializePortfolioQuestion', args: [pool.address, 88n] })
		expect(step.evidence).toMatchObject([{ contract: address(94), functionName: 'forkCarrySnapshotOutcomesInitialized', expected: '1' }])
		preparation.historyReady = true
		preparation.historyOutcomesInitialized = 3
		expect(initializeChildHistory.buildPlan(snapshot, options)).toBeUndefined()
	})

test('shared child work waits for branch activation and remains available after the standalone migration cutoff', () => {
	const { snapshot, pool } = forkFixture()
	const preparation = pool.childPoolPreparations['0']
	if (preparation === undefined) throw new Error('Missing preparation')
	snapshot.anchor.timestamp = (1999999000n + 70n * 86400n).toString()
	preparation.branchReady = false
	const plans = () =>
		forkDefinition('create-child')
			.buildLifecyclePlans?.(snapshot, options)
			.filter(plan => plan.metadata?.['outcome'] === '0')
	expect(plans()).toEqual([])
	preparation.branchReady = true
	expect(plans()).toHaveLength(1)
	expect(plans()?.[0]?.deadlineTimestamp).toBeUndefined()
})

test('shared reporter initialization uses its last live source and one bounded materialization call', () => {
	const { snapshot, pool } = forkFixture()
	const preparation = pool.childPoolPreparations['0']
	if (preparation === undefined) throw new Error('Missing preparation')
	preparation.childPool = address(93)
	preparation.sourcePool = address(95)
	preparation.sourceGame = address(96)
	preparation.game = address(94)
	preparation.historyOutcomesInitialized = 1
	const plan = initializeChildHistory.buildPlan(snapshot, options)
	const step = plan?.steps[0]
	if (step === undefined) throw new Error('Missing materialization')
	expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: step.data })).toMatchObject({ functionName: 'materializePortfolioQuestion', args: [address(95), 88n] })
	expect(step.gasLimit).toBe('16777216')
	preparation.branchReady = false
	expect(initializeChildHistory.buildPlan(snapshot, options)).toBeUndefined()
})
