/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createMarketParameters } from '../lib/marketCreation.js'
import { sortStringArrayByKeccak } from '../lib/sortStringArrayByKeccak.js'
import type { MarketFormState } from '../types/app.js'

void describe('market creation helpers', () => {
	void test('categorical outcomes are sorted by the contract hash order before submission', () => {
		const form: MarketFormState = {
			answerUnit: '',
			categoricalOutcomes: 'Cherry\nApple\nBanana',
			description: 'test categorical description',
			displayValueMax: '0',
			displayValueMin: '0',
			endTime: '2000',
			marketType: 'categorical',
			numTicks: '0',
			title: 'test categorical question',
			startTime: '1000',
		}

		const parameters = createMarketParameters(form)

		expect(parameters.outcomeLabels).toEqual(sortStringArrayByKeccak(['Cherry', 'Apple', 'Banana']))
	})
})
