/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	getDefaultForkAuctionFormState,
	getDefaultMarketFormState,
	getDefaultOpenOracleCreateFormState,
	getDefaultOpenOracleFormState,
	getDefaultReportingFormState,
	getDefaultSecurityPoolFormState,
	getDefaultSecurityVaultFormState,
	getDefaultTradingFormState,
	getDefaultZoltarMigrationFormState,
	parseBigIntInput,
	parseOptionalRepAmountInput,
	parseRepAmountInput,
	parseTimestampInput,
	parseTradingAmountInput,
} from '../../../features/markets/lib/marketForm.js'

describe('market form defaults and conversion helpers', () => {
	test('returns stable default form snapshots across all supported forms', () => {
		expect(getDefaultMarketFormState().marketType).toBe('binary')
		expect(getDefaultMarketFormState().categoricalOutcomes).toEqual(['Yes', 'No'])
		expect(getDefaultSecurityPoolFormState().securityMultiplier).toBe('2')
		expect(getDefaultSecurityVaultFormState().depositAmount).toBe('0')
		expect(getDefaultSecurityVaultFormState().stagedOperationTimeoutMinutes).toBe('5')
		expect(getDefaultReportingFormState().selectedOutcome).toBeUndefined()
		expect(getDefaultReportingFormState().selectedWithdrawDepositIndexesByOutcome).toEqual({ invalid: [], yes: [], no: [] })
		expect(getDefaultTradingFormState().selectedShareOutcome).toBe('yes')
		expect(getDefaultOpenOracleFormState().stateHash).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
		expect(getDefaultOpenOracleCreateFormState().multiplier).toBe('100')
		expect(getDefaultForkAuctionFormState().repMigrationOutcomes).toBe('yes')
		expect(getDefaultZoltarMigrationFormState().amount).toBe('0.0')
		expect(getDefaultZoltarMigrationFormState().outcomeIndexes).toBe('')
	})

	test('parses integers and rejects malformed decimal values', () => {
		expect(parseBigIntInput('10', 'Retention rate')).toBe(10n)
		expect(() => parseBigIntInput('abc', 'Retention rate')).toThrow('Retention rate must be a whole number')
		expect(parseBigIntInput('  11  ', 'Retention rate')).toBe(11n)
		expect(() => parseBigIntInput('  ', 'Retention rate')).toThrow('Retention rate is required')
	})

	test('parses REP amounts and propagates parsing errors', () => {
		expect(parseRepAmountInput('2.5', 'REP amount')).toBe(2500000000000000000n)
		expect(() => parseRepAmountInput('x', 'REP amount')).toThrow('REP amount must be a decimal number')
		expect(parseRepAmountInput(' 0.5 ', 'REP amount')).toBe(500000000000000000n)
		expect(parseOptionalRepAmountInput('')).toBeUndefined()
		expect(parseOptionalRepAmountInput('abc')).toBeUndefined()
		expect(parseOptionalRepAmountInput('1.25')).toBe(1_250_000_000_000_000_000n)
	})

	test('parses trading inputs as 18 decimal fixed-point values', () => {
		expect(parseTradingAmountInput('0.000000000000000001', 'Trade amount')).toBe(1n)
		expect(() => parseTradingAmountInput('abc', 'Trade amount')).toThrow('Trade amount must be a decimal number')
	})

	test('throws clear message for malformed timestamps and parses valid date strings', () => {
		expect(parseTimestampInput('2025-01-01T00:00:00Z', 'End time')).toBeGreaterThan(0n)
		expect(() => parseTimestampInput('nonsense', 'End time')).toThrow('End time is invalid')
	})
})
