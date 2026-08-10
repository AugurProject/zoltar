import { getAddress, parseUnits, type Address } from './ethereum.js'

export type SepoliaRepAllocation = {
	readonly address: Address
	readonly amount: bigint
}

// This list is intentionally isolated so the complete Sepolia genesis holder
// set and every minted amount remain auditable in one file.
const SEPOLIA_REP_HOLDERS = [
	// vitalik.eth
	getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
	// private key 0x1
	getAddress('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'),
	// dev
	getAddress('0xC6cCd3c2d63bc8De8fcF43EdE80D135666b7aceE'),
	// rabby 1
	getAddress('0x3b91b3192c44f7AbD0AfF5Cb81776348E64B65Dd'),
	// rabby 2
	getAddress('0xcfCE1cA6166f0089a66A141A794f775d2Ea83817'),
] as const

const SEPOLIA_REP_MINT_CAP = parseUnits('11000000', 18)
const SEPOLIA_REP_AMOUNT_PER_HOLDER = SEPOLIA_REP_MINT_CAP / BigInt(SEPOLIA_REP_HOLDERS.length)

export const SEPOLIA_REP_ALLOCATIONS = Object.freeze(
	SEPOLIA_REP_HOLDERS.map(address =>
		Object.freeze({
			address,
			amount: SEPOLIA_REP_AMOUNT_PER_HOLDER,
		}),
	),
) satisfies readonly SepoliaRepAllocation[]

export const SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY = SEPOLIA_REP_ALLOCATIONS.reduce((total, allocation) => total + allocation.amount, 0n)
