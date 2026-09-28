export type WalletVaultFundingState = {
	minimumVaultRepDepositAttoRep: bigint
	vaultRepBackingUnits: bigint
	totalRepBackingUnits: bigint
	totalPoolHeldRepAttoRep: bigint
}

const MAX_UINT256 = (1n << 256n) - 1n
const BACKING_UNIT_PRECISION = 10n ** 18n

// Mirrors vault admission and depositToEscalationGame's rounded escrow debit.
export function getWalletVaultFundingQuote(state: WalletVaultFundingState, reportAmount: bigint): { depositAmount: bigint; remainingVaultRepAttoRep: bigint } | undefined {
	const { minimumVaultRepDepositAttoRep: minimum, vaultRepBackingUnits: vaultUnits, totalRepBackingUnits: totalUnits, totalPoolHeldRepAttoRep: poolRep } = state
	if (reportAmount <= 0n || reportAmount > MAX_UINT256 || minimum < 0n || vaultUnits < 0n || totalUnits < vaultUnits || poolRep < 0n) return undefined
	const preview = (deposit: bigint): bigint | undefined => {
		const mintedUnits = totalUnits === 0n || poolRep === 0n ? deposit * BACKING_UNIT_PRECISION : (deposit * totalUnits) / poolRep
		const fundedTotalUnits = totalUnits + mintedUnits
		const fundedVaultUnits = vaultUnits + mintedUnits
		const fundedPoolRep = poolRep + deposit
		if (fundedTotalUnits === 0n || fundedTotalUnits > MAX_UINT256 || fundedPoolRep > MAX_UINT256) return undefined
		const fundedBacking = (fundedVaultUnits * fundedPoolRep) / fundedTotalUnits
		if (fundedBacking < minimum || fundedBacking < reportAmount) return undefined
		const escrowUnits = (reportAmount * fundedTotalUnits + fundedPoolRep - 1n) / fundedPoolRep
		if (escrowUnits > fundedVaultUnits) return undefined
		const remainingVaultUnits = fundedVaultUnits - escrowUnits
		if (remainingVaultUnits === 0n) return 0n
		const remainingBacking = (remainingVaultUnits * (fundedPoolRep - reportAmount)) / (fundedTotalUnits - escrowUnits)
		return remainingBacking
	}
	const findDeposit = (start: bigint, acceptsRemaining: (remaining: bigint) => boolean) => {
		const accepted = (amount: bigint) => {
			const remaining = preview(amount)
			return remaining !== undefined && acceptsRemaining(remaining)
		}
		if (accepted(start)) return start
		let lower = start
		let upper = start
		while (!accepted(upper)) {
			if (upper === MAX_UINT256) return undefined
			upper = upper > MAX_UINT256 / 2n ? MAX_UINT256 : upper * 2n
		}
		while (upper - lower > 1n) {
			const middle = lower + (upper - lower) / 2n
			if (accepted(middle)) upper = middle
			else lower = middle
		}
		return upper
	}
	// Check the smallest admissible deposit first: rounded escrow may empty it entirely.
	const admitted = findDeposit(reportAmount, () => true)
	if (admitted === undefined) return undefined
	const initialRemaining = preview(admitted)
	if (initialRemaining === 0n || (initialRemaining !== undefined && initialRemaining >= minimum)) return { depositAmount: admitted, remainingVaultRepAttoRep: initialRemaining }
	const deposit = findDeposit(admitted, remaining => remaining >= minimum)
	if (deposit === undefined) return undefined
	const remaining = preview(deposit)
	return remaining === undefined ? undefined : { depositAmount: deposit, remainingVaultRepAttoRep: remaining }
}
