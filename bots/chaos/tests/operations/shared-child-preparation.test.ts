import { expect, test } from 'bun:test'
import { custom, decodeFunctionData, encodeAbiParameters, encodeFunctionData, sepolia, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { securityPoolFactoryAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import example from '../../config/operator.example.json'
import { parseSettings } from '../../src/config/settings.ts'
import { captureStorageEvidence } from '../../src/execution/execution-evidence.ts'
import { canonicalLifecyclePresence } from '../../src/operations/catalog.ts'
import { initializeChildHistory, childLedgerNeedsPreparation } from '../../src/operations/statoblast/child-preparation.ts'
import { forkDefinition } from '../../src/operations/statoblast/forks.ts'
import { requiredTimestampSafetySeconds, assertWorkflowPrerequisiteLimit } from '../../src/operations/timing.ts'
import type { PlanningOptions } from '../../src/operations/types.ts'
import { initialRuntimeState } from '../../src/state/initial-state.ts'
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
	pool.forkActivationTime = '1999999000'
	universe.forkTime = pool.forkActivationTime
	universe.forkQuestionId = question.id
	pool.childPoolPreparations['0'] = { portfolio: address(90), childUniverseId: '88', childPool: zeroAddress, game: zeroAddress, historyOutcomesInitialized: 0, historyReady: false, feedRequired: true, dependenciesRequired: true }
	return { snapshot, pool }
}

test('shared child creation prepares the feed and dependencies in separate bounded transactions', () => {
	const { snapshot } = forkFixture()
	const plan = forkDefinition('create-child')
		.buildLifecyclePlans?.(snapshot, options)
		.find(plan => plan.metadata?.['outcome'] === '0')
	expect(plan?.steps.map(step => decodeFunctionData({ abi: [...securityPoolFactoryAbi, ...securityPoolForkerAbi], data: step.data }).functionName)).toEqual(['preparePortfolioChildPriceFeed', 'prepareChildPoolDependencies', 'createChildUniverse'])
	if (plan === undefined) throw new Error('Missing shared child creation plan')
	expect(assertWorkflowPrerequisiteLimit(plan)).toBe(2)
	expect(plan.steps[0]?.evidence).toMatchObject([{ functionName: 'sharedPriceFeeds', args: [address(90), '88'], relation: 'greater-than', expected: '0' }])
})

test('native child creation prepares only its coordinator and auction, and completed preparation is skipped', () => {
	const { snapshot, pool } = forkFixture()
	const preparation = pool.childPoolPreparations['0']
	if (preparation === undefined) throw new Error('Missing preparation')
	preparation.portfolio = zeroAddress
	preparation.feedRequired = false
	const plans = () =>
		forkDefinition('create-child')
			.buildLifecyclePlans?.(snapshot, options)
			.find(plan => plan.metadata?.['outcome'] === '0')
	expect(plans()?.steps.map(step => decodeFunctionData({ abi: [...securityPoolFactoryAbi, ...securityPoolForkerAbi], data: step.data }).functionName)).toEqual(['prepareChildPoolDependencies', 'createChildUniverse'])
	preparation.dependenciesRequired = false
	expect(plans()?.steps.map(step => decodeFunctionData({ abi: [...securityPoolFactoryAbi, ...securityPoolForkerAbi], data: step.data }).functionName)).toEqual(['createChildUniverse'])
})

test('extra preparation finality time is included in the migration deadline guard', () => {
	const { snapshot, pool } = forkFixture()
	const deadline = BigInt(pool.forkActivationTime) + 8n * 7n * 86400n
	snapshot.anchor.timestamp = (deadline - requiredTimestampSafetySeconds(options, 2)).toString()
	expect(
		forkDefinition('create-child')
			.buildLifecyclePlans?.(snapshot, options)
			.some(plan => plan.metadata?.['outcome'] === '0'),
	).toBe(false)
	snapshot.anchor.timestamp = (BigInt(snapshot.anchor.timestamp) - 1n).toString()
	expect(
		forkDefinition('create-child')
			.buildLifecyclePlans?.(snapshot, options)
			.some(plan => plan.metadata?.['outcome'] === '0'),
	).toBe(true)
})

test('vault migration waits for the canonical child creation lifecycle plan', () => {
	const { snapshot, pool } = forkFixture()
	for (const outcome of ['0', '1', '2']) pool.childPoolPreparations[outcome] = { portfolio: address(90), childUniverseId: '88', childPool: zeroAddress, game: zeroAddress, historyOutcomesInitialized: 0, historyReady: false, feedRequired: true, dependenciesRequired: true }
	expect(forkDefinition('migrate-vault').buildLifecyclePlans?.(snapshot, options)).toEqual([])
})

test('dependency receipt evidence reads the first static return word and rejects an incomplete tuple', async () => {
	const { snapshot, pool } = forkFixture()
	const step = forkDefinition('create-child')
		.buildLifecyclePlans?.(snapshot, options)
		.find(plan => plan.metadata?.['outcome'] === '0')
		?.steps.find(step => step.id === 'prepare-child-contracts-0')
	if (step === undefined) throw new Error('Missing dependency preparation step')
	let result = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [address(91), address(92)])
	const transport = custom({
		async request({ method, params }) {
			expect(method).toBe('eth_call')
			expect(params).toEqual([{ to: snapshot.deployments.securityPoolFactory, data: encodeFunctionData({ abi: securityPoolFactoryAbi, functionName: 'getChildPoolDependencies', args: [pool.address, 0n] }) }, '0xa'])
			return result
		},
	})
	const rpcUrl = 'https://storage-evidence.example.invalid'
	const settings = parseSettings({ ...example, networkConfigured: true, connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl, rpcQuorum: 1 } })
	const environment = {
		chain: sepolia,
		pool: { ...createRpcEndpointPool([rpcUrl]), transportFor: () => transport },
		sender: address(1),
		settings,
		state: initialRuntimeState(true, address(1), sepolia.id),
	}
	const captured = await captureStorageEvidence(environment, step.evidence, 10n)
	expect([...captured.values()]).toEqual([address(91).toLowerCase()])
	result = '0x'
	await expect(captureStorageEvidence(environment, step.evidence, 10n)).rejects.toThrow('returned no data')
	result = encodeAbiParameters([{ type: 'address' }], [address(91)])
	await expect(captureStorageEvidence(environment, step.evidence, 10n)).rejects.toThrow('Unable to decode getChildPoolDependencies result')
})

for (const expired of [false, true])
	test(`registered child history advances in one bounded transaction (${expired})`, () => {
		const { snapshot, pool } = forkFixture()
		const preparation = pool.childPoolPreparations['0']
		if (preparation === undefined) throw new Error('Missing child preparation')
		preparation.childPool = address(93)
		preparation.game = address(94)
		preparation.historyOutcomesInitialized = 1
		if (expired) snapshot.anchor.timestamp = (BigInt(pool.forkActivationTime) + 8n * 7n * 86400n + 1n).toString()
		expect(childLedgerNeedsPreparation(pool, '0')).toBe(true)
		const plan = initializeChildHistory.buildPlan(snapshot, options)
		expect(plan?.steps).toHaveLength(1)
		expect(plan?.deadlineTimestamp).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options).find(item => item.definitionId === initializeChildHistory.id)?.metadata).toEqual(plan?.metadata)
		const step = plan?.steps[0]
		if (step === undefined) throw new Error('Missing initialization step')
		expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: step.data })).toMatchObject({ functionName: 'continueChildUniverse', args: [pool.address, 0n] })
		expect(step.evidence).toMatchObject([{ contract: address(94), functionName: 'forkCarrySnapshotOutcomesInitialized', expected: '1' }])
		preparation.historyReady = true
		preparation.historyOutcomesInitialized = 3
		expect(initializeChildHistory.buildPlan(snapshot, options)).toBeUndefined()
		expect(childLedgerNeedsPreparation(pool, '0')).toBe(false)
	})
