import { peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool } from '../../../../types/contractArtifact'
import type { Address } from '@zoltar/shared/ethereum'
import { SystemState } from '../../types/peripheralTypes'
import { QuestionOutcome } from '../../types/types'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { requireAddress, requireArray, requireBigInt, requireBoolean } from '../utilities'

const getAwaitingForkContinuationAbi = [
	{
		inputs: [],
		name: 'awaitingForkContinuation',
		outputs: [{ type: 'bool', name: '' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

type SecurityVault = {
	repDepositShare: bigint
	securityBondAllowance: bigint
	unpaidEthFees: bigint
	feeIndex: bigint
	repInEscalationGame: bigint
}

function requireSystemState(value: unknown): SystemState {
	const state = requireBigInt(value, 'System state')
	switch (state) {
		case 0n:
			return SystemState.Operational
		case 1n:
			return SystemState.PoolForked
		case 2n:
			return SystemState.ForkMigration
		case 3n:
			return SystemState.ForkTruthAuction
		default:
			throw new Error(`Unexpected system state: ${state.toString()}`)
	}
}

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

export const getTotalSecurityBondAllowance = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalSecurityBondAllowance',
			address: securityPoolAddress,
			args: [],
		}),
		'Security bond allowance',
	)

export const getCompleteSetCollateralAmount = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'completeSetCollateralAmount',
			address: securityPoolAddress,
			args: [],
		}),
		'Complete set collateral amount',
	)

export const getShareTokenSupply = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareTokenSupply',
			address: securityPoolAddress,
			args: [],
		}),
		'Share token supply',
	)

export const getSystemState = async (client: ReadClient, securityPoolAddress: Address): Promise<SystemState> =>
	requireSystemState(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'systemState',
			address: securityPoolAddress,
			args: [],
		}),
	)

export const getAwaitingForkContinuation = async (client: ReadClient, securityPoolAddress: Address): Promise<boolean> =>
	requireBoolean(
		await client.readContract({
			abi: getAwaitingForkContinuationAbi,
			functionName: 'awaitingForkContinuation',
			address: securityPoolAddress,
			args: [],
		}),
		'Awaiting fork continuation',
	)

export const getCurrentRetentionRate = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'currentRetentionRate',
			address: securityPoolAddress,
			args: [],
		}),
		'Current retention rate',
	)

export const getSecurityVault = async (client: ReadClient, securityPoolAddress: Address, securityVault: Address): Promise<SecurityVault> => {
	const securityVaultData = requireArray(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'securityVaults',
			address: securityPoolAddress,
			args: [securityVault],
		}),
		'Security vault',
	)
	const repDepositShare = requireBigInt(securityVaultData[0], 'Security vault rep deposit share')
	const securityBondAllowance = requireBigInt(securityVaultData[1], 'Security vault security bond allowance')
	const unpaidEthFees = requireBigInt(securityVaultData[2], 'Security vault unpaid ETH fees')
	const feeIndex = requireBigInt(securityVaultData[3], 'Security vault fee index')
	const escalationGameAddress = requireAddress(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		}),
		'Security pool escalation game',
	)
	const repInEscalationGame =
		escalationGameAddress === '0x0000000000000000000000000000000000000000'
			? 0n
			: requireBigInt(
					await client.readContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						functionName: 'escrowedRepByVault',
						address: escalationGameAddress,
						args: [securityVault],
					}),
					'Escrowed REP by vault',
				)
	return { repDepositShare, securityBondAllowance, unpaidEthFees, feeIndex, repInEscalationGame }
}

export const getVaultCount = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getVaultCount',
			address: securityPoolAddress,
			args: [],
		}),
		'Vault count',
	)

export const getVaults = async (client: ReadClient, securityPoolAddress: Address, startIndex: bigint, count: bigint): Promise<Address[]> =>
	requireArray(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getVaults',
			address: securityPoolAddress,
			args: [startIndex, count],
		}),
		'Vault page',
	).map((vault, index) => requireAddress(vault, `Vault page entry ${index.toString()}`))

export const getActiveVaultCount = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getActiveVaultCount',
			address: securityPoolAddress,
			args: [],
		}),
		'Active vault count',
	)

export const getActiveVaults = async (client: ReadClient, securityPoolAddress: Address, startIndex: bigint, count: bigint): Promise<Address[]> =>
	requireArray(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getActiveVaults',
			address: securityPoolAddress,
			args: [startIndex, count],
		}),
		'Active vault page',
	).map((vault, index) => requireAddress(vault, `Active vault page entry ${index.toString()}`))

export const getSecurityPoolsEscalationGame = async (client: ReadClient, securityPoolAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		}),
		'Security pool escalation game',
	)

export const getPoolOwnershipDenominator = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'poolOwnershipDenominator',
			address: securityPoolAddress,
			args: [],
		}),
		'Pool ownership denominator',
	)

export const poolOwnershipToRep = async (client: ReadClient, securityPoolAddress: Address, poolOwnership: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'poolOwnershipToRep',
			address: securityPoolAddress,
			args: [poolOwnership],
		}),
		'Pool ownership to REP',
	)

export const redeemShares = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemShares',
			address: securityPoolAddress,
			args: [],
		}),
	)

export const getTotalFeesOwedToVaults = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalFeesOwedToVaults',
			address: securityPoolAddress,
			args: [],
		}),
		'Total fees owed to vaults',
	)

export const sharesToCash = async (client: ReadClient, securityPoolAddress: Address, completeSetAmount: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'sharesToCash',
			address: securityPoolAddress,
			args: [completeSetAmount],
		}),
		'Shares to cash',
	)

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

export const getRepToken = async (client: ReadClient, securityPoolAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'repToken',
			address: securityPoolAddress,
			args: [],
		}),
		'REP token address',
	)

export const getTotalRepBalance = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalRepBalance',
			address: securityPoolAddress,
			args: [],
		}),
		'Total REP balance',
	)
