import { describe, expect, test } from 'bun:test'
import { exitCommitmentLimit } from '../../src/operations/statoblast/vaults.ts'
import { canCreateCompleteSet } from '../../src/operations/pool-economics.ts'
import { completeSetDefinition } from '../../src/operations/statoblast/complete-sets.ts'
import { snapshotFixture } from './fixture.ts'

const options = { seed: 1, maximumBlockIntervalSeconds: 15 }

function fixture() {
	const snapshot = snapshotFixture()
	const pool = snapshot.pools[0]
	const vault = pool?.vaults[0]
	if (pool === undefined || vault === undefined) throw new Error('Missing pool fixture')
	pool.escalationGame = '0x0000000000000000000000000000000000000000'
	pool.settlementCollateralAttoEth = '1'
	pool.projectedSettlementCollateralAttoEth = '1'
	pool.totalUnderwritingLimitAttoEth = vault.underwritingLimitAttoEth
	pool.currentMintingCapacityAttoEth = '0'
	return { snapshot, pool, vault }
}

describe('standing commitment keeper planning', () => {
	test('minting follows live aggregate capacity without enumerating vaults', () => {
		const { pool } = fixture()
		expect(canCreateCompleteSet(pool, 1n)).toBe(false)
		pool.currentMintingCapacityAttoEth = pool.totalUnderwritingLimitAttoEth
		pool.vaults = []
		expect(canCreateCompleteSet(pool, 1n)).toBe(true)
		expect(canCreateCompleteSet(pool, BigInt(pool.currentMintingCapacityAttoEth))).toBe(false)
		pool.escalationGame = '0x0000000000000000000000000000000000000001'
		expect(canCreateCompleteSet(pool, 1n)).toBe(false)
	})

	test('permits an ordinary exit only after remaining commitments cover collateral', () => {
		const { snapshot, pool } = fixture()
		expect(exitCommitmentLimit.buildPlan(snapshot, options)).toBeUndefined()
		pool.settlementCollateralAttoEth = '0'
		expect(exitCommitmentLimit.buildPlan(snapshot, options)?.steps).toHaveLength(1)
	})

	test('permits finalized commitment release while leaving unresolved and inactive pools locked', () => {
		const { snapshot, pool } = fixture()
		pool.questionOutcome = 1
		expect(exitCommitmentLimit.buildPlan(snapshot, options)?.steps).toHaveLength(1)
		const universe = snapshot.universes[0]
		if (universe === undefined) throw new Error('Missing universe fixture')
		universe.forkTime = snapshot.anchor.timestamp
		expect(exitCommitmentLimit.buildPlan(snapshot, options)?.steps).toHaveLength(1)
		pool.questionOutcome = 3
		expect(exitCommitmentLimit.buildPlan(snapshot, options)).toBeUndefined()
		pool.questionOutcome = 1
		pool.systemState = 1
		expect(exitCommitmentLimit.buildPlan(snapshot, options)).toBeUndefined()
	})

	test('complete-set issuance closes at question maturity while complete-set redemption remains available', () => {
		const { snapshot, pool } = fixture()
		const question = snapshot.questions[0]
		if (question === undefined) throw new Error('Missing question fixture')
		pool.currentMintingCapacityAttoEth = pool.totalUnderwritingLimitAttoEth
		question.endTime = (BigInt(snapshot.anchor.timestamp) + 1_000n).toString()
		const mint = completeSetDefinition('create')
		expect(mint.buildPlan(snapshot, options)?.deadlineTimestamp).toBe((BigInt(question.endTime) - 1n).toString())
		question.endTime = (BigInt(snapshot.anchor.timestamp) + 1n).toString()
		expect(mint.buildPlan(snapshot, options)).toBeUndefined()
		question.endTime = snapshot.anchor.timestamp
		expect(mint.buildPlan(snapshot, options)).toBeUndefined()
		expect(mint.evaluate(snapshot, options).eligible).toBe(false)
		pool.projectedSettlementCollateralAttoEth = pool.shareTokenSupplyAttoShares
		expect(completeSetDefinition('redeem').buildPlan(snapshot, options)?.steps).toHaveLength(1)
	})
})
