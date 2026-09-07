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

export function assertQuestionCreatedEvent(questionData: QuestionIdentityData, outcomeOptions: readonly string[], questionId: bigint, createdTimestamp: bigint) {
	if (getQuestionId(questionData, outcomeOptions) !== questionId) throw new Error('QuestionCreated event has a mismatched deterministic question ID')
	if (createdTimestamp <= 0n) throw new Error('QuestionCreated event has an invalid creation timestamp')
	if (questionData.endTime < questionData.startTime) throw new Error('QuestionCreated event has an invalid question time range')
	if (outcomeOptions.length === 0) return
	if (questionData.numTicks !== 0n) throw new Error('QuestionCreated categorical question has nonzero ticks')
	if (questionData.displayValueMin !== 0n || questionData.displayValueMax !== 0n) throw new Error('QuestionCreated categorical question has a nonzero display range')
	if (questionData.answerUnit !== '') throw new Error('QuestionCreated categorical question has a nonempty answer unit')
	let previousHash = (1n << 256n) - 1n
	for (const outcomeOption of outcomeOptions) {
		if (outcomeOption.length === 0) throw new Error('QuestionCreated categorical question has an empty outcome label')
		const optionHash = BigInt(keccak256(encodeAbiParameters([{ type: 'string' }], [outcomeOption])))
		if (optionHash >= previousHash) throw new Error('QuestionCreated categorical outcome hashes are not descending')
		previousHash = optionHash
	}
}
