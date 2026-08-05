import { peripherals_EscalationGame_EscalationGame, peripherals_SecurityPool_SecurityPool } from '../../../../types/contractArtifact'
import type { Address } from '@zoltar/shared/ethereum'
import { SystemState } from '../../types/peripheralTypes'
import { QuestionOutcome } from '../../types/types'
import { HIGH_GAS_SIMULATOR_WRITE_GAS } from '../constants'
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
	vaultRepBackingAttoRep: bigint
	coverageCommitmentAttoEth: bigint
	claimableFeesAttoEth: bigint
	feeIndex: bigint
	disputeStakedRepAttoRep: bigint
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
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const withdrawFromEscalationGame = async (client: WriteClient, securityPoolAddress: Address, outcome: QuestionOutcome, depositIndexes: bigint[]) => {
	const hash = await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'withdrawFromEscalationGame',
			address: securityPoolAddress,
			args: [outcome, depositIndexes],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return hash
}

export const depositRepToVault = async (client: WriteClient, securityPoolAddress: Address, amount: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'depositRepToVault',
			address: securityPoolAddress,
			args: [amount],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const createCompleteSet = async (client: WriteClient, securityPoolAddress: Address, settlementCollateralAttoEth: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'createCompleteSet',
			address: securityPoolAddress,
			args: [],
			value: settlementCollateralAttoEth,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const updateSettlementCollateral = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'updateSettlementCollateral',
			address: securityPoolAddress,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const redeemCompleteSet = async (client: WriteClient, securityPoolAddress: Address, amountAttoShares: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemCompleteSet',
			address: securityPoolAddress,
			args: [amountAttoShares],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getTotalCoverageCommitmentAttoEth = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalCoverageCommitmentAttoEth',
			address: securityPoolAddress,
			args: [],
		}),
		'Coverage commitment',
	)

export const getSettlementCollateralAttoEth = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'settlementCollateralAttoEth',
			address: securityPoolAddress,
			args: [],
		}),
		'Complete set collateral amount',
	)

export const getShareTokenSupplyAttoShares = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'shareTokenSupplyAttoShares',
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
	const vaultRepBackingAttoRep = requireBigInt(securityVaultData[0], 'Security vault rep deposit share')
	const coverageCommitmentAttoEth = requireBigInt(securityVaultData[1], 'Security vault coverage commitment')
	const claimableFeesAttoEth = requireBigInt(securityVaultData[2], 'Security vault unpaid ETH fees')
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
	const disputeStakedRepAttoRep =
		escalationGameAddress === '0x0000000000000000000000000000000000000000'
			? 0n
			: requireBigInt(
					await client.readContract({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						functionName: 'disputeStakedRepByVaultAttoRep',
						address: escalationGameAddress,
						args: [securityVault],
					}),
					'Escrowed REP by vault',
				)
	return { vaultRepBackingAttoRep, coverageCommitmentAttoEth, claimableFeesAttoEth, feeIndex, disputeStakedRepAttoRep }
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

export const getTotalRepBackingUnits = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalRepBackingUnits',
			address: securityPoolAddress,
			args: [],
		}),
		'REP backing units denominator',
	)

export const backingUnitsToAttoRep = async (client: ReadClient, securityPoolAddress: Address, repBackingUnits: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'backingUnitsToAttoRep',
			address: securityPoolAddress,
			args: [repBackingUnits],
		}),
		'REP backing units to REP',
	)

export const redeemShares = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemShares',
			address: securityPoolAddress,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getTotalClaimableVaultFeesAttoEth = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalClaimableVaultFeesAttoEth',
			address: securityPoolAddress,
			args: [],
		}),
		'Total fees owed to vaults',
	)

export const getTotalAccruedFees = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'totalAccruedFeesAttoEth',
			address: securityPoolAddress,
			args: [],
		}),
		'Total accrued fees',
	)

export const attoSharesToAttoEth = async (client: ReadClient, securityPoolAddress: Address, amountAttoShares: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'attoSharesToAttoEth',
			address: securityPoolAddress,
			args: [amountAttoShares],
		}),
		'Shares to cash',
	)

export const threeAttoShareArrayToAttoEth = async (client: ReadClient, securityPoolAddress: Address, amountsAttoShares: readonly [bigint, bigint, bigint]): Promise<[bigint, bigint, bigint]> => {
	const [firstAmountAttoShares, secondAmountAttoShares, thirdAmountAttoShares] = amountsAttoShares
	return await Promise.all([attoSharesToAttoEth(client, securityPoolAddress, firstAmountAttoShares), attoSharesToAttoEth(client, securityPoolAddress, secondAmountAttoShares), attoSharesToAttoEth(client, securityPoolAddress, thirdAmountAttoShares)])
}

export const updateVaultFees = async (client: WriteClient, securityPoolAddress: Address, vault: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'updateVaultFees',
			address: securityPoolAddress,
			args: [vault],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const redeemFees = async (client: WriteClient, securityPoolAddress: Address, vault: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemFees',
			address: securityPoolAddress,
			args: [vault],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const redeemRepFromVault = async (client: WriteClient, securityPoolAddress: Address, vault: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'redeemRepFromVault',
			address: securityPoolAddress,
			args: [vault],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
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

export const getTotalPoolHeldRepAttoRep = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalPoolHeldRepAttoRep',
			address: securityPoolAddress,
			args: [],
		}),
		'Total REP balance',
	)
