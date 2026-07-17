/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { createForkAuctionSuccessPresentation, createForkAuctionTransactionIntent } from '../../features/transactionPresentations.js'
import type { ForkAuctionActionResult } from '../../types/contracts.js'

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
		expect(intent.submittedDetail).toBeUndefined()
	})

	test('keeps unresolved escalation entitlement reuse explicit after one child materializes', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('migrateUnresolvedEscalation'))
		expect(presentation.detail).toBe('The wallet’s aggregate escalation entitlement was captured and materialized in the chosen child universe. It remains available for other unselected child outcomes until the migration deadline.')
	})
})
