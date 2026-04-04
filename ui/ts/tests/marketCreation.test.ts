/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from 'viem'
import { createMarketParameters } from '../lib/marketCreation.js'
import type { MarketFormState } from '../types/app.js'

function getOutcomeHash(label: string) {
	return keccak256(encodeAbiParameters([{ type: 'string' }], [label]))
}

function sortOutcomesByContractOrder(labels: string[]) {
	return [...labels].sort((left, right) => {
		const leftHash = getOutcomeHash(left)
		const rightHash = getOutcomeHash(right)
		if (leftHash > rightHash) return -1
		if (leftHash < rightHash) return 1
		return 0
	})
}

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

		expect(parameters.outcomeLabels).toEqual(sortOutcomesByContractOrder(['Cherry', 'Apple', 'Banana']))
	})
})
