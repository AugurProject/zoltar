import { peripherals_SecurityPool_SecurityPool } from '../../../../types/contractArtifact'
import type { Address } from 'viem'
import { SystemState } from '../../types/peripheralTypes'
import { QuestionOutcome } from '../../types/types'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'

export const depositToEscalationGame = async (client: WriteClient, securityPoolAddress: Address, outcome: QuestionOutcome, amount: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'depositToEscalationGame',
			address: securityPoolAddress,
			args: [outcome, amount],
		}),
	)

export const withdrawFromEscalationGame = async (client: WriteClient, securityPoolAddress: Address, outcome: QuestionOutcome, depositIndexes: bigint[]) => {
	const hash = await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'withdrawFromEscalationGame',
			address: securityPoolAddress,
			args: [outcome, depositIndexes],
		}),
	)
	return hash
}

export const depositRep = async (client: WriteClient, securityPoolAddress: Address, amount: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'depositRep',
			address: securityPoolAddress,
			args: [amount],
		}),
	)

export const createCompleteSet = async (client: WriteClient, securityPoolAddress: Address, completeSetsToCreate: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'createCompleteSet',
			address: securityPoolAddress,
			args: [],
			value: completeSetsToCreate,
		}),
	)

export const redeemCompleteSet = async (client: WriteClient, securityPoolAddress: Address, completeSetsToRedeem: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemCompleteSet',
			address: securityPoolAddress,
			args: [completeSetsToRedeem],
		}),
	)

export const getTotalSecurityBondAllowance = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'totalSecurityBondAllowance',
		address: securityPoolAddress,
		args: [],
	})

export const getCompleteSetCollateralAmount = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'completeSetCollateralAmount',
		address: securityPoolAddress,
		args: [],
	})

export const getSystemState = async (client: ReadClient, securityPoolAddress: Address): Promise<SystemState> =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'systemState',
		address: securityPoolAddress,
		args: [],
	})

export const getCurrentRetentionRate = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'currentRetentionRate',
		address: securityPoolAddress,
		args: [],
	})

export const getSecurityVault = async (client: ReadClient, securityPoolAddress: Address, securityVault: Address) => {
	const [repDepositShare, securityBondAllowance, unpaidEthFees, feeIndex, lockedRepInEscalationGame] = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [securityVault],
	})
	return { repDepositShare, securityBondAllowance, unpaidEthFees, feeIndex, lockedRepInEscalationGame }
}

export const getVaultCount = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaultCount',
		address: securityPoolAddress,
		args: [],
	})

export const getVaults = async (client: ReadClient, securityPoolAddress: Address, startIndex: bigint, count: bigint) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'getVaults',
		address: securityPoolAddress,
		args: [startIndex, count],
	})

export const getSecurityPoolsEscalationGame = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'escalationGame',
		address: securityPoolAddress,
		args: [],
	})

export const getPoolOwnershipDenominator = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipDenominator',
		address: securityPoolAddress,
		args: [],
	})

export const poolOwnershipToRep = async (client: ReadClient, securityPoolAddress: Address, poolOwnership: bigint) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipToRep',
		address: securityPoolAddress,
		args: [poolOwnership],
	})

export const redeemShares = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemShares',
			address: securityPoolAddress,
			args: [],
		}),
	)

export const getTotalFeesOwedToVaults = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'totalFeesOwedToVaults',
		address: securityPoolAddress,
		args: [],
	})

export const sharesToCash = async (client: ReadClient, securityPoolAddress: Address, completeSetAmount: bigint) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'sharesToCash',
		address: securityPoolAddress,
		args: [completeSetAmount],
	})

export const threeShareArrayToCash = async (client: ReadClient, securityPoolAddress: Address, shares: readonly [bigint, bigint, bigint]): Promise<[bigint, bigint, bigint]> => {
	const [firstShare, secondShare, thirdShare] = shares
	return await Promise.all([sharesToCash(client, securityPoolAddress, firstShare), sharesToCash(client, securityPoolAddress, secondShare), sharesToCash(client, securityPoolAddress, thirdShare)])
}

export const updateVaultFees = async (client: WriteClient, securityPoolAddress: Address, vault: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'updateVaultFees',
			address: securityPoolAddress,
			args: [vault],
		}),
	)

export const redeemFees = async (client: WriteClient, securityPoolAddress: Address, vault: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemFees',
			address: securityPoolAddress,
			args: [vault],
		}),
	)

export const redeemRep = async (client: WriteClient, securityPoolAddress: Address, vault: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemRep',
			address: securityPoolAddress,
			args: [vault],
		}),
	)

export const getRepToken = async (client: ReadClient, securityPoolAddress: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repToken',
		address: securityPoolAddress,
		args: [],
	})
