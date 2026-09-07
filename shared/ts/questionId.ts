import { encodeAbiParameters, keccak256 } from './ethereum.js'

export type QuestionIdentityData = Readonly<{
	answerUnit: string
	description: string
	displayValueMax: bigint
	displayValueMin: bigint
	endTime: bigint
	numTicks: bigint
	startTime: bigint
	title: string
}>

export function getQuestionId(questionData: QuestionIdentityData, outcomeOptions: readonly string[]) {
	if (outcomeOptions.length > 0) {
		const metadataDigest = keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'string[]' }], [questionData.title, questionData.description, outcomeOptions]))
		return BigInt(keccak256(encodeAbiParameters([{ type: 'uint48' }, { type: 'uint48' }, { type: 'bytes32' }], [questionData.startTime, questionData.endTime, metadataDigest])))
	}
	return BigInt(
		keccak256(
			encodeAbiParameters(
				[
					{
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
					},
					{ type: 'string[]' },
				],
				[questionData, outcomeOptions],
			),
		),
	)
}
