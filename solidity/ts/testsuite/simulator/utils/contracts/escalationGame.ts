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
			throw new Error(`Unexpected question outcome: ${ String(value) }`)
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
	parseQuestionOutcome(await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'getQuestionResolution',
		address: escalationGame,
		args: [],
	}))

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
		const newDeposits = (
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getDepositsByOutcome',
				address: escalationGame,
				args: [outcome, currentIndex, CONTRACT_PAGE_SIZE],
			})
			)
			.map((deposit, index) => ({ ...deposit, depositIndex: currentIndex + BigInt(index) }))
			.filter(deposit => BigInt(deposit.depositor) !== 0x0n)
		pages.push(...newDeposits)
		if (BigInt(newDeposits.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	} while (true)
	return pages
}

export const deployEscalationGame = async (writeClient: WriteClient, startBond: bigint, nonDecisionThreshold: bigint) => {
	await writeContractAndWait(writeClient, () => writeClient.writeContract({
		abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
		functionName: 'deployEscalationGame',
		address: getInfraContractAddresses().escalationGameFactory,
		args: [startBond, nonDecisionThreshold],
	}))
	return getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${ peripherals_EscalationGame_EscalationGame.evm.bytecode.object }`,
			args: [writeClient.account.address],
		}),
		from: getInfraContractAddresses().escalationGameFactory,
		salt: numberToBytes(0, { size: 32 }),
	})
}

export const getBalances = async (client: ReadClient, escalationGame: AccountAddress) => {
	const [invalid, yes, no] = await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'getBalances',
		address: escalationGame,
		args: [],
	})
	return { invalid, yes, no }
}

export const getStartingTime = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'startingTime',
		address: escalationGame,
		args: [],
	})

export const depositOnOutcome = async (writeClient: WriteClient, escalationGame: AccountAddress, depositor: AccountAddress, outcome: QuestionOutcome, amount: bigint) => {
	await writeContractAndWait(writeClient, () => writeClient.writeContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'depositOnOutcome',
		address: escalationGame,
		args: [depositor, outcome, amount],
	}))
}
