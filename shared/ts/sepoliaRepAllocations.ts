import { getAddress, parseUnits, type Address } from './ethereum.js'

export type SepoliaRepAllocation = {
	address: Address
	amount: bigint
}

// This list is intentionally isolated so the complete Sepolia genesis holder
// set and every minted amount remain auditable in one file.
export const SEPOLIA_REP_ALLOCATIONS = [
	{
		// vitalik.eth
		address: getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
		amount: parseUnits('10000000', 18),
	},
	{
		// private key 0x1
		address: getAddress('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'),
		amount: parseUnits('10000000', 18),
	},
	{
		// dev
		address: getAddress('0xC6cCd3c2d63bc8De8fcF43EdE80D135666b7aceE'),
		amount: parseUnits('10000000', 18),
	},
] as const satisfies readonly SepoliaRepAllocation[]

export const SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY = SEPOLIA_REP_ALLOCATIONS.reduce((total, allocation) => total + allocation.amount, 0n)
