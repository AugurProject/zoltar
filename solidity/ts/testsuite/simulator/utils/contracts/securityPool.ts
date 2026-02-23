import { mainnet } from 'viem/chains'
import { peripherals_SecurityPool_SecurityPool } from '../../../../types/contractArtifact.js'
import { SystemState } from '../../types/peripheralTypes.js'
import { QuestionOutcome } from '../../types/types.js'
import { ReadClient, WriteClient } from '../viem.js'

export const depositToEscalationGame = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: QuestionOutcome, amount: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositToEscalationGame',
		address: securityPoolAddress,
		args: [outcome, amount],
	})
}

export const withdrawFromEscalationGame = async (client: WriteClient, securityPoolAddress: `0x${ string }`, depositIndexes: bigint[]) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'withdrawFromEscalationGame',
		address: securityPoolAddress,
		args: [depositIndexes],
	})
}

export const depositRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`, amount: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		address: securityPoolAddress,
		args: [amount]
	})
}

export const createCompleteSet = async (client: WriteClient, securityPoolAddress: `0x${ string }`, completeSetsToCreate: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'createCompleteSet',
		address: securityPoolAddress,
		args: [],
		value: completeSetsToCreate,
	})
}

export const redeemCompleteSet = async (client: WriteClient, securityPoolAddress: `0x${ string }`, completeSetsToRedeem: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		address: securityPoolAddress,
		args: [completeSetsToRedeem],
	})
}

export const getTotalSecurityBondAllowance = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'totalSecurityBondAllowance',
		address: securityPoolAddress,
		args: []
	}) as bigint
}

export const getCompleteSetCollateralAmount = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'completeSetCollateralAmount',
		address: securityPoolAddress,
		args: []
	}) as bigint
}

export const getSystemState = async (client: ReadClient, securityPoolAddress: `0x${ string }`): Promise<SystemState> => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'systemState',
		address: securityPoolAddress,
		args: [],
	})
}

export const getCurrentRetentionRate = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'currentRetentionRate',
		address: securityPoolAddress,
		args: [],
	})
}

export const getSecurityVault = async (client: ReadClient, securityPoolAddress: `0x${ string }`, securityVault: `0x${ string }`) => {
	const [repDepositShare, securityBondAllowance, unpaidEthFees, feeIndex] = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [securityVault],
	})
	return { repDepositShare, securityBondAllowance, unpaidEthFees, feeIndex }
}

export const getSecurityPoolsEscalationGame = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
	})
}

export const getPoolOwnershipDenominator = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipDenominator',
		address: securityPoolAddress,
		args: [],
	})
}

export const poolOwnershipToRep = async (client: ReadClient, securityPoolAddress: `0x${ string }`, poolOwnership: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipToRep',
		address: securityPoolAddress,
		args: [poolOwnership],
	})
}

export const repToPoolOwnership = async (client: ReadClient, securityPoolAddress: `0x${ string }`, repAmount: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repToPoolOwnership',
		address: securityPoolAddress,
		args: [repAmount],
	})
}

export const redeemShares = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemShares',
		address: securityPoolAddress,
		args: [],
	})
}


export const getTotalFeesOwedToVaults = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'totalFeesOwedToVaults',
		address: securityPoolAddress,
		args: [],
	})
}

export const sharesToCash = async (client: ReadClient, securityPoolAddress: `0x${ string }`, completeSetAmount: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'sharesToCash',
		address: securityPoolAddress,
		args: [completeSetAmount],
	})
}

export const cashToShares = async (client: ReadClient, securityPoolAddress: `0x${ string }`, eth: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'cashToShares',
		address: securityPoolAddress,
		args: [eth],
	})
}

export const getShareTokenSupply = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'shareTokenSupply',
		address: securityPoolAddress,
		args: [],
	})
}

export const shareArrayToCash = async (client: ReadClient, securityPoolAddress: `0x${ string }`, shares: readonly bigint[]) => {
	return await Promise.all(shares.map((shares) => sharesToCash(client, securityPoolAddress, shares)))
}

export const updateVaultFees = async (client: WriteClient, securityPoolAddress: `0x${ string }`, vault: `0x${ string }`) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'updateVaultFees',
		address: securityPoolAddress,
		args: [vault],
	})
}

export const redeemFees = async (client: WriteClient, securityPoolAddress: `0x${ string }`, vault: `0x${ string }`) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemFees',
		address: securityPoolAddress,
		args: [vault],
	})
}

export const redeemRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`, vault: `0x${ string }`) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemRep',
		address: securityPoolAddress,
		args: [vault],
	})
}

export const getRepToken = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repToken',
		address: securityPoolAddress,
		args: [],
	})
}
