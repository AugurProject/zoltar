/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatScalarOutcomeLabel, getScalarOutcomeIndex, getScalarSliderProgress } from '../lib/scalarOutcome.js'

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
})
