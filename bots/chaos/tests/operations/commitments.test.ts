import { describe, expect, test } from 'bun:test'
import { exitCommitmentLimit } from '../../src/operations/statoblast/vaults.ts'
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
})
