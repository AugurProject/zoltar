import { encodeAbiParameters, keccak256 } from 'viem'
import { ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { getInfraContractAddresses } from './deployPeripherals'

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
	let currentIndex = 0n
	const numberOfEntries = 30n
	const pages: string[] = []
	do {
		const newLabels = (
			await client.readContract({
				abi: ZoltarQuestionData_ZoltarQuestionData.abi,
				functionName: 'getOutcomeLabels',
				address: getInfraContractAddresses().zoltarQuestionData,
				args: [questionId, currentIndex, numberOfEntries],
			})
		).filter(outcome => outcome.length > 0)
		pages.push(...newLabels)
		if (BigInt(newLabels.length) !== numberOfEntries) break
		currentIndex += numberOfEntries
	} while (true)
	return pages
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
	const encodedData = encodeAbiParameters(
		[
			{
				type: 'tuple',
				components: [
					{ name: 'title', type: 'string' },
					{ name: 'description', type: 'string' },
					{ name: 'startTime', type: 'uint256' },
					{ name: 'endTime', type: 'uint256' },
					{ name: 'numTicks', type: 'uint256' },
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
	await writeContractAndWait(client, () => client.writeContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'createQuestion',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionData, outcomeLabels],
	}))

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
