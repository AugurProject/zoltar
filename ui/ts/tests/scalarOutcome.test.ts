/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarSliderProgress, parseScalarFormInputs } from '../lib/scalarOutcome.js'

const scalarQuestion = {
	answerUnit: 'km',
	displayValueMax: 10n,
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

	void test('rejects scalar inputs that do not divide into whole ticks', () => {
		expect(() => parseScalarFormInputs({ scalarMin: '1', scalarMax: '10', scalarIncrement: '0.4' })).toThrow('Scalar min, max, and increment do not produce a whole number of ticks')
	})
})
