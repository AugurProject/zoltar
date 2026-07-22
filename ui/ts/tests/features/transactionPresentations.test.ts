/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { createForkAuctionSuccessPresentation, createForkAuctionTransactionIntent, createPoolOracleSuccessPresentation } from '../../features/transactionPresentations.js'
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

	test('describes unresolved escalation migration as optional parent-lock cleanup', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('migrateUnresolvedEscalation'))
		expect(presentation.title).toBe('Clear Parent Escalation Locks')
		expect(presentation.detail).toBe('The wallet’s parent escalation-lock accounting was cleared in constant-size work. Child backing and proof eligibility were already available and are unchanged.')
	})

	test('describes direct parent escalation claims without calling them migration', () => {
		const intent = createForkAuctionTransactionIntent('claimParentEscalationDeposits')
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimParentEscalationDeposits'))
		expect(intent.submittedTitle).toBe('Claim Parent Escalation Deposits')
		expect(presentation.title).toBe('Claim Parent Escalation Deposits')
		expect(presentation.detail).toBe('Selected winning parent deposits were paid directly in child REP. Their carried proofs are now spent in current and later descendants.')
	})

	test('distinguishes accepted and economically rejected price candidate finalizations', () => {
		const accepted = createPoolOracleSuccessPresentation({ action: 'finalizeSettledPrice', hash: '0x1234', priceCandidateAccepted: true, priceCandidateRejectionReason: undefined })
		const rejected = createPoolOracleSuccessPresentation({ action: 'finalizeSettledPrice', hash: '0x1234', priceCandidateAccepted: false, priceCandidateRejectionReason: 'Insufficient dispute economics' })

		expect(accepted.title).toBe('Price Candidate Accepted')
		expect(accepted.tone).toBe('success')
		expect(rejected.title).toBe('Price Candidate Rejected')
		expect(rejected.detail).toBe('The candidate did not provide enough correction profit for the proved dispute-opportunity blocks. No price was activated.')
		expect(rejected.tone).toBe('warning')
	})

	test('distinguishes expired price candidates from economic rejection', () => {
		const expired = createPoolOracleSuccessPresentation({ action: 'finalizeSettledPrice', hash: '0x1234', priceCandidateAccepted: false, priceCandidateRejectionReason: 'Candidate price expired' })
		expect(expired.title).toBe('Price Candidate Expired')
		expect(expired.detail).toBe('The candidate expired before its historical-header proof was finalized. No price was activated.')
		expect(expired.tone).toBe('warning')
	})
})
