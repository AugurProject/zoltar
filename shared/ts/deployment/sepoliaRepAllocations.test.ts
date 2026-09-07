import { describe, expect, test } from 'bun:test'
import { getAddress, parseUnits } from './ethereum.js'
import { SEPOLIA_REP_ALLOCATIONS, SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY } from './sepoliaRepAllocations.js'

describe('Sepolia REP allocations', () => {
	test('divides the 11 million REP mint cap equally among configured holders', () => {
		expect(SEPOLIA_REP_ALLOCATIONS.map(allocation => allocation.address)).toEqual([
			getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
			getAddress('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'),
			getAddress('0xC6cCd3c2d63bc8De8fcF43EdE80D135666b7aceE'),
			getAddress('0x3b91b3192c44f7AbD0AfF5Cb81776348E64B65Dd'),
			getAddress('0xcfCE1cA6166f0089a66A141A794f775d2Ea83817'),
		])
		for (const allocation of SEPOLIA_REP_ALLOCATIONS) expect(allocation.amount).toBe(parseUnits('2200000', 18))
		expect(SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY).toBe(parseUnits('11000000', 18))
		expect(Object.isFrozen(SEPOLIA_REP_ALLOCATIONS)).toBe(true)
		for (const allocation of SEPOLIA_REP_ALLOCATIONS) expect(Object.isFrozen(allocation)).toBe(true)
	})
})
