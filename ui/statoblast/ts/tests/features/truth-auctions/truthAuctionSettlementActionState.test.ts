/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createTruthAuctionSettlementActionState, reduceTruthAuctionSettlementActionState } from '../../../features/truth-auctions/lib/truthAuctionSettlementActionState.js'

describe('truth auction settlement action reducer', () => {
	test('marks mixed claim and refund results after a combined settlement succeeds', () => {
		const selectedState = reduceTruthAuctionSettlementActionState(createTruthAuctionSettlementActionState(), {
			selectedBidKeys: ['11:1', '8:2'],
			type: 'selectBidKeys',
		})
		const submittedState = reduceTruthAuctionSettlementActionState(selectedState, {
			action: 'claimAuctionProceeds',
			claimKeys: ['11:1'],
			ignoredResultHash: undefined,
			refundKeys: ['8:2'],
			type: 'submit',
		})

		const succeededState = reduceTruthAuctionSettlementActionState(submittedState, {
			action: 'claimAuctionProceeds',
			type: 'transactionSucceeded',
		})

		expect(succeededState.pendingAction).toBeUndefined()
		expect(succeededState.refreshToken).toBe(1)
		expect(succeededState.selectedBidKeys).toEqual([])
		expect(succeededState.resultByKey).toEqual({
			'11:1': 'claimed',
			'8:2': 'refunded',
		})
	})

	test('clears pending state without mutating selected bids when a transaction fails', () => {
		const selectedState = reduceTruthAuctionSettlementActionState(createTruthAuctionSettlementActionState(), {
			selectedBidKeys: ['8:2'],
			type: 'selectBidKeys',
		})
		const submittedState = reduceTruthAuctionSettlementActionState(selectedState, {
			action: 'refundLosingBids',
			claimKeys: [],
			ignoredResultHash: '0xaaaa',
			refundKeys: ['8:2'],
			type: 'submit',
		})

		const failedState = reduceTruthAuctionSettlementActionState(submittedState, {
			type: 'transactionFailed',
		})

		expect(failedState.pendingAction).toBeUndefined()
		expect(failedState.refreshToken).toBe(0)
		expect(failedState.selectedBidKeys).toEqual(['8:2'])
		expect(failedState.resultByKey).toEqual({})
	})

	test('prunes unavailable selected bids, local results, and pending bid keys', () => {
		const selectedState = reduceTruthAuctionSettlementActionState(createTruthAuctionSettlementActionState(), {
			selectedBidKeys: ['11:1', '8:2', '7:3'],
			type: 'selectBidKeys',
		})
		const submittedState = reduceTruthAuctionSettlementActionState(
			{
				...selectedState,
				resultByKey: {
					'7:3': 'refunded',
					'8:2': 'refunded',
				},
			},
			{
				action: 'claimAuctionProceeds',
				claimKeys: ['11:1'],
				ignoredResultHash: undefined,
				refundKeys: ['8:2', '7:3'],
				type: 'submit',
			},
		)

		const prunedState = reduceTruthAuctionSettlementActionState(submittedState, {
			availableBidKeys: ['11:1', '8:2'],
			type: 'pruneUnavailableBids',
		})

		expect(prunedState.selectedBidKeys).toEqual(['11:1', '8:2'])
		expect(prunedState.resultByKey).toEqual({
			'8:2': 'refunded',
		})
		expect(prunedState.pendingAction).toEqual({
			action: 'claimAuctionProceeds',
			claimKeys: ['11:1'],
			ignoredResultHash: undefined,
			refundKeys: ['8:2'],
		})
	})

	test('reset preserves refresh token while clearing local settlement state', () => {
		const state = {
			pendingAction: undefined,
			refreshToken: 3,
			resultByKey: {
				'8:2': 'refunded' as const,
			},
			selectedBidKeys: ['8:2'],
		}

		const resetState = reduceTruthAuctionSettlementActionState(state, {
			type: 'reset',
		})

		expect(resetState).toEqual({
			pendingAction: undefined,
			refreshToken: 3,
			resultByKey: {},
			selectedBidKeys: [],
		})
	})
})
