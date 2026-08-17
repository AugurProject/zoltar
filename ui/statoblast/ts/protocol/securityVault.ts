import { type Address } from '@zoltar/shared/ethereum'
import { peripherals_SecurityPool_SecurityPool } from '../contractArtifact.js'
import type { SecurityVaultActionResult, WriteClient } from '../types/contracts.js'
import { writeContractAndWait } from './core.js'

export async function depositRepToVaultToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint, targetHealthFactorBps = 10_000n) {
	if (amount <= 0n) throw new Error('REP deposit amount must be greater than zero')
	if (targetHealthFactorBps < 10_000n) throw new Error('Target health factor must be at least 1.00×')
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
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
		abi: peripherals_SecurityPool_SecurityPool.abi,
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
		abi: peripherals_SecurityPool_SecurityPool.abi,
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
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRepFromVault',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemRepFromVault',
		hash,
	} satisfies SecurityVaultActionResult
}
