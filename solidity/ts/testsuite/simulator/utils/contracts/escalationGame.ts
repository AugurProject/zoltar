import { encodeDeployData } from '@zoltar/shared/ethereum'
import { ReputationToken_ReputationToken, peripherals_EscalationGame_EscalationGame, peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier } from '../../../../types/contractArtifact'
import { AccountAddress, QuestionOutcome } from '../../types/types'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { CONTRACT_PAGE_SIZE } from './pagination'
import { getRepTokenAddress } from './zoltar'
import { requireAddress, requireArray, requireBigInt } from '../utilities'

function requireContractAddress(value: `0x${string}` | null | undefined, context: string): `0x${string}` {
	if (value === undefined || value === null) throw new Error(`${context} missing`)
	return value
}

function parseQuestionOutcome(value: unknown): QuestionOutcome {
	const outcome = requireBigInt(value, 'Question outcome')
	switch (outcome) {
		case 0n:
			return QuestionOutcome.Invalid
		case 1n:
			return QuestionOutcome.Yes
		case 2n:
			return QuestionOutcome.No
		case 3n:
			return QuestionOutcome.None
		default:
			throw new Error(`Unexpected question outcome: ${String(value)}`)
	}
}

type EscalationDeposit = {
	depositIndex: bigint
	depositor: AccountAddress
	amount: bigint
	cumulativeAmount: bigint
}

function getTupleField(value: unknown, index: number, key: string, context: string) {
	if (Array.isArray(value)) return value[index]
	if (typeof value !== 'object' || value === null) throw new Error(`${context} must be a tuple`)
	return Reflect.get(value, key)
}

export const getNonDecisionThreshold = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionThreshold',
			address: escalationGame,
			args: [],
		}),
		'Non-decision threshold',
	)

export const getQuestionResolution = async (client: ReadClient, escalationGame: AccountAddress) =>
	parseQuestionOutcome(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGame,
			args: [],
		}),
	)

export const getStartBond = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'startBond',
			address: escalationGame,
			args: [],
		}),
		'Start bond',
	)

export const getEscalationGameDeposits = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => {
	let currentIndex = 0n
	const pages: EscalationDeposit[] = []
	do {
		const returnedDeposits = requireArray(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				functionName: 'getDepositsByOutcome',
				address: escalationGame,
				args: [outcome, currentIndex, CONTRACT_PAGE_SIZE],
			}),
			'Escalation game deposit page',
		).map((deposit: unknown, index: number) => ({
			depositIndex: currentIndex + BigInt(index),
			depositor: requireAddress(getTupleField(deposit, 0, 'depositor', 'Escalation deposit'), 'Escalation deposit depositor'),
			amount: requireBigInt(getTupleField(deposit, 1, 'amount', 'Escalation deposit'), 'Escalation deposit amount'),
			cumulativeAmount: requireBigInt(getTupleField(deposit, 2, 'cumulativeAmount', 'Escalation deposit'), 'Escalation deposit cumulative amount'),
		}))
		const newDeposits = returnedDeposits.filter((deposit: EscalationDeposit) => BigInt(deposit.depositor) !== 0n || deposit.amount !== 0n || deposit.cumulativeAmount !== 0n)
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
	const verifierDeploymentHash = await writeClient.sendTransaction({
		data: encodeDeployData({
			abi: peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
			bytecode: `0x${peripherals_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
		}),
	})
	const verifierDeploymentReceipt = await writeClient.waitForTransactionReceipt({ hash: verifierDeploymentHash })
	const proofVerifierAddress = requireContractAddress(verifierDeploymentReceipt.contractAddress, 'proof verifier deployment address')
	const deploymentHash = await writeClient.sendTransaction({
		data: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [writeClient.account.address, getRepTokenAddress(0n), proofVerifierAddress],
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

export const getActivationTime = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'activationTime',
			address: escalationGame,
			args: [],
		}),
		'Escalation activation time',
	)

export const getEscalationGameTotalCost = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'totalCost',
			address: escalationGame,
			args: [],
		}),
		'Escalation total cost',
	)

export const depositOnOutcome = async (writeClient: WriteClient, escalationGame: AccountAddress, depositor: AccountAddress, outcome: QuestionOutcome, amount: bigint) => {
	const preview = requireArray(
		await writeClient.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'previewDepositOnOutcome',
			address: escalationGame,
			args: [outcome, amount],
		}),
		'Escalation deposit preview',
	)
	const acceptedAmount = requireBigInt(preview[0], 'Accepted escalation deposit amount')
	const resultingCumulativeAmount = requireBigInt(preview[1], 'Resulting escalation cumulative amount')
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
