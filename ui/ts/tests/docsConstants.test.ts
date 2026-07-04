/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'

describe('documented protocol constants', () => {
	test('keeps Placeholder OpenOracle timing constants aligned with the implementation', async () => {
		const whitepaper = await Bun.file('docs/whitepaper_placeholder.html').text()

		expect(whitepaper).toContain('PRICE_VALID_FOR_SECONDS = 5 minutes')
		expect(whitepaper).toMatch(/<td><code>PRICE_VALID_FOR_SECONDS<\/code><\/td>\s*<td><code>5 minutes<\/code><\/td>/)
		expect(whitepaper).toMatch(/OpenOracle <code>settlementTime<\/code><\/td>\s*<td>\s*<math aria-label="40 times 12" data-source="40 \\cdot 12"/)
		expect(whitepaper).toContain('Settlement delay encoded as <code>480</code>.')
		expect(whitepaper).not.toContain('PRICE_VALID_FOR_SECONDS = 1 hour')
		expect(whitepaper).not.toContain('Settlement delay encoded as <code>15 \\cdot 12</code>.')
	})
})
