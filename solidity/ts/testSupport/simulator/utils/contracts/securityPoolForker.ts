import { statoblast_SecurityPoolForker_SecurityPoolForker } from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployStatoblast'
import { contractExists, requireBigInt } from '../utilities'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
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

export const initiateSecurityPoolFork = async (client: WriteClient, securityPoolAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'initiateSecurityPoolFork',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
	)

export const getQuestionOutcome = async (client: ReadClient, securityPoolAddress: Address): Promise<QuestionOutcome> => {
	if (!(await contractExists(client, securityPoolAddress))) return QuestionOutcome.None
	return requireQuestionOutcome(
		await client.readContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getQuestionOutcome',
			address: getInfraContractAddresses().securityPoolForker,
			args: [securityPoolAddress],
		}),
		'Question outcome',
	)
}
