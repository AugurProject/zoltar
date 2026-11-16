import { auctionFixture, readyChildFixture } from '../support/portfolio-fixtures.ts'
import { describe, expect, test } from 'bun:test'
import { canonicalLifecyclePresence, reevaluateOperationContinuation } from '../../src/operations/catalog.ts'
import { classifiedMethod } from '../support/canonical-contracts.ts'
import { eligibleOperationPlans, urgentOperationPlans } from '../support/operation-plans.ts'
import { address, hash, pendingPoolReportFixture, snapshotFixture } from './fixture.ts'

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
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: 0n.toString(),
	minimumRepReserveAttoRep: 0n.toString(),
	seed: 0x1234_5678,
} as const

describe('raw lifecycle identity audit', () => {
	test('keeps auction refund withdrawals seed-independent within one authenticated generation', () => {
		const snapshot = snapshotFixture()
		const refundGeneration = hash(400)
		const auction = { ...auctionFixture(), address: address(40), pendingEthRefund: '123', pendingEthRefundGeneration: refundGeneration }
		snapshot.auctions = [auction]
		const metadata = (seed: number) => urgentOperationPlans(snapshot, { ...options, seed }).find(plan => plan.definitionId === 'statoblast.auction.withdraw-refund')?.metadata
		expect(metadata(1)).toEqual({ auction: address(40), refundGeneration })
		expect(metadata(0xffff_fffe)).toEqual(metadata(1))
		expect(canonicalLifecyclePresence(snapshot, { ...options, allowHighRisk: false })).toContainEqual({
			blocksNovelty: true,
			definitionId: 'statoblast.auction.withdraw-refund',
			ecosystem: 'statoblast',
			metadata: { auction: address(40), refundGeneration },
		})
		auction.pendingEthRefund = '456'
		expect(metadata(1)).toEqual({ auction: address(40), refundGeneration })
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({ blocksNovelty: true, definitionId: 'statoblast.auction.withdraw-refund', ecosystem: 'statoblast', metadata: { auction: address(40), refundGeneration } })
		auction.pendingEthRefundGeneration = hash(401)
		expect(metadata(1)).toEqual({ auction: address(40), refundGeneration: hash(401) })
	})

	test('keeps reporter resumption present independently of funding', () => {
		const resume = snapshotFixture()
		const resumePool = resume.pools[0]
		if (resumePool === undefined) throw new Error('Resume pool missing')
		resumePool.awaitingForkContinuation = true
		resumePool.escalationForkCarryFundingComplete = false
		resumePool.escalationForkResumedAt = '0'
		expect(urgentOperationPlans(resume, options).find(plan => plan.definitionId === 'statoblast.escalation.resume')).toBeUndefined()
		expect(canonicalLifecyclePresence(resume, options)).toContainEqual({ blocksNovelty: false, definitionId: 'statoblast.escalation.resume', ecosystem: 'statoblast', metadata: { pool: resumePool.address } })
		resumePool.escalationForkCarryFundingComplete = true
		expect(urgentOperationPlans(resume, options).find(plan => plan.definitionId === 'statoblast.escalation.resume')).toBeDefined()
		expect(canonicalLifecyclePresence(resume, options).find(item => item.definitionId === 'statoblast.escalation.resume')).toMatchObject({ blocksNovelty: true })
	})

	test('keeps OpenOracle disputes selectable and out of raw lifecycle presence', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Oracle pool missing')
		pool.pendingReportId = '42'
		snapshot.reports = [pendingPoolReportFixture(snapshot, pool, { currentAmount1: '0', currentReporter: snapshot.wallet.address })]
		for (const token of snapshot.wallet.tokens) {
			token.balance = '0'
			token.allowances = {}
		}
		const restrictive = { ...options, allowHighRisk: false, maxEthSpendAttoEth: 0n.toString(), maxRepSpendAttoRep: 0n.toString() }
		expect(urgentOperationPlans(snapshot, restrictive).find(plan => plan.definitionId === 'open-oracle.dispute')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, restrictive).some(presence => presence.definitionId === 'open-oracle.dispute')).toBe(false)
		expect(classifiedMethod('OpenOracle', 'dispute')).toMatchObject({ classification: 'selectable', operationId: 'open-oracle.dispute' })

		const indexed = snapshot.reports[0]
		if (indexed === undefined) throw new Error('Oracle report missing')
		indexed.currentAmount1 = '1000'
		for (const token of snapshot.wallet.tokens) token.balance = '1000000000000000000'
		const plan = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'open-oracle.dispute')
		expect(plan).toMatchObject({ classification: 'selectable', obligation: false, priority: 'random' })
		expect(urgentOperationPlans(snapshot, options).some(candidate => candidate.definitionId === 'open-oracle.dispute')).toBe(false)
		expect(canonicalLifecyclePresence(snapshot, options).some(presence => presence.definitionId === 'open-oracle.dispute')).toBe(false)
	})

	test('treats repeatable residual sweeping as simulation-gated selectable work without tombstones', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Residual pool missing')
		pool.escalationRepBalanceAttoRep = '777'
		pool.escalationResidualSweepExpectedSuccess = false
		expect(eligibleOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.escalation.sweep-residual')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options).find(item => item.definitionId === 'statoblast.escalation.sweep-residual')).toBeUndefined()
		pool.escalationResidualSweepExpectedSuccess = true
		const plan = eligibleOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.escalation.sweep-residual')
		expect(plan?.metadata).toEqual({ balanceBefore: '777', escalationGame: pool.escalationGame, pool: pool.address })
		expect(plan?.classification).toBe('selectable')
		expect(plan?.obligation).toBe(false)
		expect(classifiedMethod('EscalationGame', 'sweepResidualRepToSecurityPool')).toMatchObject({ classification: 'selectable', operationId: 'statoblast.escalation.sweep-residual' })
	})
})

test('native question preparation retains its identity while shared branch readiness temporarily blocks execution', () => {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const universe = snapshot.universes[0]
	if (!pool || !universe) throw new Error('Missing question')
	pool.systemState = 1
	universe.forkTime = '1999999000'
	universe.forkQuestionId = pool.questionId
	const preparation = { ...readyChildFixture(pool.address, pool.portfolio), childPool: address(0), historyReady: false }
	pool.childPoolPreparations['0'] = preparation
	const first = urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.fork.create-child')
	if (!first) throw new Error('Missing preparation')
	preparation.branchReady = false
	expect(urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === first.definitionId)).toBeUndefined()
	expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({ blocksNovelty: false, definitionId: first.definitionId, ecosystem: 'statoblast', metadata: first.metadata })
	preparation.branchReady = true
	expect(reevaluateOperationContinuation(snapshot, first, options).plan?.id).toBe(first.id)
})

test('pending native child history retains raw presence while branch activation is unavailable', () => {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	if (!pool) throw new Error('Missing question')
	const preparation = { ...readyChildFixture(pool.address, pool.portfolio), historyReady: false }
	pool.childPoolPreparations['0'] = preparation
	const first = urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.child.initialize-history')
	if (!first) throw new Error('Missing history')
	preparation.branchReady = false
	expect(urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === first.definitionId)).toBeUndefined()
	expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({ blocksNovelty: false, definitionId: first.definitionId, ecosystem: 'statoblast', metadata: first.metadata })
})
