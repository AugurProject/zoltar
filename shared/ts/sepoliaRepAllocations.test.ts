import { describe, expect, test } from 'bun:test'
import { getAddress, parseUnits } from './ethereum.js'
import { SEPOLIA_REP_ALLOCATIONS, SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY } from './sepoliaRepAllocations.js'

describe('Sepolia REP allocations', () => {
	test('mints 3 million REP to each configured starting holder', () => {
		expect(SEPOLIA_REP_ALLOCATIONS).toEqual([
			{
				address: getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
				amount: parseUnits('3000000', 18),
			},
			{
				address: getAddress('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'),
				amount: parseUnits('3000000', 18),
			},
			{
				address: getAddress('0xC6cCd3c2d63bc8De8fcF43EdE80D135666b7aceE'),
				amount: parseUnits('3000000', 18),
			},
		])
		expect(SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY).toBe(parseUnits('9000000', 18))
	})
})
