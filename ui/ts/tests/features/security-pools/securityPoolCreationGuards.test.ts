/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS } from '@zoltar/shared/oracleInitialReport'
import { getInitialReportPriorityFeeValidationMessage, getSecurityPoolCreateDisabledReason } from '../../../features/security-pools/lib/securityPoolCreationGuards.js'
import type { MarketDetails } from '../../../types/contracts.js'

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
				initialReportPriorityFeeGwei: '10',
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
				duplicateOriginPoolExists: false,
				initialReportPriorityFeeGwei: '10',
				isMainnet: false,
				marketDetails: createMarketDetails(),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('Switch to Ethereum mainnet.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: true,
				initialReportPriorityFeeGwei: '10',
				isMainnet: true,
				marketDetails: createMarketDetails(),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('A pool for this question, security multiplier, and priority fee already exists.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: false,
				initialReportPriorityFeeGwei: '10',
				isMainnet: true,
				marketDetails: undefined,
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('Enter an exact binary Yes / No question before creating a pool.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: false,
				initialReportPriorityFeeGwei: '10',
				isMainnet: true,
				marketDetails: createMarketDetails({ marketType: 'categorical' }),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBe('Security pools can only be created for exact binary Yes / No questions.')

		expect(
			getSecurityPoolCreateDisabledReason({
				accountAddress: zeroAddress,
				checkingDuplicateOriginPool: false,
				duplicateOriginPoolExists: false,
				initialReportPriorityFeeGwei: '10',
				isMainnet: true,
				marketDetails: createMarketDetails(),
				securityPoolCreating: false,
				zoltarUniverseHasForked: false,
			}),
		).toBeUndefined()
	})

	test('validates the initial-report priority fee before submission', () => {
		expect(getInitialReportPriorityFeeValidationMessage('')).toBe('Enter an initial-report priority fee in gwei.')
		expect(getInitialReportPriorityFeeValidationMessage('abc')).toBe('Enter a gwei value with at most 9 decimal places.')
		expect(getInitialReportPriorityFeeValidationMessage('0.0000000001')).toBe('Enter a gwei value with at most 9 decimal places.')
		expect(getInitialReportPriorityFeeValidationMessage('0')).toBe('Initial-report priority fee must be greater than 0 gwei.')
		expect(getInitialReportPriorityFeeValidationMessage('0.000000001')).toBeUndefined()
		expect(getInitialReportPriorityFeeValidationMessage((MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS / 10n ** 9n).toString())).toBeUndefined()
		expect(getInitialReportPriorityFeeValidationMessage((MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS / 10n ** 9n + 1n).toString())).toBe('Initial-report priority fee is too large for Open Oracle report limits.')
	})
})
