/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'

describe('documented protocol constants', () => {
	test('keeps Placeholder OpenOracle timing constants aligned with the implementation', async () => {
		const whitepaper = await Bun.file('docs/whitepaper_placeholder.html').text()

		expect(whitepaper).toContain('PRICE_VALID_FOR_SECONDS = 5 minutes')
		expect(whitepaper).toContain('<code>PRICE_VALID_FOR_SECONDS</code></td><td><code>5 minutes</code>')
		expect(whitepaper).toContain('OpenOracle <code>settlementTime</code></td><td><code>480</code>')
		expect(whitepaper).toContain('Settlement delay encoded as <code>40 * 12</code>.')
		expect(whitepaper).not.toContain('PRICE_VALID_FOR_SECONDS = 1 hour')
		expect(whitepaper).not.toContain('Settlement delay encoded as <code>15 * 12</code>.')
	})
})
