/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createMarketParameters, validateMarketForm } from '../lib/marketCreation.js'
import { sortStringArrayByKeccak } from '../lib/sortStringArrayByKeccak.js'
import type { MarketFormState } from '../types/app.js'

void describe('market creation helpers', () => {
	void test('categorical outcomes are sorted by the contract hash order before submission', () => {
		const form: MarketFormState = {
			answerUnit: '',
			categoricalOutcomes: 'Cherry\nApple\nBanana',
			description: 'test categorical description',
			endTime: '2000',
			marketType: 'categorical',
			scalarIncrement: '1',
			scalarMax: '0',
			scalarMin: '0',
			title: 'test categorical question',
			startTime: '1000',
		}

		const parameters = createMarketParameters(form)

		expect(parameters.outcomeLabels).toEqual(sortStringArrayByKeccak(['Cherry', 'Apple', 'Banana']))
	})

	void test('scalar inputs map to the expected contract values', () => {
		const form: MarketFormState = {
			answerUnit: '$',
			categoricalOutcomes: 'Yes\nNo',
			description: 'test scalar description',
			endTime: '2000',
			marketType: 'scalar',
			scalarIncrement: '0.1',
			scalarMax: '10',
			scalarMin: '1',
			title: 'test scalar question',
			startTime: '1000',
		}

		const parameters = createMarketParameters(form)

		expect(parameters.questionData.displayValueMin).toBe(1n * 10n ** 18n)
		expect(parameters.questionData.displayValueMax).toBe(10n * 10n ** 18n)
		expect(parameters.questionData.numTicks).toBe(90n)
	})

	void test('validation reports missing required fields and impossible scalar combinations', () => {
		const validation = validateMarketForm({
			answerUnit: '$',
			categoricalOutcomes: 'Yes\nNo',
			description: 'test scalar description',
			endTime: '',
			marketType: 'scalar',
			scalarIncrement: '0.4',
			scalarMax: '10',
			scalarMin: '1',
			title: '',
			startTime: '1000',
		})

		expect(validation.isValid).toBe(false)
		expect(validation.fieldErrors.title).toBe('Title is required')
		expect(validation.fieldErrors.endTime).toBe('End time is required')
		expect(validation.fieldErrors.scalarMin).toBe('Scalar min, max, and increment do not produce a whole number of ticks')
		expect(validation.notice).toContain('Missing required fields: Title, End Time')
		expect(validation.notice).toContain('Fix invalid fields: Scalar min, max, and increment do not produce a whole number of ticks')
	})
})
