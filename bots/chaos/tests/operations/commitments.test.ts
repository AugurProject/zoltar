import { describe, expect, test } from 'bun:test'
import { certifyCommitment, exitCommitmentLimit } from '../../src/operations/statoblast/vaults.ts'
import { canCreateCompleteSet } from '../../src/operations/pool-economics.ts'
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
	vault.coverageCertified = false
	return { snapshot, pool, vault }
}

describe('standing commitment keeper planning', () => {
	test('certifies one vault independently and requires the aggregate certificate before minting', () => {
		const { snapshot, pool, vault } = fixture()
		const plan = certifyCommitment.buildPlan(snapshot, options)
		expect(plan?.steps).toHaveLength(1)
		expect(plan?.deadlineTimestamp).toBe((BigInt(pool.lastOracleSettlementTimestamp) + 300n).toString())
		expect(canCreateCompleteSet(pool, 1n)).toBe(false)
		pool.currentMintingCapacityAttoEth = pool.totalUnderwritingLimitAttoEth
		vault.coverageCertified = true
		expect(canCreateCompleteSet(pool, 1n)).toBe(true)
		expect(certifyCommitment.buildPlan(snapshot, options)).toBeUndefined()
	})

	test('stale or absent certificate state cannot authorize keeper plans or minting', () => {
		const { snapshot, pool, vault } = fixture()
		delete vault.coverageCertified
		expect(certifyCommitment.buildPlan(snapshot, options)).toBeUndefined()
		vault.coverageCertified = false
		pool.lastOracleSettlementTimestamp = (BigInt(snapshot.anchor.timestamp) - 299n).toString()
		expect(certifyCommitment.buildPlan(snapshot, options)).toBeUndefined()
		expect(canCreateCompleteSet(pool, 1n)).toBe(false)
	})

	test('permits an ordinary exit only after remaining commitments cover collateral', () => {
		const { snapshot, pool } = fixture()
		expect(exitCommitmentLimit.buildPlan(snapshot, options)).toBeUndefined()
		pool.settlementCollateralAttoEth = '0'
		expect(exitCommitmentLimit.buildPlan(snapshot, options)?.steps).toHaveLength(1)
	})
})
