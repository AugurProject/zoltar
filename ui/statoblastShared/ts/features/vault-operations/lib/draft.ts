import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { parseEthAmountInput, parseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { validateVaultOperations, type VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import * as copy from '../../../copy/vaultOperations.js'

export type VaultOperationsDraft = {
	deposit: string
	commitment: string
	withdraw: string
	proposedPrice: string
	liquidations: { address: string; amount: string }[]
}
export function emptyVaultOperationsDraft(): VaultOperationsDraft {
	return { deposit: '', commitment: '', withdraw: '', proposedPrice: '', liquidations: [] }
}
export function parseVaultOperationsDraft(draft: VaultOperationsDraft, owner: Address) {
	const input: VaultOperationsInput = {
		depositAttoRep: draft.deposit.trim() === '' ? 0n : parseRepAmountInput(draft.deposit, 'Deposit'),
		changeCommitment: draft.commitment.trim() !== '',
		commitmentAttoEth: draft.commitment.trim() === '' ? 0n : parseEthAmountInput(draft.commitment, 'Commitment'),
		withdrawAttoRep: draft.withdraw.trim() === '' ? 0n : parseRepAmountInput(draft.withdraw, 'Withdrawal'),
		liquidations: draft.liquidations.map(target => ({ targetVault: getAddress(target.address), requestedDebtAttoEth: parseEthAmountInput(target.amount, 'Liquidation') })),
		minimumReceiverHealthFactorBps: 10_000n,
		validForSeconds: 300n,
	}
	validateVaultOperations(input, owner)
	return input
}

export function getVaultOperationsPrice(proposedPrice: string, cachedPrice: bigint, isPriceValid: boolean) {
	return isPriceValid || proposedPrice.trim() === '' ? cachedPrice : parseRepAmountInput(proposedPrice, copy.initialPriceLabel)
}
