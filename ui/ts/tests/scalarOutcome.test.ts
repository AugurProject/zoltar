/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatScalarOutcomeIndexLabel, formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarOutcomeIndexDescriptor, getScalarSliderProgress, isValidScalarOutcomeIndex, parseScalarFormInputs } from '../lib/scalarOutcome.js'

const scalarQuestion = {
	answerUnit: 'km',
	displayValueMax: 10n * 10n ** 18n,
	displayValueMin: 0n,
	numTicks: 10n,
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
		expect(formatScalarOutcomeIndexLabel(scalarQuestion, scalarOutcomeIndex)).toBe('4 km')
		expect(formatScalarOutcomeIndexLabel(scalarQuestion, 0n)).toBe('Invalid')
		expect(() => formatScalarOutcomeIndexLabel(scalarQuestion, 5n)).toThrow('Scalar outcome index is malformed')
	})

	void test('rejects scalar inputs that do not divide into whole ticks', () => {
		expect(() => parseScalarFormInputs({ scalarMin: '1', scalarMax: '10', scalarIncrement: '0.4' })).toThrow('Scalar min, max, and increment do not produce a whole number of ticks')
	})
})
