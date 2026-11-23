import { statoblast_QuestionLedger_QuestionLedger } from '../../../../types/contractArtifact'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { SystemState } from '../../types/statoblastTypes'
import type { QuestionOutcome } from '../../types/types'
import { HIGH_GAS_SIMULATOR_WRITE_GAS } from '../constants'
import { type ReadClient, type WriteClient, writeContractAndWait } from '../clients'
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
		default:
			throw new Error(`Unexpected system state: ${state.toString()}`)
	}
}

export const withdrawFromEscalationGame = async (client: WriteClient, questionLedgerAddress: Address, outcome: QuestionOutcome, depositIndexes: bigint[]) => {
	const hash = await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'withdrawFromEscalationGame',
			address: questionLedgerAddress,
			args: [outcome, depositIndexes],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return hash
}

export const createCompleteSet = async (client: WriteClient, questionLedgerAddress: Address, settlementCollateralAttoEth: bigint) => {
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'createCompleteSet',
			address: questionLedgerAddress,
			args: [settlementCollateralAttoEth],
			value: 0n,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
}

export const redeemCompleteSet = async (client: WriteClient, questionLedgerAddress: Address, amountAttoShares: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'redeemCompleteSet',
			address: questionLedgerAddress,
			args: [amountAttoShares],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getSettlementCollateralAttoEth = async (client: ReadClient, questionLedgerAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'settlementCollateralAttoEth',
			address: questionLedgerAddress,
			args: [],
		}),
		'Complete set collateral amount',
	)

export const getShareTokenSupplyAttoShares = async (client: ReadClient, questionLedgerAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'shareTokenSupplyAttoShares',
			address: questionLedgerAddress,
			args: [],
		}),
		'Share token supply',
	)

export const getSystemState = async (client: ReadClient, questionLedgerAddress: Address): Promise<SystemState> =>
	requireSystemState(
		await client.readContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'systemState',
			address: questionLedgerAddress,
			args: [],
		}),
	)

export const getAwaitingForkContinuation = async (client: ReadClient, questionLedgerAddress: Address): Promise<boolean> =>
	requireBoolean(
		await client.readContract({
			abi: getAwaitingForkContinuationAbi,
			functionName: 'awaitingForkContinuation',
			address: questionLedgerAddress,
			args: [],
		}),
		'Awaiting fork continuation',
	)

export const getQuestionLedgersEscalationGame = async (client: ReadClient, questionLedgerAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'escalationGame',
			address: questionLedgerAddress,
			args: [],
		}),
		'Question ledger escalation game',
	)

export const redeemShares = async (client: WriteClient, questionLedgerAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'redeemShares',
			address: questionLedgerAddress,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getRepToken = async (client: ReadClient, questionLedgerAddress: Address): Promise<Address> =>
	requireAddress(
		await client.readContract({
			abi: statoblast_QuestionLedger_QuestionLedger.abi,
			functionName: 'repToken',
			address: questionLedgerAddress,
			args: [],
		}),
		'REP token address',
	)
