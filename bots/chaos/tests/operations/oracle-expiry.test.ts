import { describe, expect, test } from 'bun:test'
import { eligibleOperationPlans } from '../support/operation-plans.ts'
import { planningOptionsFixture, snapshotFixture } from './fixture.ts'

const planningOptions = planningOptionsFixture()

function plan(snapshot: ReturnType<typeof snapshotFixture>, definitionId: string) {
	return eligibleOperationPlans(snapshot, planningOptions).find(candidate => candidate.definitionId === definitionId)
}

function configureOpenQuestion(snapshot: ReturnType<typeof snapshotFixture>) {
	const question = snapshot.questions[0]
	if (question === undefined) throw new Error('Question fixture missing')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10_000n).toString()
	const pool = snapshot.pools[0]
	const vault = pool?.vaults[0]
	if (pool === undefined || vault === undefined) throw new Error('Missing underwriting vault')
	pool.totalUnderwritingLimitAttoEth = (2n * 10n ** 18n).toString()
	vault.underwritingLimitAttoEth = pool.totalUnderwritingLimitAttoEth
	pool.currentMintingCapacityAttoEth = pool.totalUnderwritingLimitAttoEth
}

const mintingDefinitionIds = ['statoblast.complete-set.create', 'trading.liquidity.add-eth', 'trading.position.enter']

function expectMintingPlansIgnoreOracleHorizon(snapshot: ReturnType<typeof snapshotFixture>) {
	const pool = snapshot.pools[0]
	const question = snapshot.questions[0]
	if (pool === undefined || question === undefined) throw new Error('Pool fixture missing')
	pool.escalationGame = '0x0000000000000000000000000000000000000000'
	const oracleExpiry = BigInt(pool.lastOracleSettlementTimestamp) + 300n
	const questionLastSecond = BigInt(question.endTime) - 1n
	for (const definitionId of mintingDefinitionIds) {
		const candidate = plan(snapshot, definitionId)
		expect(candidate, definitionId).toBeDefined()
		const deadline = candidate?.deadlineTimestamp
		if (definitionId === 'statoblast.complete-set.create') {
			expect(deadline, definitionId).toBeUndefined()
			continue
		}
		if (deadline === undefined) throw new Error(`${definitionId} must keep its question-end deadline`)
		expect(BigInt(deadline) > oracleExpiry, definitionId).toBe(true)
		expect(BigInt(deadline) <= questionLastSecond, definitionId).toBe(true)
	}
}

describe('oracle-price expiry planning', () => {
	test('binds every price-dependent plan to the exact five-minute oracle horizon', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		configureOpenQuestion(snapshot)
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 100n).toString()
		const expiry = (BigInt(pool.lastOracleSettlementTimestamp) + 300n).toString()

		expect(plan(snapshot, 'statoblast.escalation.deposit')?.deadlineTimestamp).toBe(expiry)

		pool.settlementCollateralAttoEth = '0'
		expect(plan(snapshot, 'statoblast.staged.queue')?.deadlineTimestamp).toBe(expiry)

		pool.totalUnderwritingLimitAttoEth = '0'
		expect(plan(snapshot, 'statoblast.escalation.deposit')?.deadlineTimestamp).toBeUndefined()
	})

	test('rejects price-dependent plans before building steps when the oracle horizon is too close', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		configureOpenQuestion(snapshot)
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 240n).toString()

		expect(plan(snapshot, 'statoblast.escalation.deposit')).toBeUndefined()

		pool.settlementCollateralAttoEth = '0'
		expect(plan(snapshot, 'statoblast.staged.queue')).toBeUndefined()

		pool.totalUnderwritingLimitAttoEth = '0'
		expect(plan(snapshot, 'statoblast.escalation.deposit')).toBeDefined()
	})

	test('does not bind complete-set minting or minting router plans to the oracle horizon', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		configureOpenQuestion(snapshot)
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 100n).toString()
		expectMintingPlansIgnoreOracleHorizon(snapshot)
	})

	test('keeps complete-set minting and minting router plans available when the oracle price is near expiry or invalid', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		configureOpenQuestion(snapshot)
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 240n).toString()
		expectMintingPlansIgnoreOracleHorizon(snapshot)

		pool.lastOracleSettlementTimestamp = '0'
		pool.oraclePriceValid = false
		expectMintingPlansIgnoreOracleHorizon(snapshot)
	})
})
