import { decodeEventLog, encodeAbiParameters, keccak256 } from '@zoltar/shared/ethereum'
import { ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { getInfraContractAddresses } from './deployStatoblast'

const ignorableLogDecodeErrorNames = new Set(['AbiEventSignatureNotFoundError', 'DecodeLogDataMismatch', 'DecodeLogTopicsMismatch'])

function isIgnorableLogDecodeError(error: unknown) {
	return error instanceof Error && ignorableLogDecodeErrorNames.has(error.name)
}

type QuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

export const getOutcomeLabels = async (client: ReadClient, questionId: bigint) => {
	const logs = await client.getLogs({ address: getInfraContractAddresses().zoltarQuestionData, fromBlock: 0n })
	for (const log of logs) {
		try {
			const decoded = decodeEventLog({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, data: log.data, topics: log.topics })
			if (decoded.eventName === 'QuestionCreated' && decoded.args.questionId === questionId) return [...decoded.args.outcomeOptions]
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return []
}

export const getQuestionData = async (client: ReadClient, questionId: bigint) => {
	const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] = await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'questions',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId],
	})
	return { questionId, title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }
}

export const getQuestionId = (questionData: QuestionData, outcomeOptions: readonly string[]): bigint => {
	if (outcomeOptions.length > 0) {
		const metadataDigest = keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'string[]' }], [questionData.title, questionData.description, outcomeOptions]))
		return BigInt(keccak256(encodeAbiParameters([{ type: 'uint48' }, { type: 'uint48' }, { type: 'bytes32' }], [questionData.startTime, questionData.endTime, metadataDigest])))
	}
	const encodedData = encodeAbiParameters(
		[
			{
				type: 'tuple',
				components: [
					{ name: 'title', type: 'string' },
					{ name: 'description', type: 'string' },
					{ name: 'startTime', type: 'uint256' },
					{ name: 'endTime', type: 'uint256' },
					{ name: 'numTicks', type: 'uint120' },
					{ name: 'displayValueMin', type: 'int256' },
					{ name: 'displayValueMax', type: 'int256' },
					{ name: 'answerUnit', type: 'string' },
				],
			},
			{ type: 'string[]' },
		],
		[questionData, outcomeOptions],
	)
	return BigInt(keccak256(encodedData))
}

export const createQuestion = async (client: WriteClient, questionData: QuestionData, outcomeLabels: string[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'createQuestion',
			address: getInfraContractAddresses().zoltarQuestionData,
			args: [questionData, outcomeLabels],
		}),
	)

export const isMalformedAnswerOption = async (client: ReadClient, questionId: bigint, answer: bigint) =>
	await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'isMalformedAnswerOption',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId, answer],
	})

export const getAnswerOptionName = async (client: ReadClient, questionId: bigint, answer: bigint) =>
	await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getAnswerOptionName',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId, answer],
	})

export const combineUint256FromTwoWithInvalid = (invalid: boolean, firstPart: bigint, secondPart: bigint): bigint => {
	const PART_BIT_LENGTH = 120n
	const TOTAL_BITS = 256n

	const oneHundredTwentyBitMask = (1n << PART_BIT_LENGTH) - 1n
	const normalizedFirstPart = firstPart & oneHundredTwentyBitMask
	const normalizedSecondPart = secondPart & oneHundredTwentyBitMask
	const highestBit = invalid ? 0n : 1n
	const combinedValue = (highestBit << (TOTAL_BITS - 1n)) | (normalizedFirstPart << PART_BIT_LENGTH) | normalizedSecondPart
	return combinedValue
}
