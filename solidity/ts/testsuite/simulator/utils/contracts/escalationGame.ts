import { encodeDeployData } from 'viem'
import { ReputationToken_ReputationToken, peripherals_EscalationGame_EscalationGame } from '../../../../types/contractArtifact'
import { AccountAddress, QuestionOutcome } from '../../types/types'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { CONTRACT_PAGE_SIZE } from './pagination'
import { getRepTokenAddress } from './zoltar'

function requireContractAddress(value: `0x${string}` | null | undefined, context: string): `0x${string}` {
	if (value === undefined || value === null) throw new Error(`${context} missing`)
	return value
}

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
	const deploymentHash = await writeClient.sendTransaction({
		data: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [writeClient.account.address, getRepTokenAddress(0n)],
		}),
	})
	const deploymentReceipt = await writeClient.waitForTransactionReceipt({ hash: deploymentHash })
	const escalationGameAddress = requireContractAddress(deploymentReceipt.contractAddress, 'Escalation game deployment address')
	await writeContractAndWait(writeClient, () =>
		writeClient.writeContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'start',
			address: escalationGameAddress,
			args: [startBond, nonDecisionThreshold],
		}),
	)
	return escalationGameAddress
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
	const [acceptedAmount, resultingCumulativeAmount] = await writeClient.readContract({
		abi: peripherals_EscalationGame_EscalationGame.abi,
		functionName: 'previewDepositOnOutcome',
		address: escalationGame,
		args: [outcome, amount],
	})
	await writeContractAndWait(writeClient, () =>
		writeClient.writeContract({
			abi: ReputationToken_ReputationToken.abi,
			functionName: 'transfer',
			address: getRepTokenAddress(0n),
			args: [escalationGame, acceptedAmount],
		}),
	)
	await writeContractAndWait(writeClient, () =>
		writeClient.writeContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'recordDepositFromSecurityPool',
			address: escalationGame,
			args: [depositor, outcome, acceptedAmount, resultingCumulativeAmount],
		}),
	)
}
