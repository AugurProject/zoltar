import type { Address } from '@zoltar/core-shared/evm/ethereum'

export const MAX_VAULT_PRICE_ACTIONS = 4
export type VaultOperationsInput = {
	depositAttoRep: bigint
	changeCommitment: boolean
	commitmentAttoEth: bigint
	liquidations: { targetVault: Address; requestedDebtAttoEth: bigint }[]
	withdrawAttoRep: bigint
	minimumReceiverHealthFactorBps: bigint
	validForSeconds: bigint
}

export function countVaultPriceActions(input: VaultOperationsInput) {
	return input.liquidations.length + Number(input.changeCommitment) + Number(input.withdrawAttoRep > 0n)
}

export function validateVaultOperations(input: VaultOperationsInput, owner: Address) {
	if (input.depositAttoRep < 0n || input.withdrawAttoRep < 0n || input.commitmentAttoEth < 0n) throw new Error('Amounts cannot be negative.')
	const count = countVaultPriceActions(input)
	if (count > MAX_VAULT_PRICE_ACTIONS) throw new Error('Choose at most four commitment, liquidation, or withdrawal actions.')
	if (count === 0 && input.depositAttoRep === 0n) throw new Error('Choose a vault action.')
	if (input.validForSeconds <= 0n || input.validForSeconds > 300n) throw new Error('Execution window must be between one second and five minutes.')
	if (input.liquidations.length > 0 && input.minimumReceiverHealthFactorBps < 10_000n) throw new Error('Receiver health factor must be at least one.')
	const targets = new Set<string>()
	for (const liquidation of input.liquidations) {
		const target = liquidation.targetVault.toLowerCase()
		if (target === owner.toLowerCase() || /^0x0{40}$/.test(target)) throw new Error('Choose another vault to liquidate.')
		if (targets.has(target)) throw new Error('A liquidation target can only appear once.')
		if (liquidation.requestedDebtAttoEth <= 0n) throw new Error('Liquidation commitments must be positive.')
		targets.add(target)
	}
}
