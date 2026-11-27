import { describe, expect, test } from 'bun:test'
import { formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor, isValidScalarOutcomeIndex } from './scalarOutcome'
import { combineScalarParityOutcomeIndex, getScalarParityQuestion, SCALAR_PARITY_ENCODING_FIXTURES, SCALAR_PARITY_LABEL_FIXTURES } from '../testing/scalarOutcomeParityFixtures'

describe('shared scalar outcome codec', () => {
	for (const fixture of SCALAR_PARITY_LABEL_FIXTURES) {
		test(`formats ${fixture.name}`, () => {
			const question = getScalarParityQuestion(fixture.questionName)
			expect(formatScalarOutcomeLabel(question, fixture.tickIndex)).toBe(fixture.expectedLabel)
			expect(formatScalarOutcomeIndexLabel(question, getScalarOutcomeIndex(question, fixture.tickIndex))).toBe(fixture.expectedLabel)
		})
	}

	for (const fixture of SCALAR_PARITY_ENCODING_FIXTURES) {
		test(`decodes ${fixture.name}`, () => {
			const question = getScalarParityQuestion(fixture.questionName)
			const outcomeIndex = combineScalarParityOutcomeIndex(fixture.invalid, fixture.firstPart, fixture.secondPart)
			expect(getScalarOutcomeIndexDescriptor(question, outcomeIndex)).toEqual(fixture.expectedDescriptor)
			if (fixture.expectedDescriptor.kind === 'malformed') expect(() => formatScalarOutcomeIndexLabel(question, outcomeIndex)).toThrow('malformed')
			else expect(formatScalarOutcomeIndexLabel(question, outcomeIndex)).toBe(fixture.expectedLabel)
		})
	}
})

describe('scalar uint120 question boundary', () => {
	const question = { answerUnit: '', displayValueMin: 0n, displayValueMax: 1n, numTicks: 1n << 120n }

	test('rejects tick counts that would silently truncate both answer parts', () => {
		expect(() => getScalarOutcomeIndex(question, 0n)).toThrow('The number of scalar ticks is out of range.')
		expect(() => getScalarOutcomeIndex(question, question.numTicks)).toThrow('The number of scalar ticks is out of range.')
	})

	test('rejects an impossible question even when two encodable parts sum to its tick count', () => {
		const answer = (1n << 255n) | (1n << 239n) | (1n << 119n)
		expect(getScalarOutcomeIndexDescriptor(question, answer)).toEqual({ kind: 'malformed' })
	})

	test('keeps both endpoints encodable at the largest Solidity tick count', () => {
		const boundary = { ...question, numTicks: question.numTicks - 1n }
		for (const tick of [0n, boundary.numTicks]) {
			expect(getScalarOutcomeIndexDescriptor(boundary, getScalarOutcomeIndex(boundary, tick))).toEqual({ kind: 'tick', tickIndex: tick })
		}
	})
})

test('#1390 identifies dense ticks in both raw and encoded outcome labels', () => {
	const question = { answerUnit: 'units', displayValueMin: 0n, displayValueMax: 1n, numTicks: 2n }
	const labels = ['0 units', '0 units (tick 1 of 2)', '0.000000000000000001 units']
	for (const [index, label] of labels.entries()) {
		const tick = BigInt(index)
		expect(formatScalarOutcomeLabel(question, tick)).toBe(label)
		expect(formatScalarOutcomeIndexLabel(question, getScalarOutcomeIndex(question, tick))).toBe(label)
	}
})

test('unregistered zero-tick questions accept only the canonical Invalid sentinel (#1755)', () => {
	const question = { answerUnit: '', displayValueMin: 0n, displayValueMax: 0n, numTicks: 0n }
	expect(getScalarOutcomeIndexDescriptor(question, 0n)).toEqual({ kind: 'invalid' })
	expect(isValidScalarOutcomeIndex(question, 0n)).toBe(true)
	expect(formatScalarOutcomeIndexLabel(question, 0n)).toBe('Invalid')
	for (const answer of [1n, 1n << 240n, 1n << 255n, -1n, 1n << 256n]) {
		expect(isValidScalarOutcomeIndex(question, answer)).toBe(false)
		expect(() => formatScalarOutcomeIndexLabel(question, answer)).toThrow('malformed')
	}
})
