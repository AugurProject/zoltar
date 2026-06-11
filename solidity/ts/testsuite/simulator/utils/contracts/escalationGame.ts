import { encodeDeployData, getCreate2Address, numberToBytes } from 'viem'
import { peripherals_EscalationGame_EscalationGame, peripherals_factories_EscalationGameFactory_EscalationGameFactory } from '../../../../types/contractArtifact'
import { AccountAddress, QuestionOutcome } from '../../types/types'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { getInfraContractAddresses } from './deployPeripherals'
import { CONTRACT_PAGE_SIZE } from './pagination'

function parseQuestionOutcome(value: unknown): QuestionOutcome {
	switch (value) {
		case QuestionOutcome.Invalid:
		case QuestionOutcome.Yes:
		case QuestionOutcome.No:
		case QuestionOutcome.None:
			return value
		default:
			throw new Error(`Unexpected question outcome: ${String(value)}`)
	}
}

export const getNonDecisionThreshold = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'nonDecisionThreshold',
		address: escalationGame,
		args: [],
	})

export const getQuestionResolution = async (client: ReadClient, escalationGame: AccountAddress) =>
	parseQuestionOutcome(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGame,
			args: [],
		}),
	)

export const getStartBond = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'startBond',
		address: escalationGame,
		args: [],
	})

export const getEscalationGameDeposits = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => {
	let currentIndex = 0n
	type Pages = {
		depositIndex: bigint
		depositor: AccountAddress
		amount: bigint
		cumulativeAmount: bigint
	}[]
	const pages: Pages = []
	do {
		const returnedDeposits = (
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getDepositsByOutcome',
				address: escalationGame,
				args: [outcome, currentIndex, CONTRACT_PAGE_SIZE],
			})
		).map((deposit, index) => ({ ...deposit, depositIndex: currentIndex + BigInt(index) }))
		const newDeposits = returnedDeposits.filter(deposit => BigInt(deposit.depositor) !== 0n || deposit.amount !== 0n || deposit.cumulativeAmount !== 0n)
		pages.push(...newDeposits)
		if (BigInt(returnedDeposits.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	} while (true)
	return pages
}

export const getEscalationGameOutcomeState = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'getOutcomeState',
		address: escalationGame,
		args: [outcome],
	})

export const deployEscalationGame = async (writeClient: WriteClient, startBond: bigint, nonDecisionThreshold: bigint) => {
	await writeContractAndWait(writeClient, () =>
		writeClient.writeContract({
			abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
			functionName: 'deployEscalationGame',
			address: getInfraContractAddresses().escalationGameFactory,
			args: [startBond, nonDecisionThreshold],
		}),
	)
	return getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [writeClient.account.address],
		}),
		from: getInfraContractAddresses().escalationGameFactory,
		salt: numberToBytes(0, { size: 32 }),
	})
}

export const getBalances = async (client: ReadClient, escalationGame: AccountAddress) => {
	const [invalidState, yesState, noState] = await Promise.all([
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getOutcomeState',
			address: escalationGame,
			args: [0],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getOutcomeState',
			address: escalationGame,
			args: [1],
		}),
		client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getOutcomeState',
			address: escalationGame,
			args: [2],
		}),
	])
	return { invalid: invalidState.balance, yes: yesState.balance, no: noState.balance }
}

export const getActivationTime = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'activationTime',
		address: escalationGame,
		args: [],
	})

export const getEscalationGameTotalCost = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'totalCost',
		address: escalationGame,
		args: [],
	})

export const depositOnOutcome = async (writeClient: WriteClient, escalationGame: AccountAddress, depositor: AccountAddress, outcome: QuestionOutcome, amount: bigint) => {
	await writeContractAndWait(writeClient, () =>
		writeClient.writeContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'depositOnOutcome',
			address: escalationGame,
			args: [depositor, outcome, amount],
		}),
	)
}
