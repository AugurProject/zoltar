import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import type { ReadClient, SecurityVaultActionResult, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'

export async function depositRepToVaultToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint, targetHealthFactorBps: bigint) {
	if (amount <= 0n) throw new Error('REP deposit amount must be greater than zero')
	if (targetHealthFactorBps < 10_000n) throw new Error('Target backing ratio must be at least 1×')
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'depositRepToVault',
		args: [amount, targetHealthFactorBps],
	}))
	return {
		action: 'depositRepToVault',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function updateSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'updateVaultFees',
		args: [vaultAddress],
	}))
	return {
		action: 'updateVaultFees',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function redeemSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'redeemFees',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemFees',
		hash,
	} satisfies SecurityVaultActionResult
}
export async function redeemRepFromVaultFromSecurityPool(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: statoblast_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRepFromVault',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemRepFromVault',
		hash,
	} satisfies SecurityVaultActionResult
}

/** The price coordinator rejects staged operations once this is true, so commitment exits must call the pool directly. */
export async function isSecurityPoolEscalationResolved(client: Pick<ReadClient, 'readContract'>, securityPoolAddress: Address) {
	return await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPoolAddress, functionName: 'isEscalationResolved', args: [] })
}

/** Sets the caller's own commitment limit on the pool, without the price coordinator queue. */
export async function setUnderwritingLimit(client: WriteClient, securityPoolAddress: Address, limitAttoEth: bigint) {
	if (limitAttoEth < 0n) throw new Error('Commitment limit cannot be negative')
	const hash = await writeContractAndWait(client, () => ({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'setUnderwritingLimit', args: [limitAttoEth] }))
	return { action: 'setVaultUnderwritingLimit', hash } satisfies SecurityVaultActionResult
}
