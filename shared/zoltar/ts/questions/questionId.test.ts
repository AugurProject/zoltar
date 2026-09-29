import { expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from './questionId.js'

const questionData = {
	title: 'Will it rain?',
	description: 'Resolves YES when it rains',
	startTime: 1_700_000_000n,
	endTime: 1_700_086_400n,
	numTicks: 0n,
	displayValueMin: 0n,
	displayValueMax: 0n,
	answerUnit: '',
}

test('question ids hash the ABI-encoded question data and outcome labels', () => {
	// Static fields occupy full words, so a uint256-widened tuple encodes identically for in-range values.
	const widenedTuple = {
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
	} as const
	const expected = BigInt(keccak256(encodeAbiParameters([widenedTuple, { type: 'string[]' }], [questionData, ['Yes', 'No']])))
	expect(getQuestionId(questionData, ['Yes', 'No'])).toBe(expected)
})

test('question ids distinguish question data and outcome labels', () => {
	const id = getQuestionId(questionData, ['Yes', 'No'])
	expect(getQuestionId({ ...questionData }, ['Yes', 'No'])).toBe(id)
	expect(getQuestionId({ ...questionData, answerUnit: 'USD' }, ['Yes', 'No'])).not.toBe(id)
	expect(getQuestionId(questionData, ['No', 'Yes'])).not.toBe(id)
})

test('question times use the contract uint48 width', () => {
	expect(() => getQuestionId({ ...questionData, endTime: 1n << 48n }, [])).toThrow()
	expect(getQuestionId({ ...questionData, endTime: (1n << 48n) - 1n }, [])).toBeTypeOf('bigint')
})
