import { describe, expect, test } from 'bun:test'
import { getInitialPriceDeviation, getInitialPriceWarning } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/initialPriceReference.js'

const unit = 10n ** 18n
const reference = 300n * unit

describe('initial report price reference check', () => {
	test('accepts prices within 2× of the reference and skips the check without a reference', () => {
		expect(getInitialPriceDeviation(reference, reference)).toBeUndefined()
		expect(getInitialPriceDeviation(600n * unit, reference)).toBeUndefined()
		expect(getInitialPriceDeviation(150n * unit, reference)).toBeUndefined()
		expect(getInitialPriceDeviation(10n * unit, undefined)).toBeUndefined()
		expect(getInitialPriceDeviation(10n * unit, 0n)).toBeUndefined()
		expect(getInitialPriceDeviation(undefined, reference)).toBeUndefined()
		expect(getInitialPriceWarning(reference, reference)).toBeUndefined()
	})
	test('names a price entered as ETH per REP as inverted', () => {
		// 1 / 300 ETH per REP, rounded the way a user would type it.
		const inverted = 3_333_333_333_333_333n
		expect(getInitialPriceDeviation(inverted, reference)).toBe('inverted')
		expect(getInitialPriceWarning(inverted, reference)).toBe('This looks inverted (ETH per REP). Enter REP per ETH; the last known price is 300 REP per ETH.')
	})
	test('warns about prices more than 2× away from the reference', () => {
		expect(getInitialPriceDeviation(601n * unit, reference)).toBe('above')
		expect(getInitialPriceDeviation(149n * unit, reference)).toBe('below')
		expect(getInitialPriceWarning(3000n * unit, reference)).toBe('More than double the last known price of 300 REP per ETH. Check the price before sending.')
		expect(getInitialPriceWarning(30n * unit, reference)).toBe('Less than half the last known price of 300 REP per ETH. Check the price before sending.')
	})
	test('does not call a plausible price inverted when the reference is near 1 REP per ETH', () => {
		expect(getInitialPriceDeviation(unit, unit)).toBeUndefined()
		expect(getInitialPriceDeviation(unit / 10n, unit)).toBe('below')
	})
})
