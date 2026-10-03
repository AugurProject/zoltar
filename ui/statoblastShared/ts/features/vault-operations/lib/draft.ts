import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { parseEthAmountInput, parseRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { validateVaultOperations, type VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { getStagedOperationTimeoutFieldError } from '../../security-pools/lib/securityVault.js'
import * as copy from '../../../copy/vaultOperations.js'

export type VaultOperationsDraft = {
	deposit: string
	commitment: string
	withdraw: string
	timeoutMinutes: string
	proposedPrice: string
	liquidations: { address: string; amount: string }[]
}
export function emptyVaultOperationsDraft(): VaultOperationsDraft {
	return { deposit: '', commitment: '', withdraw: '', proposedPrice: '', timeoutMinutes: '5', liquidations: [] }
}
export function parseVaultOperationsDraft(draft: VaultOperationsDraft, owner: Address) {
	const timeout = draft.timeoutMinutes
	const timeoutError = getStagedOperationTimeoutFieldError(timeout.trim() === '' ? '0' : timeout)
	if (timeoutError !== undefined) throw new Error(timeoutError)
	const input: VaultOperationsInput = {
		depositAttoRep: draft.deposit.trim() === '' ? 0n : parseRepAmountInput(draft.deposit, 'Deposit'),
		changeCommitment: draft.commitment.trim() !== '',
		commitmentAttoEth: draft.commitment.trim() === '' ? 0n : parseEthAmountInput(draft.commitment, 'Commitment'),
		withdrawAttoRep: draft.withdraw.trim() === '' ? 0n : parseRepAmountInput(draft.withdraw, 'Withdrawal'),
		liquidations: draft.liquidations.map(target => ({ targetVault: getAddress(target.address), requestedDebtAttoEth: parseEthAmountInput(target.amount, 'Liquidation') })),
		minimumReceiverHealthFactorBps: 10_000n,
		validForSeconds: BigInt(timeout) * 60n,
	}
	validateVaultOperations(input, owner)
	return input
}

export function getVaultOperationsPrice(proposedPrice: string, cachedPrice: bigint, isPriceValid: boolean) {
	return isPriceValid || proposedPrice.trim() === '' ? cachedPrice : parseRepAmountInput(proposedPrice, copy.initialPriceLabel)
}
