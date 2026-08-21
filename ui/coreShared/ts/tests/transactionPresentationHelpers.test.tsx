import { describe, expect, test } from 'bun:test'
import { getPoolUniverseTransactionRows, humanizeTransactionAction } from '../lib/transactionPresentations.js'

describe('shared transaction presentation helpers', () => {
	test('humanizes camel-case actions with protocol units', () => {
		expect(humanizeTransactionAction('depositRepToWethVault')).toBe('Deposit REP To WETH Vault')
	})

	test('builds the common security-pool identity row', () => {
		const rows = getPoolUniverseTransactionRows({ securityPoolAddress: `0x${'12'.repeat(20)}`, universeId: 7n })
		expect(rows).toHaveLength(1)
		expect(rows?.[0]?.identityKey).toBe('security-pool')
		expect(rows?.[0]?.value).toBeDefined()
	})

	test('preserves undefined versus an explicitly empty context', () => {
		expect(getPoolUniverseTransactionRows(undefined)).toBeUndefined()
		expect(getPoolUniverseTransactionRows({})).toEqual([])
	})
})
