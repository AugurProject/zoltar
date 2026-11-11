import { statoblast_SecurityPool_SecurityPool } from '../../../../types/contractArtifact'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { SystemState } from '../../types/statoblastTypes'
import { QuestionOutcome } from '../../types/types'
import { HIGH_GAS_SIMULATOR_WRITE_GAS } from '../constants'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { requireAddress, requireBigInt, requireBoolean } from '../utilities'

const getAwaitingForkContinuationAbi = [
	{
		inputs: [],
		name: 'awaitingForkContinuation',
		outputs: [{ type: 'bool', name: '' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

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
			return SystemState.ForkCollateralRepairAuction
		default:
			throw new Error(`Unexpected system state: ${state.toString()}`)
	}
}

export const withdrawFromEscalationGame = async (client: WriteClient, securityPoolAddress: Address, outcome: QuestionOutcome, depositIndexes: bigint[]) => {
	const hash = await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'withdrawFromEscalationGame',
			address: securityPoolAddress,
			args: [outcome, depositIndexes],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return hash
}

export const depositRepToVault = async (client: WriteClient, securityPoolAddress: Address, amount: bigint, targetHealthFactorBps?: bigint) =>
	await writeContractAndWait(client, async () =>
		client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'depositRepToVault',
			address: securityPoolAddress,
			args: [amount, targetHealthFactorBps ?? (await client.readContract({ address: securityPoolAddress, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'statoblastSecurityMultiplierBps' }))],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const createCompleteSet = async (client: WriteClient, securityPoolAddress: Address, settlementCollateralAttoEth: bigint) => {
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'createCompleteSet',
			address: securityPoolAddress,
			args: [settlementCollateralAttoEth],
			value: 0n,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
}

export const redeemCompleteSet = async (client: WriteClient, securityPoolAddress: Address, amountAttoShares: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'redeemCompleteSet',
			address: securityPoolAddress,
			args: [amountAttoShares],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getSettlementCollateralAttoEth = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'settlementCollateralAttoEth',
			address: securityPoolAddress,
			args: [],
		}),
		'Complete set collateral amount',
	)

export const getShareTokenSupplyAttoShares = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'shareTokenSupplyAttoShares',
			address: securityPoolAddress,
			args: [],
		}),
		'Share token supply',
	)

export const getSystemState = async (client: ReadClient, securityPoolAddress: Address): Promise<SystemState> =>
	requireSystemState(
		await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
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

export const getSecurityPoolsEscalationGame = async (client: ReadClient, securityPoolAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'escalationGame',
			address: securityPoolAddress,
			args: [],
		}),
		'Security pool escalation game',
	)

export const redeemShares = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'redeemShares',
			address: securityPoolAddress,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getRepToken = async (client: ReadClient, securityPoolAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'repToken',
			address: securityPoolAddress,
			args: [],
		}),
		'REP token address',
	)

export const getTotalPoolHeldAttoRep = async (client: ReadClient, securityPoolAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			functionName: 'getTotalPoolHeldAttoRep',
			address: securityPoolAddress,
			args: [],
		}),
		'Total REP balance',
	)
