import { describe, expect, test } from 'bun:test'
import { decodeFunctionData } from '../support/bot-shared.ts'
import { securityPoolForkerAbi } from '../../src/contracts/abi.ts'
import { canonicalLifecyclePresence, classifiedMethod, eligibleOperationPlans, reevaluateOperationContinuation, urgentOperationPlans } from '../../src/operations/catalog.ts'
import { address, hash, snapshotFixture } from './fixture.ts'

const MIGRATION_TIME_SECONDS = 8n * 7n * 24n * 60n * 60n
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

const continuationOptions = {
	allowHighRisk: options.allowHighRisk,
	allowIrreversibleOperations: options.allowIrreversibleOperations,
	immutableTopologyCapacity: options.immutableTopologyCapacity,
	maximumBlockIntervalSeconds: options.maximumBlockIntervalSeconds,
	maxEthSpendAttoEth: options.maxEthSpendAttoEth,
	maxRepSpendAttoRep: options.maxRepSpendAttoRep,
	minimumEthReserveAttoEth: options.minimumEthReserveAttoEth,
	minimumRepReserveAttoRep: options.minimumRepReserveAttoRep,
}

function forkedSnapshot() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const universe = snapshot.universes[0]
	const question = snapshot.questions[0]
	const vault = pool?.vaults[0]
	if (pool === undefined || universe === undefined || question === undefined || vault === undefined) throw new Error('Fork fixture is incomplete')
	pool.systemState = 1
	pool.forkActivationTime = '1999999000'
	pool.forkRepMigrationTargetAttoRep = '1000000000000000000'
	pool.forkRepMigrationProgressByOutcome = { '0': pool.forkRepMigrationTargetAttoRep, '1': pool.forkRepMigrationTargetAttoRep, '2': pool.forkRepMigrationTargetAttoRep }
	universe.forkTime = pool.forkActivationTime
	universe.forkQuestionId = question.id
	return { pool, snapshot, universe, vault }
}

describe('raw lifecycle identity audit', () => {
	test('keeps auction refund withdrawals seed-independent within one authenticated generation', () => {
		const snapshot = snapshotFixture()
		const refundGeneration = hash(400)
		const auction = {
			address: address(40),
			bids: [],
			clearingTick: '0',
			endTime: '1',
			finalized: false,
			hasClearingPrice: false,
			minimumBidAttoEth: 1n.toString(),
			pendingEthRefund: '123',
			pendingEthRefundGeneration: refundGeneration,
			pool: snapshot.pools[0]?.address ?? address(11),
			startTime: '1',
			underfunded: false,
			underfundedWinningAttoEth: 0n.toString(),
		}
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

	test('builds one pool-level vault migration with exact route and terminal source-vault evidence', () => {
		const { pool, snapshot, vault } = forkedSnapshot()
		const plans = urgentOperationPlans(snapshot, options).filter(plan => plan.definitionId === 'statoblast.fork.migrate-vault')
		expect(plans).toHaveLength(1)
		const plan = plans[0]
		if (plan === undefined) throw new Error('Vault migration plan missing')
		expect(plan.metadata).toEqual({ pool: pool.address })
		const step = plan.steps[0]
		if (step === undefined) throw new Error('Vault migration step missing')
		const decoded = decodeFunctionData({ abi: securityPoolForkerAbi, data: step.data })
		expect(decoded.functionName).toBe('migrateVault')
		const outcome = String(decoded.args?.[1])
		expect(step.evidence.find(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'outcomeIndex')).toMatchObject({ equals: outcome, indexed: { parentPool: pool.address, vault: snapshot.wallet.address } })
		expect(step.evidence.find(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'resultingParentRepBackingUnits')).toMatchObject({ equals: '0', indexed: { parentPool: pool.address, vault: snapshot.wallet.address } })
		expect(step.evidence.some(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'migratedRepDeltaAttoRep')).toBe(false)
		expect(reevaluateOperationContinuation(snapshot, plan, continuationOptions).plan?.steps[0]?.data).toBe(step.data)

		const selectedOutcomes = new Set<string>()
		for (let seed = 0; seed < 32; seed++) {
			const selected = urgentOperationPlans(snapshot, { ...options, seed }).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')
			const selectedStep = selected?.steps[0]
			if (selectedStep === undefined) throw new Error('Seeded vault migration route missing')
			const outcome = decodeFunctionData({ abi: securityPoolForkerAbi, data: selectedStep.data }).args?.[1]
			selectedOutcomes.add(String(outcome))
		}
		expect(selectedOutcomes.size).toBeGreaterThan(1)

		pool.vaultDiscoveryComplete = false
		expect(urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')).toBeDefined()
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({ blocksNovelty: true, definitionId: 'statoblast.fork.migrate-vault', ecosystem: 'statoblast', metadata: { pool: pool.address } })
		vault.repBackingUnits = '0'
		expect(urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')).toBeUndefined()
	})

	test('keeps split-child migrations executable when the exact rounded REP delta is unreconstructable', () => {
		const { pool, snapshot, vault } = forkedSnapshot()
		pool.totalRepBackingUnits = '3'
		pool.forkRepMigrationTargetAttoRep = '9'
		pool.forkRepMigrationProgressByOutcome = { '0': '9', '1': '9', '2': '9' }
		vault.repBackingUnits = '1'
		pool.vaults.push({ ...vault, address: address(72), repBackingAttoRep: 0n.toString(), repBackingUnits: '0' }, { ...vault, address: address(73), repBackingAttoRep: 0n.toString(), repBackingUnits: '0' })
		for (const [outcome, migratedAttoRep] of ['3', '3', '0'].entries()) {
			const child = structuredClone(pool)
			child.address = address(80 + outcome)
			child.parent = pool.address
			child.forkOutcomeIndex = outcome.toString()
			child.forkMigratedAttoRep = migratedAttoRep
			child.systemState = 2
			child.vaults = []
			snapshot.pools.push(child)
		}

		const selectedOutcomes = new Set<string>()
		for (let seed = 0; seed < 64; seed++) {
			const plan = urgentOperationPlans(snapshot, { ...options, seed }).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')
			const step = plan?.steps[0]
			if (step === undefined) throw new Error('Split-child vault migration route missing')
			const decoded = decodeFunctionData({ abi: securityPoolForkerAbi, data: step.data })
			const outcome = String(decoded.args?.[1])
			selectedOutcomes.add(outcome)
			const child = snapshot.pools.find(candidate => candidate.parent.toLowerCase() === pool.address.toLowerCase() && candidate.forkOutcomeIndex === outcome)
			if (child === undefined) throw new Error('Selected split-child route missing')
			expect(step.evidence.find(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'outcomeIndex')).toMatchObject({ equals: outcome, indexed: { childPool: child.address, parentPool: pool.address, vault: snapshot.wallet.address } })
			expect(step.evidence.find(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'resultingParentRepBackingUnits')).toMatchObject({ equals: '0', indexed: { childPool: child.address, parentPool: pool.address, vault: snapshot.wallet.address } })
			expect(step.evidence.some(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'migratedRepDeltaAttoRep')).toBe(false)
		}
		expect(selectedOutcomes).toEqual(new Set(['0', '1', '2']))
	})

	test('requires an open child route and pins its address only when already known', () => {
		const { pool, snapshot } = forkedSnapshot()
		for (const outcome of [0, 1, 2]) {
			const child = structuredClone(pool)
			child.address = address(90 + outcome)
			child.parent = pool.address
			child.forkOutcomeIndex = outcome.toString()
			child.systemState = outcome === 0 ? 2 : 0
			child.vaults = []
			snapshot.pools.push(child)
		}

		const knownStep = urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')?.steps[0]
		if (knownStep === undefined) throw new Error('Known open child migration route missing')
		expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: knownStep.data }).args?.[1]).toBe(0n)
		expect(knownStep.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'resultingParentRepBackingUnits', indexed: { childPool: address(90), parentPool: pool.address, vault: snapshot.wallet.address } })]))

		const knownChild = snapshot.pools[1]
		if (knownChild === undefined) throw new Error('Known open child missing')
		knownChild.systemState = 0
		expect(urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({ blocksNovelty: false, definitionId: 'statoblast.fork.migrate-vault', ecosystem: 'statoblast', metadata: { pool: pool.address } })

		snapshot.pools.splice(1, 1)
		const createdStep = urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')?.steps[0]
		if (createdStep === undefined) throw new Error('Internally-created child migration route missing')
		expect(decodeFunctionData({ abi: securityPoolForkerAbi, data: createdStep.data }).args?.[1]).toBe(0n)
		const terminalEvidence = createdStep.evidence.find(evidence => evidence.kind === 'decoded-event-field' && evidence.field === 'resultingParentRepBackingUnits')
		if (terminalEvidence?.kind !== 'decoded-event-field') throw new Error('Created-child terminal evidence missing')
		expect(terminalEvidence.indexed).toEqual({ parentPool: pool.address, vault: snapshot.wallet.address })

		const deadline = BigInt(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		snapshot.anchor.timestamp = (deadline - 61n).toString()
		expect(urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')).toBeDefined()
		snapshot.anchor.timestamp = (deadline - 60n).toString()
		expect(urgentOperationPlans(snapshot, options).find(candidate => candidate.definitionId === 'statoblast.fork.migrate-vault')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({ blocksNovelty: false, definitionId: 'statoblast.fork.migrate-vault', ecosystem: 'statoblast', metadata: { pool: pool.address } })
	})

	test('retains migrate-REP and create-child identities through non-actionable child/deadline margins', () => {
		const { pool, snapshot } = forkedSnapshot()
		pool.forkRepMigrationProgressByOutcome = { '0': '1', '1': pool.forkRepMigrationTargetAttoRep, '2': pool.forkRepMigrationTargetAttoRep }
		const closedChild = structuredClone(pool)
		closedChild.address = address(71)
		closedChild.parent = pool.address
		closedChild.forkOutcomeIndex = '0'
		closedChild.systemState = 0
		snapshot.pools.push(closedChild)
		expect(urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.fork.migrate-rep')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options)).toContainEqual({
			blocksNovelty: false,
			definitionId: 'statoblast.fork.migrate-rep',
			ecosystem: 'statoblast',
			metadata: { outcome: '0', pool: pool.address, targetAttoRep: pool.forkRepMigrationTargetAttoRep },
		})

		snapshot.pools.pop()
		pool.forkRepMigrationTargetAttoRep = '0'
		const deadline = BigInt(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		snapshot.anchor.timestamp = (deadline - 60n).toString()
		expect(urgentOperationPlans(snapshot, options).some(plan => plan.definitionId === 'statoblast.fork.create-child')).toBe(false)
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.fork.create-child')).toEqual(expect.arrayContaining([expect.objectContaining({ blocksNovelty: false }), expect.objectContaining({ blocksNovelty: false }), expect.objectContaining({ blocksNovelty: false })]))
		snapshot.anchor.timestamp = deadline.toString()
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.fork.create-child')).toHaveLength(3)
		snapshot.anchor.timestamp = (deadline + 1n).toString()
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.fork.create-child')).toHaveLength(0)
	})

	test('keeps resume, fork claims, and unresolved migration present independently of funding, simulation, and mining margin', () => {
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

		const { pool, snapshot } = forkedSnapshot()
		pool.forkOwnQuestion = true
		pool.forkUnresolvedEscalation = true
		pool.escalationCanTriggerOwnFork = true
		snapshot.escalationDeposits = [{ amountAttoRep: 100n.toString(), claimed: false, depositIndex: '7', escalationGame: pool.escalationGame, outcome: 1, parentDepositIndex: '7', pool: pool.address, vault: snapshot.wallet.address }]
		const deadline = BigInt(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		expect(canonicalLifecyclePresence(snapshot, options).find(item => item.definitionId === 'statoblast.escalation.claim-forked')).toMatchObject({ blocksNovelty: true })
		snapshot.anchor.timestamp = (deadline - 60n).toString()
		expect(urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.escalation.claim-forked')).toBeUndefined()
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.escalation.claim-forked')).toEqual([expect.objectContaining({ blocksNovelty: false })])

		pool.unresolvedEscalationMigrationReadyOutcomes = []
		pool.walletEscalationMaterializedOutcomes = [false, false, false]
		expect(urgentOperationPlans(snapshot, options).find(plan => plan.definitionId === 'statoblast.fork.migrate-vault-unresolved')).toBeUndefined()
		expect(
			canonicalLifecyclePresence(snapshot, options)
				.filter(item => item.definitionId === 'statoblast.fork.migrate-vault-unresolved')
				.every(item => !item.blocksNovelty),
		).toBeTrue()
		pool.walletEscalationMaterializedOutcomes[1] = true
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.fork.migrate-vault-unresolved')).toHaveLength(2)

		snapshot.anchor.timestamp = deadline.toString()
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.escalation.claim-forked')).toHaveLength(1)
		snapshot.anchor.timestamp = (deadline + 1n).toString()
		expect(canonicalLifecyclePresence(snapshot, options).filter(item => item.definitionId === 'statoblast.escalation.claim-forked' || item.definitionId === 'statoblast.fork.migrate-vault-unresolved')).toHaveLength(0)
	})

	test('keeps OpenOracle disputes selectable and out of raw lifecycle presence', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Oracle pool missing')
		pool.pendingReportId = '42'
		snapshot.reports = [
			{
				currentAmount1: '0',
				currentAmount2: '1000',
				currentReporter: snapshot.wallet.address,
				disputeDelay: '60',
				escalationHalt: '100000',
				flags: 7,
				game: { callbackContract: pool.coordinator, callbackGasLimit: 500000, feePercentage: 0, lastReportOppoTime: '1', numReports: 1, protocolFee: 0, protocolFeeRecipient: address(30), settlerReward: '0' },
				helper: { blockNumber: '99', blockTimestamp: '1999999500', creator: pool.coordinator },
				multiplier: 140,
				openOracle: snapshot.deployments.openOracle,
				reportId: '42',
				reportTimestamp: '1999999500',
				settlementTime: '4000',
				settlementTimestamp: '0',
				stateHash: hash(42),
				token1: snapshot.deployments.weth,
				token2: pool.repToken,
			},
		]
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

	test('uses immutable singleton losing-bid identities across moving clearing prices', () => {
		const snapshot = snapshotFixture()
		const auction = {
			address: address(40),
			bids: [
				{ amountAttoEth: 100n.toString(), index: '0', refunded: false, tick: '0' },
				{ amountAttoEth: 100n.toString(), index: '1', refunded: false, tick: '10' },
			],
			clearingTick: '5',
			endTime: '2000001000',
			finalized: false,
			hasClearingPrice: true,
			minimumBidAttoEth: 1n.toString(),
			pendingEthRefund: '0',
			pool: snapshot.pools[0]?.address ?? address(11),
			startTime: '1999999000',
			underfunded: false,
			underfundedWinningAttoEth: 0n.toString(),
		}
		snapshot.auctions = [auction]
		const presences = () =>
			canonicalLifecyclePresence(snapshot, options)
				.filter(item => item.definitionId === 'statoblast.auction.refund')
				.map(item => ({ blocksNovelty: item.blocksNovelty, metadata: item.metadata }))
		expect(presences()).toEqual([
			{ blocksNovelty: true, metadata: { auction: auction.address, bidIndex: '0', tick: '0' } },
			{ blocksNovelty: false, metadata: { auction: auction.address, bidIndex: '1', tick: '10' } },
		])
		expect(
			urgentOperationPlans(snapshot, options)
				.filter(plan => plan.definitionId === 'statoblast.auction.refund')
				.map(plan => plan.metadata),
		).toEqual([{ auction: auction.address, bidIndex: '0', tick: '0' }])
		auction.hasClearingPrice = false
		expect(urgentOperationPlans(snapshot, options).filter(plan => plan.definitionId === 'statoblast.auction.refund')).toHaveLength(0)
		expect(presences().map(item => item.blocksNovelty)).toEqual([false, false])
		auction.hasClearingPrice = true
		auction.clearingTick = '20'
		expect(
			urgentOperationPlans(snapshot, options)
				.filter(plan => plan.definitionId === 'statoblast.auction.refund')
				.map(plan => plan.metadata),
		).toEqual(presences().map(item => item.metadata))
		expect(presences().map(item => item.blocksNovelty)).toEqual([true, true])
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
