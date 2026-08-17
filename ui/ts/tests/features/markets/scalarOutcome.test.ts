/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { SCALAR_PARITY_ENCODING_FIXTURES, SCALAR_PARITY_LABEL_FIXTURES, combineScalarParityOutcomeIndex, describeScalarParityOutcomeIndex, formatScalarParityOutcomeName, getScalarParityQuestion } from '@zoltar/shared/testing/scalarOutcomeParityFixtures'
import { formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarDisplayValue, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor, getScalarSliderProgress, getScalarTickIndexForDisplayValue, isValidScalarOutcomeIndex, parseScalarFormInputs } from '../../../features/markets/lib/scalarOutcome.js'

const scalarQuestion = {
	answerUnit: 'km',
	displayValueMax: 10n * 10n ** 18n,
	displayValueMin: 0n,
	numTicks: 10n,
}
const SCALAR_RESERVED_BITS_MASK = ((1n << 15n) - 1n) << 240n

function withScalarReservedBits(answer: bigint, reservedBits = 1n) {
	return answer | ((reservedBits << 240n) & SCALAR_RESERVED_BITS_MASK)
}

void describe('scalar outcome helpers', () => {
	void test('rejects zero tick scalar questions', () => {
		const invalidQuestion = { ...scalarQuestion, numTicks: 0n }
		expect(() => getScalarSliderProgress(0n, invalidQuestion.numTicks)).toThrow('Scalar question numTicks must be positive')
		expect(() => getScalarOutcomeIndex(invalidQuestion, 0n)).toThrow('Scalar question numTicks must be positive')
		expect(() => formatScalarOutcomeLabel(invalidQuestion, 0n)).toThrow('Scalar question numTicks must be positive')
	})

	void test('rejects out of range ticks', () => {
		expect(() => getScalarSliderProgress(11n, scalarQuestion.numTicks)).toThrow('Tick index is out of range')
		expect(() => getScalarOutcomeIndex(scalarQuestion, 11n)).toThrow('Tick index is out of range')
		expect(() => formatScalarOutcomeLabel(scalarQuestion, 11n)).toThrow('Tick index is out of range')
	})

	void test('parses scalar form decimals into contract values', () => {
		expect(parseScalarFormInputs({ scalarMin: '1', scalarMax: '10', scalarIncrement: '0.1' })).toEqual({
			displayValueMax: 10n * 10n ** 18n,
			displayValueMin: 1n * 10n ** 18n,
			numTicks: 90n,
		})
	})

	void test('round-trips canonical non-divisible and negative scalar display values', () => {
		const nonDivisibleQuestion = { answerUnit: '', displayValueMin: 0n, displayValueMax: 10n, numTicks: 3n }
		expect([0n, 1n, 2n, 3n].map(tick => getScalarDisplayValue(nonDivisibleQuestion, tick))).toEqual([0n, 3n, 6n, 10n])
		expect([0n, 3n, 6n, 10n].map(value => getScalarTickIndexForDisplayValue(nonDivisibleQuestion, value))).toEqual([0n, 1n, 2n, 3n])
		expect(getScalarTickIndexForDisplayValue(nonDivisibleQuestion, 9n)).toBeUndefined()

		const negativeQuestion = { ...nonDivisibleQuestion, displayValueMin: -5n, displayValueMax: 5n }
		expect([0n, 1n, 2n, 3n].map(tick => getScalarDisplayValue(negativeQuestion, tick))).toEqual([-5n, -2n, 1n, 5n])
		expect([5n, -5n, -2n, 1n].map(value => getScalarTickIndexForDisplayValue(negativeQuestion, value))).toEqual([3n, 0n, 1n, 2n])
	})

	void test('finds canonical endpoints when tick count exceeds both the range and safe integers', () => {
		const hugeTickQuestion = { answerUnit: '', displayValueMin: 0n, displayValueMax: 1n, numTicks: BigInt(Number.MAX_SAFE_INTEGER) + 10n }
		expect(getScalarTickIndexForDisplayValue(hugeTickQuestion, 0n)).toBe(0n)
		expect(getScalarTickIndexForDisplayValue(hugeTickQuestion, 1n)).toBe(hugeTickQuestion.numTicks)
		expect(getScalarDisplayValue(hugeTickQuestion, hugeTickQuestion.numTicks)).toBe(1n)
	})

	void test('describes valid, invalid, and malformed scalar outcome indexes', () => {
		const scalarOutcomeIndex = getScalarOutcomeIndex(scalarQuestion, 4n)
		expect(getScalarOutcomeIndexDescriptor(scalarQuestion, scalarOutcomeIndex)).toEqual({
			kind: 'tick',
			tickIndex: 4n,
		})
		expect(getScalarOutcomeIndexDescriptor(scalarQuestion, 0n)).toEqual({
			kind: 'invalid',
		})
		expect(getScalarOutcomeIndexDescriptor(scalarQuestion, 5n)).toEqual({
			kind: 'malformed',
		})
		expect(isValidScalarOutcomeIndex(scalarQuestion, scalarOutcomeIndex)).toBe(true)
		expect(isValidScalarOutcomeIndex(scalarQuestion, 0n)).toBe(true)
		expect(isValidScalarOutcomeIndex(scalarQuestion, 5n)).toBe(false)
		expect(formatScalarOutcomeIndexLabel(scalarQuestion, scalarOutcomeIndex)).toBe('4\u00a0km')
		expect(formatScalarOutcomeIndexLabel(scalarQuestion, 0n)).toBe('Invalid')
		expect(() => formatScalarOutcomeIndexLabel(scalarQuestion, 5n)).toThrow('Scalar outcome index is malformed')
	})

	void test('treats reserved-bit scalar aliases as malformed', () => {
		const canonicalOutcomeIndex = getScalarOutcomeIndex(scalarQuestion, 4n)
		const aliasedOutcomeIndex = withScalarReservedBits(canonicalOutcomeIndex, 0x1234n)
		const aliasedInvalidOutcomeIndex = withScalarReservedBits(0n, 0x7fffn)

		expect(getScalarOutcomeIndexDescriptor(scalarQuestion, aliasedOutcomeIndex)).toEqual({ kind: 'malformed' })
		expect(getScalarOutcomeIndexDescriptor(scalarQuestion, aliasedInvalidOutcomeIndex)).toEqual({ kind: 'malformed' })
		expect(isValidScalarOutcomeIndex(scalarQuestion, aliasedOutcomeIndex)).toBe(false)
		expect(() => formatScalarOutcomeIndexLabel(scalarQuestion, aliasedOutcomeIndex)).toThrow('Scalar outcome index is malformed')
	})

	void test('rejects scalar inputs that do not divide into whole ticks', () => {
		expect(() => parseScalarFormInputs({ scalarMin: '1', scalarMax: '10', scalarIncrement: '0.4' })).toThrow('Scalar min, max, and increment do not produce a whole number of ticks')
	})

	void test('rejects scalar endpoints outside the signed 256-bit contract range', () => {
		expect(() => parseScalarFormInputs({ scalarMin: '0', scalarMax: (1n << 256n).toString(), scalarIncrement: '1' })).toThrow('Scalar max is outside the supported range')
		expect(() => parseScalarFormInputs({ scalarMin: `-${(1n << 256n).toString()}`, scalarMax: '0', scalarIncrement: '1' })).toThrow('Scalar min is outside the supported range')
	})

	void test('rejects tick counts outside the unsigned 120-bit contract range', () => {
		expect(() => parseScalarFormInputs({ scalarMin: '0', scalarMax: (1n << 120n).toString(), scalarIncrement: '1' })).toThrow('Scalar range and increment produce too many ticks. Narrow the range or increase the increment.')
	})

	void test('rejects UI-created tick counts that a native range input cannot represent exactly', () => {
		expect(() => parseScalarFormInputs({ scalarMin: '0', scalarMax: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(), scalarIncrement: '1' })).toThrow('Scalar range and increment produce too many ticks. Narrow the range or increase the increment.')
	})

	for (const fixture of SCALAR_PARITY_LABEL_FIXTURES) {
		void test(`formats scalar parity fixture: ${fixture.name}`, () => {
			const question = getScalarParityQuestion(fixture.questionName)
			const outcomeIndex = getScalarOutcomeIndex(question, fixture.tickIndex)
			const expectedUiLabel = fixture.expectedLabel.replace(' ', '\u00a0')
			expect(formatScalarOutcomeLabel(question, fixture.tickIndex)).toBe(expectedUiLabel)
			expect(formatScalarOutcomeIndexLabel(question, outcomeIndex)).toBe(expectedUiLabel)
		})
	}

	for (const fixture of SCALAR_PARITY_ENCODING_FIXTURES) {
		void test(`describes scalar encoding fixture: ${fixture.name}`, () => {
			const question = getScalarParityQuestion(fixture.questionName)
			const outcomeIndex = combineScalarParityOutcomeIndex(fixture.invalid, fixture.firstPart, fixture.secondPart)
			const descriptor = getScalarOutcomeIndexDescriptor(question, outcomeIndex)
			expect(descriptor).toEqual(fixture.expectedDescriptor)
			expect(descriptor).toEqual(describeScalarParityOutcomeIndex(question, outcomeIndex))
			expect(isValidScalarOutcomeIndex(question, outcomeIndex)).toBe(fixture.expectedDescriptor.kind !== 'malformed')
			expect(formatScalarParityOutcomeName(question, outcomeIndex)).toBe(fixture.expectedLabel)
			if (fixture.expectedDescriptor.kind === 'malformed') {
				expect(() => formatScalarOutcomeIndexLabel(question, outcomeIndex)).toThrow('Scalar outcome index is malformed')
			} else {
				expect(formatScalarOutcomeIndexLabel(question, outcomeIndex)).toBe(fixture.expectedLabel.replace(' ', '\u00a0'))
			}
		})
	}
})
