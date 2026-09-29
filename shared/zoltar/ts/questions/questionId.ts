import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'

export type ZoltarQuestionData = {
	title: string
	description: string
	startTime: bigint
	endTime: bigint
	numTicks: bigint
	displayValueMin: bigint
	displayValueMax: bigint
	answerUnit: string
}

// Mirrors ZoltarQuestionData.QuestionData so ids match ZoltarQuestionData.getQuestionId.
const QUESTION_DATA_PARAMETER = {
	type: 'tuple',
	components: [
		{ name: 'title', type: 'string' },
		{ name: 'description', type: 'string' },
		{ name: 'startTime', type: 'uint48' },
		{ name: 'endTime', type: 'uint48' },
		{ name: 'numTicks', type: 'uint120' },
		{ name: 'displayValueMin', type: 'int256' },
		{ name: 'displayValueMax', type: 'int256' },
		{ name: 'answerUnit', type: 'string' },
	],
} as const

/** Question id as computed on chain: keccak256(abi.encode(questionData, outcomeOptions)). */
export function getQuestionId(questionData: ZoltarQuestionData, outcomeOptions: readonly string[]): bigint {
	return BigInt(keccak256(encodeAbiParameters([QUESTION_DATA_PARAMETER, { type: 'string[]' }], [questionData, outcomeOptions])))
}
