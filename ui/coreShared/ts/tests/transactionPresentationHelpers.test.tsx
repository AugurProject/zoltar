import { describe, expect, test } from 'bun:test'
import { getPoolUniverseTransactionRows, humanizeTransactionAction } from '../transactions/transactionPresentations.js'

describe('shared transaction presentation helpers', () => {
	test('humanizes camel-case actions with protocol units', () => {
		expect(humanizeTransactionAction('depositRepToWethVault')).toBe('Deposit REP to WETH vault')
		expect(humanizeTransactionAction('migrateRepToZoltar')).toBe('Migrate REP to Zoltar')
		expect(humanizeTransactionAction('finalizeTruthAuction')).toBe('Finalize truth auction')
		expect(humanizeTransactionAction('Deploy contract through deterministic proxy')).toBe('Deploy contract through deterministic proxy')
		expect(humanizeTransactionAction('aggregate3')).toBe('Aggregate3')
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
