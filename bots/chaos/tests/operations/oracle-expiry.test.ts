import { describe, expect, test } from 'bun:test'
import { eligibleOperationPlans } from '../../src/operations/catalog.ts'
import { snapshotFixture } from './fixture.ts'

const planningOptions = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maximumBlockIntervalSeconds: 15,
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: (10n ** 16n).toString(),
	minimumRepReserveAttoRep: (10n ** 18n).toString(),
	seed: 0x1234_5678,
} as const

function plan(snapshot: ReturnType<typeof snapshotFixture>, definitionId: string) {
	return eligibleOperationPlans(snapshot, planningOptions).find(candidate => candidate.definitionId === definitionId)
}

function configureOpenQuestion(snapshot: ReturnType<typeof snapshotFixture>) {
	const question = snapshot.questions[0]
	if (question === undefined) throw new Error('Question fixture missing')
	question.endTime = (BigInt(snapshot.anchor.timestamp) + 10_000n).toString()
}

describe('oracle-price expiry planning', () => {
	test('binds every price-dependent plan to the exact five-minute oracle horizon', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		configureOpenQuestion(snapshot)
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 100n).toString()
		const expiry = (BigInt(pool.lastOracleSettlementTimestamp) + 300n).toString()

		for (const definitionId of ['statoblast.complete-set.create', 'statoblast.escalation.deposit', 'trading.liquidity.add-eth', 'trading.position.enter']) {
			expect(plan(snapshot, definitionId)?.deadlineTimestamp, definitionId).toBe(expiry)
		}

		pool.settlementCollateralAttoEth = '0'
		expect(plan(snapshot, 'statoblast.staged.queue')?.deadlineTimestamp).toBe(expiry)

		pool.totalCapacityOwnershipAttoRep = '0'
		expect(plan(snapshot, 'statoblast.escalation.deposit')?.deadlineTimestamp).toBeUndefined()
	})

	test('rejects price-dependent plans before building steps when the oracle horizon is too close', () => {
		const snapshot = snapshotFixture()
		const pool = snapshot.pools[0]
		if (pool === undefined) throw new Error('Pool fixture missing')
		configureOpenQuestion(snapshot)
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 240n).toString()

		for (const definitionId of ['statoblast.complete-set.create', 'statoblast.escalation.deposit', 'trading.liquidity.add-eth', 'trading.position.enter']) {
			expect(plan(snapshot, definitionId), definitionId).toBeUndefined()
		}

		pool.settlementCollateralAttoEth = '0'
		expect(plan(snapshot, 'statoblast.staged.queue')).toBeUndefined()

		pool.totalCapacityOwnershipAttoRep = '0'
		expect(plan(snapshot, 'statoblast.escalation.deposit')).toBeDefined()
	})
})
