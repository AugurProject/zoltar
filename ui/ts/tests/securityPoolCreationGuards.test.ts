/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getSecurityPoolCreateDisabledReason } from '../lib/securityPoolCreationGuards.js'
import type { MarketDetails } from '../types/contracts.js'

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

describe('security pool creation guards', () => {
	test('blocks creation for wallet, network, duplicate, and market-type prerequisites', () => {
		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: undefined,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: false,
				isMainnet: true,
				marketDetails: createMarketDetails(),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('Connect a wallet before creating a security pool.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: true,
				isMainnet: true,
				marketDetails: createMarketDetails(),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('A pool for this question and security multiplier already exists.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: false,
				isMainnet: true,
				marketDetails: createMarketDetails({ marketType: 'categorical' }),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('Security pools can only be created for binary markets.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: false,
				isMainnet: true,
				marketDetails: createMarketDetails(),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBeUndefined()
	})
})
