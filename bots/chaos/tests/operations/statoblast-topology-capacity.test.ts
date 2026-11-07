import { describe, expect, test } from 'bun:test'
import { canonicalLifecyclePresence, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { eligibleOperationPlans, urgentOperationPlans } from '../support/operation-plans.ts'
import type { EcosystemSnapshot, PlanningOptions, PoolSnapshot } from '../../src/operations/types.ts'
import { address, hash, snapshotFixture } from './fixture.ts'

const capacity = {
	maxPools: 2,
	maxQuestions: 2,
	maxStagedOperationsPerPool: 2,
	maxUniverses: 2,
	maxVaultsPerPool: 2,
	maximumAggregateItems: 4,
} as const

const options: PlanningOptions = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	immutableTopologyCapacity: capacity,
	maximumBlockIntervalSeconds: 15,
	maxEthSpendAttoEth: (10n ** 18n).toString(),
	maxRepSpendAttoRep: (10n ** 18n).toString(),
	minimumEthReserveAttoEth: 0n.toString(),
	minimumRepReserveAttoRep: 0n.toString(),
	seed: 1,
}

function requiredPool(snapshot: EcosystemSnapshot) {
	const pool = snapshot.pools[0]
	if (pool === undefined) throw new Error('Pool fixture is missing')
	return pool
}

function resolvedEscalationDeposit(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	pool.questionOutcome = 1
	snapshot.escalationDeposits = [
		{
			amountAttoRep: 1_000n.toString(),
			claimed: false,
			depositIndex: '3',
			escalationGame: pool.escalationGame,
			outcome: 1,
			parentDepositIndex: '3',
			pool: pool.address,
			vault: snapshot.wallet.address,
		},
	]
}

function plans(snapshot: EcosystemSnapshot, definitionId: string, planningOptions = options) {
	return urgentOperationPlans(snapshot, planningOptions).filter(plan => plan.definitionId === definitionId)
}

function presence(snapshot: EcosystemSnapshot, definitionId: string, planningOptions = options) {
	return canonicalLifecyclePresence(snapshot, planningOptions).filter(candidate => candidate.definitionId === definitionId)
}

function carryCandidate(snapshot: EcosystemSnapshot) {
	const pool = requiredPool(snapshot)
	return {
		amountAttoRep: 10n.toString(),
		amountToWithdrawAttoRep: 10n.toString(),
		burnAmountAttoRep: 0n.toString(),
		claimSourceGame: address(83),
		depositor: snapshot.wallet.address,
		game: pool.escalationGame,
		outcome: 1 as const,
		parentDepositIndex: '7',
		pool: pool.address,
		preflightExpectedResult: '0x' as const,
		proof: {
			amountAttoRep: 10n.toString(),
			cumulativeAmountAttoRep: 10n.toString(),
			depositor: snapshot.wallet.address,
			leafIndex: '0',
			merkleMountainRangePeakIndex: '0',
			merkleMountainRangeSiblings: [],
			nullifierSiblings: Array.from({ length: 64 }, () => hash(0)),
			parentDepositIndex: '7',
			sourceNodeId: '9',
		},
		resultingCarryRoot: hash(80),
		resultingNullifierRoot: hash(81),
		sourceGame: address(83),
		sourceNodeId: '9',
		sourcePool: address(84),
	}
}

describe('Wallet reporter independence from portfolio capital', () => {
	test('keeps reporter claims executable independently of standalone vault capacity', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		resolvedEscalationDeposit(snapshot, pool)
		const initial = plans(snapshot, 'statoblast.escalation.withdraw')[0]
		if (initial === undefined) throw new Error('Wallet reporter claim did not build')
		expect(presence(snapshot, 'statoblast.escalation.withdraw')).toEqual([expect.objectContaining({ blocksNovelty: true })])
		expect(reevaluateOperationContinuation(snapshot, initial, options).plan?.metadata).toEqual(initial.metadata)
	})

	test('permits unregistered wallet reporting and cleans up if mutation revalidation fails', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.escalation.deposit-wallet-rep')).toBeDefined()

		const initial = eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.escalation.deposit-wallet-rep')
		if (initial === undefined) throw new Error('Direct-deposit fixture did not build')
		const approval = initial.steps.find(step => step.id === 'approve-direct-rep')
		if (approval === undefined) throw new Error('Direct-deposit approval step is missing')
		const token = snapshot.wallet.tokens.find(candidate => candidate.address.toLowerCase() === pool.repToken.toLowerCase())
		if (token === undefined) throw new Error('REP inventory is missing')
		token.allowances[pool.escalationGame] = String(initial.metadata['acceptedAmountAttoRep'])
		for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = true
		const { seed: _seed, ...continuationOptions } = options
		expect(reevaluateOperationContinuation(snapshot, initial, continuationOptions, { confirmedStepIds: [approval.id] }).plan?.steps.map(step => step.id)).toEqual(['deposit-wallet-rep'])
		for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = false
		const cleanup = reevaluateOperationContinuation(snapshot, initial, continuationOptions, { confirmedStepIds: [approval.id] }).plan
		expect(cleanup?.continuationDisposition).toBe('cleanup-only')
		expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-direct-rep'])
	})

	test('allows wallet-owned forked carry without a capital position and fails closed on a mismatched proof depositor', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		pool.escalationFinalQuestionResolution = 1
		pool.escalationResolved = true
		pool.forkCarrySnapshotInitialized = true
		pool.questionOutcome = 1
		const candidate = carryCandidate(snapshot)
		snapshot.forkedCarryWithdrawals = [candidate]
		snapshot.forkedCarryWithdrawalPresence = [candidate]
		expect(plans(snapshot, 'statoblast.escalation.withdraw-forked')).toHaveLength(1)
		expect(presence(snapshot, 'statoblast.escalation.withdraw-forked')).toEqual([expect.objectContaining({ blocksNovelty: true })])

		expect(plans(snapshot, 'statoblast.escalation.withdraw-forked')).toHaveLength(1)
		candidate.depositor = address(99)
		candidate.proof.depositor = address(99)
		expect(plans(snapshot, 'statoblast.escalation.withdraw-forked')).toHaveLength(0)
		expect(presence(snapshot, 'statoblast.escalation.withdraw-forked')).toEqual([expect.objectContaining({ blocksNovelty: true })])
	})
})

test('native child preparation respects the pool cap without blocking existing child histories', () => {
	const snapshot = snapshotFixture()
	const pool = requiredPool(snapshot)
	const universe = snapshot.universes[0]
	if (universe === undefined) throw new Error('Missing universe')
	universe.forkTime = '1999999000'
	universe.forkQuestionId = pool.questionId
	pool.systemState = 1
	pool.childPoolPreparations['0'] = { portfolio: pool.portfolio, branchReady: true, sourcePool: pool.address, sourceGame: address(0), childUniverseId: '88', childPool: address(0), game: address(0), historyOutcomesInitialized: 0, historyReady: false, feedRequired: false, dependenciesRequired: false }
	expect(plans(snapshot, 'statoblast.fork.create-child')).toHaveLength(1)
	snapshot.pools.push({ ...pool, address: address(99), questionId: '999', childPoolPreparations: {} })
	expect(plans(snapshot, 'statoblast.fork.create-child')).toHaveLength(0)
	expect(presence(snapshot, 'statoblast.fork.create-child')).toEqual([expect.objectContaining({ blocksNovelty: false })])
	pool.childPoolPreparations['0'].childPool = address(88)
	expect(plans(snapshot, 'statoblast.child.initialize-history')).toHaveLength(1)
})
