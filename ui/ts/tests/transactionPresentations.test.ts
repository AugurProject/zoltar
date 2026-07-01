/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { createForkAuctionSuccessPresentation } from '../lib/transactionPresentations.js'
import type { ForkAuctionActionResult } from '../types/contracts.js'

function createForkAuctionResult(action: ForkAuctionActionResult['action']): ForkAuctionActionResult {
	return {
		action,
		hash: '0x1234',
		securityPoolAddress: '0x0000000000000000000000000000000000000123',
		universeId: 1n,
	}
}

describe('transaction presentations', () => {
	test('describes truth-auction claim settlement as REP plus auctioned bond allowance', () => {
		const presentation = createForkAuctionSuccessPresentation(createForkAuctionResult('claimAuctionProceeds'))
		expect(presentation.detail).toBe('Selected truth-auction bids were settled. Winning bids received child-pool REP plus auctioned bond allowance, assigning the remaining open-interest debt; refund-only rows returned locked ETH.')
	})
})
