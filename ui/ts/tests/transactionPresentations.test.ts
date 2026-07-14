/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { createForkAuctionSuccessPresentation, createForkAuctionTransactionIntent } from '../lib/transactionPresentations.js'
import type { ForkAuctionActionResult } from '../types/contracts.js'

function createForkAuctionResult(action: ForkAuctionActionResult['action'], overrides: Partial<ForkAuctionActionResult> = {}): ForkAuctionActionResult {
	return {
		action,
		hash: '0x1234',
		securityPoolAddress: '0x0000000000000000000000000000000000000123',
		universeId: 1n,
		...overrides,
	}
}

describe('transaction presentations', () => {
	test('describes truth-auction claim settlement as REP plus auctioned bond allowance', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds'))
		expect(presentation.detail).toBe('Selected truth-auction bids were settled. Winning bids received child-pool REP plus Auctioned Bond Allowance (OI Debt), assigning the remaining open-interest debt; refund-only rows returned locked ETH.')
	})

	test('describes finalized refund-only settlement without OI debt assignment', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds', { settlementMode: 'refund' }))
		expect(presentation.title).toBe('Settle Finalized Refunds')
		expect(presentation.detail).toBe('Selected finalized truth-auction refund rows were settled. Locked ETH was returned without assigning child-pool REP or Auctioned Bond Allowance (OI Debt).')
	})

	test('uses refund-only transaction intent copy for finalized refund settlement submissions', () => {
		const intent = createForkAuctionTransactionIntent('claimAuctionProceeds', { submittedTitle: 'Settle Finalized Refunds' })
		expect(intent.submittedTitle).toBe('Settle Finalized Refunds')
		expect(intent.submittedDetail).toBe('Settle Finalized Refunds transaction submitted.')
	})

	test('attributes unresolved carry funding to the specified vault', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('migrateUnresolvedEscalation'))
		expect(presentation.detail).toBe('All unresolved parent escalation locks for the specified vault were copied into every registered child continuation game.')
		if (typeof presentation.detail !== 'string') throw new Error('Expected unresolved carry funding detail text')
		expect(presentation.detail.includes('this wallet')).toBe(false)
	})

	test('describes zero-REP child registration without claiming REP moved', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('migrateRepToZoltar'))
		expect(presentation.detail).toBe('The child destination was registered; any available pool REP was staged for that child.')
		if (typeof presentation.detail !== 'string') throw new Error('Expected child registration detail text')
		expect(presentation.detail.includes('REP was migrated')).toBe(false)
		expect(presentation.detail.includes('REP moved')).toBe(false)
	})
})
