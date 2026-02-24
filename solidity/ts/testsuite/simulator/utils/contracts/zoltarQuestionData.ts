import { ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact.js'
import { ReadClient, WriteClient } from '../viem.js'
import { getInfraContractAddresses } from './deployPeripherals.js'

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

export const getOutcomeLabels = async (readClient: ReadClient, questionId: bigint) => {
	let currentIndex = 0n
	const numberOfEntries = 30n
	let pages: string[] = []
	do {
		const newDeposits = (await readClient.readContract({
			abi: ZoltarQuestionData_ZoltarQuestionData.abi,
			functionName: 'getOutcomeLabels',
			address: getInfraContractAddresses().zoltarQuestionData,
			args: [questionId, currentIndex, numberOfEntries]
		})).filter((outcome) => outcome.length > 0)
		pages.push(...newDeposits)
		if (BigInt(newDeposits.length) !== numberOfEntries) break
		currentIndex += numberOfEntries
	} while(true)
	return pages
}

export const getQuestionData = async (client: ReadClient, questionId: bigint) => {
	const [title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit] =  await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'questions',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId],
	})
	return { questionId, title, description, startTime, endTime, numTicks, displayValueMin, displayValueMax, answerUnit }
}

export const getQuestionCreatedTimestamp = async (client: ReadClient, questionId: bigint) => {
	return await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'questionCreatedTimestamp',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId],
	})
}

export const getQuestionId = async (client: ReadClient, questionData: QuestionData) => {
	return await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionId',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [[questionData.title, questionData.description, questionData.startTime, questionData.endTime, questionData.numTicks, questionData.displayValueMin, questionData.displayValueMax, questionData.answerUnit]],
	})
}

export const createQuestion = async (client: WriteClient, questionData: QuestionData, outcomeLabels: string[]) => {
	return await client.writeContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'createQuestion',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [[questionData.title, questionData.description, questionData.startTime, questionData.endTime, questionData.numTicks, questionData.displayValueMin, questionData.displayValueMax, questionData.answerUnit], outcomeLabels],
	})
}

export const isValidAnswerOption = async (client: ReadClient, questionId: bigint, answer: bigint) => {
	return await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'isValidAnswerOption',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId, answer],
	})
}

export const getAnswerOptionName = async (client: ReadClient, questionId: bigint, answer: bigint) => {
	return await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getAnswerOptionName',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId, answer],
	})
}

export const combineUint256FromTwoWithInvalid = (invalid: boolean, firstPart: bigint, secondPart: bigint): bigint => {
	const oneHundredTwentyBitMask = (1n << 120n) - 1n
	const normalizedFirstPart = firstPart & oneHundredTwentyBitMask
	const normalizedSecondPart = secondPart & oneHundredTwentyBitMask
	const highestBit = invalid ? 0n : 1n
	const combinedValue = (highestBit << 255n) | (normalizedFirstPart << 120n) | normalizedSecondPart
	return combinedValue
}
