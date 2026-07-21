import { expect, test } from 'bun:test'
import * as forkAuctionCopy from '../copy/forkAuction.js'
import * as marketCopy from '../copy/market.js'
import * as openOracleCopy from '../copy/openOracle.js'
import * as securityPoolCopy from '../copy/securityPool.js'

test('fork migration empty states are complete templates', () => {
	expect(forkAuctionCopy.formatNoUnresolvedDeposits('yes')).toBe('No yes unresolved deposits remain for this wallet.')
	expect(forkAuctionCopy.formatNoClaimableParentEscalationDeposits('Yes')).toBe('No Yes parent escalation deposits are currently available for a direct claim by this wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyEscrowDetail).toBe('No parent escrowed REP is currently visible for a direct claim by the connected wallet.')
	expect(forkAuctionCopy.parentEscalationClaimEmptyEscrowDetail).not.toMatch(/migrat/i)
})

test('security-pool count summaries own their complete prose', () => {
	expect(securityPoolCopy.formatVaultDirectorySummary(3n, 8n)).toBe('Showing 3 of 8 active vaults, newest activity first. Enter a vault address above to inspect any specific vault.')
})

test('market and Open Oracle values own their complete spacing and units', () => {
	expect(marketCopy.formatSelectedForkQuestionDetail('0x1234')).toBe('Selected fork question: 0x1234')
	expect(openOracleCopy.formatTimingValue(12n, openOracleCopy.secondsAbbreviation)).toBe('12 s')
	expect(openOracleCopy.formatTimingValue(12n, openOracleCopy.blocks)).toBe('12 blocks')
})
