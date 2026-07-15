import { type Address } from '@zoltar/shared/ethereum'
import { peripherals_SecurityPool_SecurityPool } from '../contractArtifact.js'
import type { SecurityVaultActionResult, WriteClient } from '../types/contracts.js'
import { writeContractAndWait } from './core.js'

export async function depositRepToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint) {
	if (amount <= 0n) throw new Error('REP deposit amount must be greater than zero')
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		args: [amount],
	}))
	return {
		action: 'depositRep',
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
export async function redeemRepFromSecurityPool(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address) {
	const hash = await writeContractAndWait(client, () => ({
		address: securityPoolAddress,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRep',
		args: [vaultAddress],
	}))
	return {
		action: 'redeemRep',
		hash,
	} satisfies SecurityVaultActionResult
}
