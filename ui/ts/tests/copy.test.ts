import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import * as marketCopy from '../copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as securityPoolCopy from '../copy/securityPool.js'

test('fork migration empty states are complete templates', () => {
	expect(forkAuctionCopy.formatNoUnresolvedDeposits('YES')).toBe('No yes unresolved deposits remain for this wallet.')
	expect(forkAuctionCopy.formatNoMigratableEscalationDeposits('Yes')).toBe('No Yes escalation deposits are currently available to migrate for this wallet.')
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatPoolPageSummary(5, 12)).toBe('Matches: 5 of 12 pools on this page.')
	expect(securityPoolCopy.formatPoolPageSummary(1, 1)).toBe('Matches: 1 of 1 pool on this page.')
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 of 8 active vaults, newest activity first. Enter a vault address above to inspect any specific vault.')
	expect(securityPoolCopy.formatVaultPreviewSummary(3, 8n)).toBe('Showing 3 of 8 active vaults in this preview, newest activity first.')
})

test('market and Open Oracle values own their complete spacing and units', () => {
	expect(marketCopy.formatSelectedForkQuestionDetail('0x1234')).toBe('Selected fork question: 0x1234')
	expect(openOracleCopy.formatTimingValue(12n, true)).toBe('12 s')
	expect(openOracleCopy.formatTimingValue(12n, false)).toBe('12 blocks')
})
