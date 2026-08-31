import { describe, expect, test } from 'bun:test'
import { canonicalLifecyclePresence, eligibleOperationPlans, evaluateOperationCatalog, reevaluateOperationContinuation, urgentOperationPlans } from '../../src/operations/catalog.ts'
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

function forkedSnapshot() {
	const snapshot = snapshotFixture()
	const pool = requiredPool(snapshot)
	const universe = snapshot.universes[0]
	const question = snapshot.questions[0]
	if (universe === undefined || question === undefined) throw new Error('Fork fixture is incomplete')
	pool.systemState = 1
	pool.forkActivationTime = '1999999000'
	universe.forkTime = pool.forkActivationTime
	universe.forkQuestionId = question.id
	return { pool, snapshot, universe }
}

function childUniverse(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome = '0') {
	const parent = snapshot.universes.find(universe => universe.id === pool.universeId)
	if (parent === undefined) throw new Error('Parent universe is missing')
	const child = {
		...parent,
		forkQuestionId: '0',
		forkTime: '0',
		forkingOutcomeIndex: outcome,
		id: '88',
		knownChildOutcomes: [],
		migrationRepSplitProgressByOutcome: {},
		parentUniverseId: parent.id,
	}
	snapshot.universes.push(child)
	return child
}

function unrelatedUniverse(snapshot: EcosystemSnapshot) {
	const universe = snapshot.universes[0]
	if (universe === undefined) throw new Error('Universe fixture is missing')
	snapshot.universes.push({ ...universe, forkQuestionId: '0', forkTime: '0', id: '99', knownChildOutcomes: [], migrationRepSplitProgressByOutcome: {} })
}

function childPool(snapshot: EcosystemSnapshot, parent: PoolSnapshot, outcome = '0') {
	const universe = snapshot.universes.find(candidate => candidate.parentUniverseId === parent.universeId && candidate.forkingOutcomeIndex === outcome) ?? childUniverse(snapshot, parent, outcome)
	const child = structuredClone(parent)
	child.address = address(88)
	child.canonicalVaultCount = '1'
	child.forkOutcomeIndex = outcome
	child.parent = parent.address
	child.systemState = 2
	child.universeId = universe.id
	child.walletVaultRegistered = true
	snapshot.pools.push(child)
	return child
}

function saturatePoolCapacity(snapshot: EcosystemSnapshot) {
	const pool = requiredPool(snapshot)
	const unrelated = structuredClone(pool)
	unrelated.address = address(99)
	unrelated.forkActivationTime = '0'
	unrelated.forkRepMigrationProgressByOutcome = {}
	unrelated.forkRepMigrationTargetAttoRep = '0'
	unrelated.questionId = '999'
	unrelated.systemState = 0
	unrelated.vaults = []
	snapshot.pools.push(unrelated)
}

function onlyRepMigration(pool: PoolSnapshot) {
	pool.forkRepMigrationTargetAttoRep = '100'
	pool.forkRepMigrationProgressByOutcome = { '0': '0', '1': '100', '2': '100' }
}

function unresolvedVaultMigration(pool: PoolSnapshot) {
	pool.forkUnresolvedEscalation = true
	pool.unresolvedEscalationMigrationReadyOutcomes = ['0']
}

function forkClaim(snapshot: EcosystemSnapshot, pool: PoolSnapshot) {
	pool.escalationCanTriggerOwnFork = true
	pool.forkOwnQuestion = true
	pool.forkUnresolvedEscalation = true
	snapshot.escalationDeposits = [
		{
			amountAttoRep: 100n.toString(),
			claimed: false,
			depositIndex: '0',
			escalationGame: pool.escalationGame,
			outcome: 0,
			parentDepositIndex: '0',
			pool: pool.address,
			vault: snapshot.wallet.address,
		},
	]
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

describe('Statoblast implicit topology capacity', () => {
	test('allows every implicit child route at final-state limits and blocks all routes when the pool limit is full', () => {
		const cases: Array<{ definitionId: string; prepare(snapshot: EcosystemSnapshot, pool: PoolSnapshot): void }> = [
			{ definitionId: 'statoblast.fork.create-child', prepare: () => undefined },
			{ definitionId: 'statoblast.fork.migrate-vault', prepare: () => undefined },
			{ definitionId: 'statoblast.fork.migrate-vault-unresolved', prepare: (_snapshot, pool) => unresolvedVaultMigration(pool) },
			{ definitionId: 'statoblast.escalation.claim-forked', prepare: (snapshot, pool) => forkClaim(snapshot, pool) },
		]

		for (const testCase of cases) {
			const allowed = forkedSnapshot()
			testCase.prepare(allowed.snapshot, allowed.pool)
			expect(plans(allowed.snapshot, testCase.definitionId).length, `${testCase.definitionId} at limit minus one`).toBeGreaterThan(0)

			const blocked = forkedSnapshot()
			testCase.prepare(blocked.snapshot, blocked.pool)
			saturatePoolCapacity(blocked.snapshot)
			expect(plans(blocked.snapshot, testCase.definitionId), `${testCase.definitionId} at pool limit`).toHaveLength(0)
			expect(presence(blocked.snapshot, testCase.definitionId), `${testCase.definitionId} raw presence`).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: true })]))
		}
	})

	test('reserves only a child universe for REP migration when no child pool exists', () => {
		const poolFull = forkedSnapshot()
		onlyRepMigration(poolFull.pool)
		saturatePoolCapacity(poolFull.snapshot)
		expect(poolFull.snapshot.pools).toHaveLength(capacity.maxPools)
		expect(poolFull.snapshot.universes).toHaveLength(capacity.maxUniverses - 1)
		expect(plans(poolFull.snapshot, 'statoblast.fork.migrate-rep')).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ pool: poolFull.pool.address }) })])

		const universeFull = forkedSnapshot()
		onlyRepMigration(universeFull.pool)
		unrelatedUniverse(universeFull.snapshot)
		expect(plans(universeFull.snapshot, 'statoblast.fork.migrate-rep')).toHaveLength(0)
		expect(presence(universeFull.snapshot, 'statoblast.fork.migrate-rep')).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: true })]))

		const existingUniverseAtExactLimits = forkedSnapshot()
		onlyRepMigration(existingUniverseAtExactLimits.pool)
		childUniverse(existingUniverseAtExactLimits.snapshot, existingUniverseAtExactLimits.pool)
		saturatePoolCapacity(existingUniverseAtExactLimits.snapshot)
		expect(existingUniverseAtExactLimits.snapshot.pools).toHaveLength(capacity.maxPools)
		expect(existingUniverseAtExactLimits.snapshot.universes).toHaveLength(capacity.maxUniverses)
		expect(plans(existingUniverseAtExactLimits.snapshot, 'statoblast.fork.migrate-rep')).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ pool: existingUniverseAtExactLimits.pool.address }) })])
	})

	test('distinguishes a known child universe from a route that would create another universe', () => {
		const cases: Array<{ definitionId: string; prepare(snapshot: EcosystemSnapshot, pool: PoolSnapshot): void }> = [
			{ definitionId: 'statoblast.fork.migrate-rep', prepare: (_snapshot, pool) => onlyRepMigration(pool) },
			{ definitionId: 'statoblast.fork.create-child', prepare: () => undefined },
			{ definitionId: 'statoblast.fork.migrate-vault', prepare: () => undefined },
			{ definitionId: 'statoblast.fork.migrate-vault-unresolved', prepare: (_snapshot, pool) => unresolvedVaultMigration(pool) },
			{ definitionId: 'statoblast.escalation.claim-forked', prepare: (snapshot, pool) => forkClaim(snapshot, pool) },
		]

		for (const testCase of cases) {
			const known = forkedSnapshot()
			testCase.prepare(known.snapshot, known.pool)
			childUniverse(known.snapshot, known.pool)
			expect(plans(known.snapshot, testCase.definitionId).length, `${testCase.definitionId} with a known universe`).toBeGreaterThan(0)

			const missing = forkedSnapshot()
			testCase.prepare(missing.snapshot, missing.pool)
			unrelatedUniverse(missing.snapshot)
			expect(plans(missing.snapshot, testCase.definitionId), `${testCase.definitionId} with universe capacity full`).toHaveLength(0)
			expect(presence(missing.snapshot, testCase.definitionId), `${testCase.definitionId} raw presence`).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: true })]))
		}
	})

	test('keeps already-created child routes executable at exact pool and universe limits', () => {
		for (const definitionId of ['statoblast.fork.migrate-rep', 'statoblast.fork.migrate-vault', 'statoblast.fork.migrate-vault-unresolved', 'statoblast.escalation.claim-forked']) {
			const { pool, snapshot } = forkedSnapshot()
			if (definitionId === 'statoblast.fork.migrate-rep') onlyRepMigration(pool)
			if (definitionId === 'statoblast.fork.migrate-vault-unresolved') unresolvedVaultMigration(pool)
			if (definitionId === 'statoblast.escalation.claim-forked') forkClaim(snapshot, pool)
			childPool(snapshot, pool)
			expect(snapshot.pools).toHaveLength(capacity.maxPools)
			expect(snapshot.universes).toHaveLength(capacity.maxUniverses)
			expect(plans(snapshot, definitionId).length, definitionId).toBeGreaterThan(0)
		}
	})
})

function atVaultCapacity(pool: PoolSnapshot, registered: boolean) {
	pool.canonicalVaultCount = capacity.maxVaultsPerPool.toString()
	pool.walletVaultRegistered = registered
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
		resultingUnresolvedTotalAttoRep: 0n.toString(),
		snapshotId: hash(82),
		sourceGame: address(83),
		sourceNodeId: '9',
		sourcePool: address(84),
	}
}

describe('Statoblast vault-registration capacity', () => {
	test('keeps escalation withdrawal visible while blocking an unregistered beneficiary at capacity', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		resolvedEscalationDeposit(snapshot, pool)
		atVaultCapacity(pool, false)
		expect(plans(snapshot, 'statoblast.escalation.withdraw')).toHaveLength(0)
		expect(presence(snapshot, 'statoblast.escalation.withdraw')).toEqual([expect.objectContaining({ blocksNovelty: true })])
		const evaluation = evaluateOperationCatalog(snapshot, options).find(candidate => candidate.definition.id === 'statoblast.escalation.withdraw')
		expect(evaluation?.eligibility.blockers.join(' ')).toContain('raise discovery.maxVaultsPerPool')

		pool.walletVaultRegistered = true
		const initial = plans(snapshot, 'statoblast.escalation.withdraw')[0]
		if (initial === undefined) throw new Error('Registered escalation withdrawal did not build')
		expect(reevaluateOperationContinuation(snapshot, initial, options).plan?.metadata).toEqual(initial.metadata)

		pool.walletVaultRegistered = false
		expect(reevaluateOperationContinuation(snapshot, initial, options).plan).toBeUndefined()
	})

	test('requires durable wallet-vault registration for direct deposits and cleans up if registration is lost', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		pool.walletVaultRegistered = false
		pool.canonicalVaultCount = '1'
		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.escalation.deposit-wallet-rep')).toBeUndefined()

		atVaultCapacity(pool, true)
		const initial = eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.escalation.deposit-wallet-rep')
		if (initial === undefined) throw new Error('Registered direct-deposit fixture did not build')
		const approval = initial.steps.find(step => step.id === 'approve-direct-rep')
		if (approval === undefined) throw new Error('Direct-deposit approval step is missing')
		const token = snapshot.wallet.tokens.find(candidate => candidate.address.toLowerCase() === pool.repToken.toLowerCase())
		if (token === undefined) throw new Error('REP inventory is missing')
		token.allowances[pool.escalationGame] = String(initial.metadata['acceptedAmountAttoRep'])
		for (const quote of pool.directEscalationDepositQuotes) quote.mutationExpectedSuccess = true
		pool.walletVaultRegistered = false
		const { seed: _seed, ...continuationOptions } = options
		const cleanup = reevaluateOperationContinuation(snapshot, initial, continuationOptions, { confirmedStepIds: [approval.id] }).plan
		expect(cleanup?.continuationDisposition).toBe('cleanup-only')
		expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-direct-rep'])
	})

	test('blocks a new deposit at the vault limit, permits an authenticated existing vault, and cleans up a continuation that loses the last slot', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		atVaultCapacity(pool, false)
		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.vault.deposit-rep')).toBeUndefined()

		pool.walletVaultRegistered = true
		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.vault.deposit-rep')).toBeDefined()

		pool.walletVaultRegistered = false
		pool.canonicalVaultCount = '1'
		const initial = eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.vault.deposit-rep')
		if (initial === undefined) throw new Error('Deposit continuation fixture did not build')
		const approval = initial.steps.find(step => step.id === 'approve-rep')
		if (approval === undefined) throw new Error('Deposit approval step is missing')
		const amountAttoRep = String(initial.metadata['amountAttoRep'])
		const token = snapshot.wallet.tokens.find(candidate => candidate.address.toLowerCase() === pool.repToken.toLowerCase())
		if (token === undefined) throw new Error('REP inventory is missing')
		token.allowances[pool.address] = amountAttoRep
		atVaultCapacity(pool, false)
		const { seed: _seed, ...continuationOptions } = options
		const cleanup = reevaluateOperationContinuation(snapshot, initial, continuationOptions, { confirmedStepIds: [approval.id] }).plan
		expect(cleanup?.continuationDisposition).toBe('cleanup-only')
		expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-rep'])
	})

	test('gates both child vault migrations with authenticated target registration while retaining obstructing presence', () => {
		for (const definitionId of ['statoblast.fork.migrate-vault', 'statoblast.fork.migrate-vault-unresolved']) {
			const { pool, snapshot } = forkedSnapshot()
			if (definitionId.endsWith('unresolved')) unresolvedVaultMigration(pool)
			const child = childPool(snapshot, pool)
			atVaultCapacity(child, false)
			expect(plans(snapshot, definitionId), definitionId).toHaveLength(0)
			expect(presence(snapshot, definitionId), definitionId).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: true })]))
			child.walletVaultRegistered = true
			expect(plans(snapshot, definitionId).length, definitionId).toBeGreaterThan(0)
		}
	})

	test('gates unresolved migration on authenticated source registration while retaining raw lifecycle presence', () => {
		const blocked = forkedSnapshot()
		unresolvedVaultMigration(blocked.pool)
		const blockedChild = childPool(blocked.snapshot, blocked.pool)
		atVaultCapacity(blockedChild, true)
		atVaultCapacity(blocked.pool, false)
		expect(plans(blocked.snapshot, 'statoblast.fork.migrate-vault-unresolved')).toHaveLength(0)
		expect(presence(blocked.snapshot, 'statoblast.fork.migrate-vault-unresolved')).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: true })]))

		const allowed = forkedSnapshot()
		unresolvedVaultMigration(allowed.pool)
		const allowedChild = childPool(allowed.snapshot, allowed.pool)
		atVaultCapacity(allowedChild, true)
		atVaultCapacity(allowed.pool, true)
		expect(plans(allowed.snapshot, 'statoblast.fork.migrate-vault-unresolved')).toHaveLength(1)
	})

	test('settles definitively losing bids without a slot and defers potentially winning bids until the wallet is registered', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		atVaultCapacity(pool, false)
		snapshot.auctions = [
			{
				address: address(40),
				bids: [
					{ amountAttoEth: 1n.toString(), index: '0', refunded: false, tick: '4' },
					{ amountAttoEth: 1n.toString(), index: '1', refunded: false, tick: '5' },
				],
				clearingTick: '5',
				endTime: '10',
				finalized: true,
				hasClearingPrice: true,
				minimumBidAttoEth: 1n.toString(),
				pendingEthRefund: '0',
				pool: pool.address,
				startTime: '1',
				underfunded: false,
				underfundedWinningAttoEth: 0n.toString(),
			},
		]
		let settlementPlans = plans(snapshot, 'statoblast.auction.settle-bids')
		expect(settlementPlans).toHaveLength(1)
		expect(settlementPlans[0]?.metadata['bidKeys']).toBe('4:0')
		expect(presence(snapshot, 'statoblast.auction.settle-bids')).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: true, metadata: expect.objectContaining({ bidKeys: '4:0' }) }), expect.objectContaining({ blocksNovelty: true, metadata: expect.objectContaining({ bidKeys: '5:1' }) })]))

		pool.walletVaultRegistered = true
		settlementPlans = plans(snapshot, 'statoblast.auction.settle-bids')
		expect(settlementPlans.map(plan => plan.metadata['bidKeys']).sort()).toEqual(['4:0', '5:1'])
	})

	test('uses authenticated wallet registration for forked carry and fails closed on a mismatched proof depositor', () => {
		const snapshot = snapshotFixture()
		const pool = requiredPool(snapshot)
		pool.escalationFinalQuestionResolution = 1
		pool.escalationResolved = true
		pool.forkCarrySnapshotInitialized = true
		pool.questionOutcome = 1
		const candidate = carryCandidate(snapshot)
		snapshot.forkedCarryWithdrawals = [candidate]
		snapshot.forkedCarryWithdrawalPresence = [candidate]
		atVaultCapacity(pool, false)
		expect(plans(snapshot, 'statoblast.escalation.withdraw-forked')).toHaveLength(0)
		expect(presence(snapshot, 'statoblast.escalation.withdraw-forked')).toEqual([expect.objectContaining({ blocksNovelty: true })])

		pool.walletVaultRegistered = true
		expect(plans(snapshot, 'statoblast.escalation.withdraw-forked')).toHaveLength(1)
		candidate.depositor = address(99)
		candidate.proof.depositor = address(99)
		expect(plans(snapshot, 'statoblast.escalation.withdraw-forked')).toHaveLength(0)
		expect(presence(snapshot, 'statoblast.escalation.withdraw-forked')).toEqual([expect.objectContaining({ blocksNovelty: true })])
	})
})
