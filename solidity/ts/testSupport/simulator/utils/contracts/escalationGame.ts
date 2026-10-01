import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import { ReputationToken_ReputationToken, statoblast_EscalationGame_EscalationGame, statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier } from '../../../../types/contractArtifact'
import { AccountAddress, QuestionOutcome } from '../../types/types'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { CONTRACT_PAGE_SIZE } from './pagination'
import { getRepTokenAddress } from './zoltar'
import { getInfraContractAddresses } from './deployStatoblast'
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
	amountAttoRep: bigint
	cumulativeAmountAttoRep: bigint
}

function getTupleField(value: unknown, index: number, key: string, context: string) {
	if (Array.isArray(value)) return value[index]
	if (typeof value !== 'object' || value === null) throw new Error(`${context} must be a tuple`)
	return Reflect.get(value, key)
}

export const getNonDecisionThresholdAttoRep = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionThresholdAttoRep',
			address: escalationGame,
			args: [],
		}),
		'Non-decision threshold',
	)

export const getQuestionResolution = async (client: ReadClient, escalationGame: AccountAddress) =>
	parseQuestionOutcome(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getQuestionResolution',
			address: escalationGame,
			args: [],
		}),
	)

export const getStartBond = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'startBondAttoRep',
			address: escalationGame,
			args: [],
		}),
		'Start bond',
	)

export const getTotalEscrowedRep = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'totalDisputeStakedAttoRep',
			address: escalationGame,
			args: [],
		}),
		'Total escrowed REP',
	)

export const getEscrowedRepByVault = async (client: ReadClient, escalationGame: AccountAddress, vault: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'disputeStakedRepByVaultAttoRep',
			address: escalationGame,
			args: [vault],
		}),
		'Escrowed REP by vault',
	)

export const getEscalationGameDeposits = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => {
	let currentIndex = 0n
	const pages: EscalationDeposit[] = []
	do {
		const returnedDeposits = requireArray(
			await client.readContract({
				abi: statoblast_EscalationGame_EscalationGame.abi,
				functionName: 'getDepositsByOutcome',
				address: escalationGame,
				args: [outcome, currentIndex, CONTRACT_PAGE_SIZE],
			}),
			'Escalation game deposit page',
		).map((deposit: unknown, index: number) => ({
			depositIndex: currentIndex + BigInt(index),
			depositor: requireAddress(getTupleField(deposit, 0, 'depositor', 'Escalation deposit'), 'Escalation deposit depositor'),
			amountAttoRep: requireBigInt(getTupleField(deposit, 1, 'amountAttoRep', 'Escalation deposit'), 'Escalation deposit amount'),
			cumulativeAmountAttoRep: requireBigInt(getTupleField(deposit, 2, 'cumulativeAmountAttoRep', 'Escalation deposit'), 'Escalation deposit cumulative amount'),
		}))
		const newDeposits = returnedDeposits.filter((deposit: EscalationDeposit) => BigInt(deposit.depositor) !== 0n || deposit.amountAttoRep !== 0n || deposit.cumulativeAmountAttoRep !== 0n)
		pages.push(...newDeposits)
		if (BigInt(returnedDeposits.length) !== CONTRACT_PAGE_SIZE) break
		currentIndex += CONTRACT_PAGE_SIZE
	} while (true)
	return pages
}

export const getEscalationGameOutcomeState = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'getOutcomeState',
		address: escalationGame,
		args: [outcome],
	})

export const deployEscalationGame = async (writeClient: WriteClient, startBondAttoRep: bigint, nonDecisionThresholdAttoRep: bigint) => {
	const verifierDeploymentHash = await writeClient.sendTransaction({
		data: encodeDeployData({
			abi: statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.abi,
			bytecode: `0x${statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier.evm.bytecode.object}`,
		}),
	})
	const verifierDeploymentReceipt = await writeClient.waitForTransactionReceipt({ hash: verifierDeploymentHash })
	const proofVerifierAddress = requireContractAddress(verifierDeploymentReceipt.contractAddress, 'proof verifier deployment address')
	const deploymentHash = await writeClient.sendTransaction({
		data: encodeDeployData({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [writeClient.account.address, getRepTokenAddress(0n), proofVerifierAddress, getInfraContractAddresses().escalationGameClaimDelegate],
		}),
	})
	const deploymentReceipt = await writeClient.waitForTransactionReceipt({ hash: deploymentHash })
	const escalationGameAddress = requireContractAddress(deploymentReceipt.contractAddress, 'Escalation game deployment address')
	await writeContractAndWait(writeClient, () =>
		writeClient.writeContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'start',
			address: escalationGameAddress,
			args: [startBondAttoRep, nonDecisionThresholdAttoRep],
		}),
	)
	return escalationGameAddress
}

export const getBalances = async (client: ReadClient, escalationGame: AccountAddress) => {
	const [invalidState, yesState, noState] = await Promise.all([
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getOutcomeState',
			address: escalationGame,
			args: [0],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getOutcomeState',
			address: escalationGame,
			args: [1],
		}),
		client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getOutcomeState',
			address: escalationGame,
			args: [2],
		}),
	])
	return { invalid: invalidState.balanceAttoRep, yes: yesState.balanceAttoRep, no: noState.balanceAttoRep }
}

export const getActivationTime = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'activationTime',
			address: escalationGame,
			args: [],
		}),
		'Escalation activation time',
	)

export const getEscalationGameTotalCost = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'totalCostAttoRep',
			address: escalationGame,
			args: [],
		}),
		'Escalation total cost',
	)

export const depositOnOutcome = async (writeClient: WriteClient, escalationGame: AccountAddress, depositor: AccountAddress, outcome: QuestionOutcome, amount: bigint) => {
	const preview = requireArray(
		await writeClient.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
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
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'recordDepositFromSecurityPool',
			address: escalationGame,
			args: [depositor, outcome, acceptedAmount, resultingCumulativeAmount],
		}),
	)
}

export const readIterativeAttritionCost = async (client: ReadClient, escalationGame: AccountAddress, timeSinceStart: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'computeIterativeAttritionCostAttoRep',
			address: escalationGame,
			args: [timeSinceStart],
		}),
		'Iterative attrition cost',
	)

export const readTimeSinceStartFromAttritionCost = async (client: ReadClient, escalationGame: AccountAddress, attritionCost: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'computeTimeSinceStartFromAttritionCostAttoRep',
			address: escalationGame,
			args: [attritionCost],
		}),
		'Time since start from attrition cost',
	)

export const readBindingCapital = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getBindingCapitalAttoRep',
			address: escalationGame,
			args: [],
		}),
		'Binding capital',
	)

export const readHasReachedNonDecision = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'hasReachedNonDecision',
		address: escalationGame,
		args: [],
	})

export const readNonDecisionState = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionState',
			address: escalationGame,
			args: [],
		}),
		'Non-decision state',
	)

export const readCanTriggerOwnFork = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'canTriggerOwnFork',
		address: escalationGame,
		args: [],
	})

export const readEscalationGameEndDate = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getEscalationGameEndDate',
			address: escalationGame,
			args: [],
		}),
		'Escalation game end date',
	)

export const readFinalQuestionResolution = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getFinalQuestionResolution',
			address: escalationGame,
			args: [],
		}),
		'Final question resolution',
	)

export const readNonDecisionTimestamp = async (client: ReadClient, escalationGame: AccountAddress): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'nonDecisionTimestamp',
			address: escalationGame,
			args: [],
		}),
		'Non-decision timestamp',
	)

export const readCarryPeaks = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => (await getEscalationGameOutcomeState(client, escalationGame, outcome)).currentPeaks

export const readCarryRoot = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => (await getEscalationGameOutcomeState(client, escalationGame, outcome)).currentCarryRoot

export const readCarryLeafCount = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => (await getEscalationGameOutcomeState(client, escalationGame, outcome)).currentLeafCount

export const readCarryTotal = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => (await getEscalationGameOutcomeState(client, escalationGame, outcome)).currentCarryTotalAttoRep

export const readNullifierRoot = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome) => (await getEscalationGameOutcomeState(client, escalationGame, outcome)).currentNullifierRoot

export const readIsForkCarryFundingComplete = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'isForkCarryFundingComplete',
		address: escalationGame,
		args: [],
	})

export const readForkCarrySnapshotInitialized = async (client: ReadClient, escalationGame: AccountAddress) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'forkCarrySnapshotInitialized',
		address: escalationGame,
		args: [],
	})

export const readForkedEscrowByVaultAndOutcome = async (client: ReadClient, escalationGame: AccountAddress, vault: AccountAddress, outcome: QuestionOutcome): Promise<readonly [bigint, bigint, bigint, bigint]> => {
	const forkedEscrow = requireArray(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getForkedEscrowByVaultAndOutcome',
			address: escalationGame,
			args: [vault, outcome],
		}),
		'Forked escrow by vault and outcome',
	)
	return [requireBigInt(forkedEscrow[0], 'Forked escrow source principal'), requireBigInt(forkedEscrow[1], 'Forked escrow transferred principal'), requireBigInt(forkedEscrow[2], 'Forked escrow child REP'), requireBigInt(forkedEscrow[3], 'Forked escrow transferred child REP')]
}

type CarryLeaf = {
	depositor: AccountAddress
	amountAttoRep: bigint
	parentDepositIndex: bigint
	sourceNodeId: bigint
}

export const readCarryLeafPage = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome, startNodeId: bigint, maxEntries: bigint): Promise<readonly [CarryLeaf[], bigint]> => {
	const carryLeafPage = requireArray(
		await client.readContract({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			functionName: 'getCarryLeafPageByOutcome',
			address: escalationGame,
			args: [outcome, startNodeId, maxEntries],
		}),
		'Carry leaf page',
	)
	const leaves = requireArray(carryLeafPage[0], 'Carry leaf page leaves').map((leaf: unknown) => ({
		depositor: requireAddress(getTupleField(leaf, 0, 'depositor', 'Carry leaf'), 'Carry leaf depositor'),
		amountAttoRep: requireBigInt(getTupleField(leaf, 1, 'amountAttoRep', 'Carry leaf'), 'Carry leaf amount'),
		parentDepositIndex: requireBigInt(getTupleField(leaf, 2, 'parentDepositIndex', 'Carry leaf'), 'Carry leaf parent deposit index'),
		sourceNodeId: requireBigInt(getTupleField(leaf, 4, 'sourceNodeId', 'Carry leaf'), 'Carry leaf source node id'),
	}))
	const nextNodeId = requireBigInt(carryLeafPage[1], 'Carry leaf page next node id')
	return [leaves, nextNodeId]
}

export const readProofConsumedCarriedDepositIndexes = async (client: ReadClient, escalationGame: AccountAddress, outcome: QuestionOutcome, startIndex: bigint, numberOfEntries: bigint) =>
	await client.readContract({
		abi: statoblast_EscalationGame_EscalationGame.abi,
		functionName: 'getProofConsumedCarriedDepositIndexesByOutcome',
		address: escalationGame,
		args: [outcome, startIndex, numberOfEntries],
	})
