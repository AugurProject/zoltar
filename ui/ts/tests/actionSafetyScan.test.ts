import { describe, expect, test } from 'bun:test'
import { scanActionSafetySources } from '../lib/actionSafetyScan.js'

describe('action safety scan', () => {
	test('rejects missing safety ids and unsafe guard helpers', () => {
		const findings = scanActionSafetySources()
		expect(findings).toEqual([])
	})
})
