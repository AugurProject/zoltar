import { ReadClient, WriteClient } from '../viem.js'
import { getInfraContractAddresses } from './deployPeripherals.js'

type QuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	outcomeLabels: string[]
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

export const getQuestionData = async (client: ReadClient, questionId: bigint) => {
	[title, description, startTime, endTime, numTicks, outcomeLabels, displayValueMin, displayValueMax, answerUnit] =  await client.readContract({
		abi: QuestionData.abi,
		functionName: 'questions',
		address: getInfraContractAddresses().questionData,
		args: [questionId],
	})
	return { questionId, title, description, startTime, endTime, numTicks, outcomeLabels, displayValueMin, displayValueMax, answerUnit }
}

export const getQuestionCreatedTimestamp = async (client: ReadClient, questionId: bigint) => {
	return await client.readContract({
		abi: QuestionData.abi,
		functionName: 'getQuestionData',
		address: getInfraContractAddresses().questionData,
		args: [questionId],
	})
}

export const getQuestionId = async (client: ReadClient, questionData: QuestionData) => {
	return await client.readContract({
		abi: QuestionData.abi,
		functionName: 'getQuestionId',
		address: getInfraContractAddresses().questionData,
		args: [questionData.title, questionData.description, questionData.startTime, questionData.endTime, questionData.numTicks, questionData.outcomeLabels, questionData.displayValueMin, questionData.displayValueMax, questionData.answerUnit],
	})
}

export const createQuestion = async (client: WriteClient, questionData: QuestionData) => {
	return await client.writeContract({
		abi: QuestionData.abi,
		functionName: 'createQuestion',
		address: getInfraContractAddresses().questionData,
		args: [questionData.title, questionData.description, questionData.startTime, questionData.endTime, questionData.numTicks, questionData.outcomeLabels, questionData.displayValueMin, questionData.displayValueMax, questionData.answerUnit],
	})
}

export const isValidAnswerOption = async (client: ReadClient, questionId: bigint, answer: bigint) => {
	return await client.readContract({
		abi: QuestionData.abi,
		functionName: 'isValidAnswerOption',
		address: getInfraContractAddresses().questionData,
		args: [questionId, answer],
	})
}

export const getAnswerOptionName = async (client: ReadClient, questionId: bigint, answer: bigint) => {
	return await client.readContract({
		abi: QuestionData.abi,
		functionName: 'getAnswerOptionName',
		address: getInfraContractAddresses().questionData,
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
