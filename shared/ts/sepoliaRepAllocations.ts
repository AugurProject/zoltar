import { getAddress, parseUnits, type Address } from './ethereum.js'

export type SepoliaRepAllocation = {
	address: Address
	amount: bigint
}

// Replace or extend this list before the public Sepolia deployment. These
// deterministic QA addresses are intentionally isolated here so the complete
// genesis holder set and every minted amount remain auditable in one file.
export const SEPOLIA_REP_ALLOCATIONS = [
	{
		address: getAddress('0x00000000000000000000000000000000000000a1'),
		amount: parseUnits('10000000', 18),
	},
	{
		address: getAddress('0x00000000000000000000000000000000000000b2'),
		amount: parseUnits('10000000', 18),
	},
	{
		address: getAddress('0x00000000000000000000000000000000000000c3'),
		amount: parseUnits('10000000', 18),
	},
] as const satisfies readonly SepoliaRepAllocation[]

export const SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY = SEPOLIA_REP_ALLOCATIONS.reduce((total, allocation) => total + allocation.amount, 0n)
