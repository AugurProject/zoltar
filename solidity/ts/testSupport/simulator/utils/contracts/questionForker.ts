import { statoblast_QuestionForker_QuestionForker } from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployStatoblast'
import { contractExists, requireBigInt } from '../utilities'
import { type ReadClient, type WriteClient, writeContractAndWait } from '../clients'
import type { Address } from '@zoltar/core-shared/evm/ethereum'

function requireQuestionOutcome(value: unknown, context: string): QuestionOutcome {
	const outcome = requireBigInt(value, context)
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
			throw new Error(`Unexpected question outcome: ${outcome.toString()}`)
	}
}

export const initiateQuestionLedgerFork = async (client: WriteClient, questionLedgerAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_QuestionForker_QuestionForker.abi,
			functionName: 'initiateQuestionLedgerFork',
			address: getInfraContractAddresses().questionForker,
			args: [questionLedgerAddress],
		}),
	)

export const getQuestionOutcome = async (client: ReadClient, questionLedgerAddress: Address): Promise<QuestionOutcome> => {
	if (!(await contractExists(client, questionLedgerAddress))) return QuestionOutcome.None
	return requireQuestionOutcome(
		await client.readContract({
			abi: statoblast_QuestionForker_QuestionForker.abi,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().questionForker,
			args: [questionLedgerAddress],
		}),
		'Question outcome',
	)
}
