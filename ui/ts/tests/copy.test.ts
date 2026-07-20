import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import * as marketCopy from '../copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as securityPoolCopy from '../copy/securityPool.js'

test('fork migration empty states are complete templates', () => {
	expect(forkAuctionCopy.formatNoUnresolvedDeposits('YES')).toBe('No yes unresolved deposits remain for this wallet.')
	expect(forkAuctionCopy.formatNoClaimableParentEscalationDeposits('Yes')).toBe('No Yes parent escalation deposits are currently available for a direct claim by this wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyEscrowDetail).toBe('No parent escrowed REP is currently visible for a direct claim by the connected wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyEscrowDetail).not.toMatch(/migrat/i)
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatPoolPageSummary(5, 12)).toBe('5 of 12 pools match.')
	expect(securityPoolCopy.formatPoolPageSummary(0, 2)).toBe('0 of 2 pools match.')
	expect(securityPoolCopy.formatPoolPageSummary(1, 2)).toBe('1 of 2 pools matches.')
	expect(securityPoolCopy.formatPoolPageSummary(2, 2)).toBe('2 of 2 pools match.')
	expect(securityPoolCopy.formatPoolPageSummary(1, 1)).toBe('1 of 1 pool matches.')
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 of 8 active vaults, newest activity first. Enter a vault address above to inspect any specific vault.')
	expect(securityPoolCopy.formatVaultPreviewSummary(3, 8n)).toBe('Showing 3 of 8 active vaults in this preview, newest activity first.')
})

test('market and Open Oracle values own their complete spacing and units', () => {
	expect(marketCopy.formatSelectedForkQuestionDetail('0x1234')).toBe('Selected fork question: 0x1234')
	expect(openOracleCopy.formatTimingValue(12n, true)).toBe('12 s')
	expect(openOracleCopy.formatTimingValue(12n, false)).toBe('12 blocks')
})
