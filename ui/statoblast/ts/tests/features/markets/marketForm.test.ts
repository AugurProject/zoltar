/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getDefaultForkAuctionFormState, getDefaultMarketFormState, getDefaultSecurityPoolFormState, getDefaultSecurityVaultFormState, getDefaultTradingFormState } from '@zoltar/ui-statoblast-shared/features/markets/lib/marketForm.js'

describe('market form defaults', () => {
	test('returns stable default form snapshots across all supported forms', () => {
		expect(getDefaultMarketFormState().marketType).toBe('binary')
		// Categorical outcomes start empty: a default Yes/No pair would create the Binary question's ID.
		expect(getDefaultMarketFormState().categoricalOutcomes).toEqual(['', ''])
		expect(getDefaultSecurityPoolFormState().statoblastSecurityMultiplierBps).toBe('2')
		expect(getDefaultSecurityPoolFormState().initialReportPriorityFeeNanoEth).toBe('10')
		expect(getDefaultSecurityVaultFormState()).toEqual({ selectedVaultOwner: '', securityPoolAddress: '' })
		expect(getDefaultTradingFormState().selectedShareOutcome).toBe('yes')
		expect(getDefaultTradingFormState().completeSetAmount).toBe('')
		expect(getDefaultTradingFormState().redeemAmount).toBe('')
		expect(getDefaultForkAuctionFormState().repMigrationOutcomes).toBe('yes')
	})
})
