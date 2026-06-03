/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getForkAuctionStageLabel, getForkAuctionStageOrder, getForkAuctionStageView, getForkStageDescriptionForState, getOutcomeActionLabel, getTruthAuctionBidGuardMessage, getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice, hasForkActivity, TRUTH_AUCTION_PRICE_PRECISION } from '../lib/forkAuction.js'
import type { TruthAuctionMetrics } from '../types/contracts.js'

function createTruthAuction(overrides: Partial<TruthAuctionMetrics> = {}): TruthAuctionMetrics {
	return {
		accumulatedEth: 0n,
		auctionEndsAt: 10_000n,
		clearingPrice: 0n,
		clearingTick: 0n,
		ethAtClearingTick: 0n,
		ethRaiseCap: 100n * 10n ** 18n,
		ethRaised: 0n,
		finalized: false,
		hitCap: false,
		maxRepBeingSold: 0n,
		minBidSize: 1n * 10n ** 18n,
		repPurchasableAtBid: 0n,
		timeRemaining: 10n * 10n ** 18n,
		totalRepPurchased: 0n,
		underfunded: false,
		...overrides,
	}
}

void describe('fork auction helpers', () => {
	void test('getOutcomeActionLabel reuses reporting labels', () => {
		expect(getOutcomeActionLabel('invalid')).toBe('Invalid')
		expect(getOutcomeActionLabel('yes')).toBe('Yes')
		expect(getOutcomeActionLabel('no')).toBe('No')
	})

	void test('describes each fork stage from system state', () => {
		expect(getForkStageDescriptionForState('operational')).toContain('operational')
		expect(getForkStageDescriptionForState('poolForked')).toContain('Child universes')
		expect(getForkStageDescriptionForState('forkMigration')).toContain('Migration is active')
		expect(getForkStageDescriptionForState('forkTruthAuction')).toContain('Truth auction is active')
	})

	void test('detects whether preview pool data reflects actual fork activity', () => {
		expect(
			hasForkActivity({
				forkOutcome: 'none',
				migratedRep: 0n,
				systemState: 'operational',
				truthAuctionStartedAt: 0n,
			}),
		).toBe(false)

		expect(
			hasForkActivity({
				forkOutcome: 'yes',
				migratedRep: 0n,
				systemState: 'operational',
				truthAuctionStartedAt: 0n,
			}),
		).toBe(true)

		expect(
			hasForkActivity({
				forkOutcome: 'none',
				migratedRep: 0n,
				systemState: 'forkMigration',
				truthAuctionStartedAt: 0n,
			}),
		).toBe(true)
	})

	void test('derives lifecycle stage for pre-fork, migration, auction, and settlement states', () => {
		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 0n,
				systemState: 'operational',
				truthAuction: undefined,
				truthAuctionStartedAt: 0n,
			}),
		).toBe('initiate')

		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 1n,
				systemState: 'forkMigration',
				truthAuction: undefined,
				truthAuctionStartedAt: 0n,
			}),
		).toBe('migration')

		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 1n,
				systemState: 'forkTruthAuction',
				truthAuction: { finalized: false },
				truthAuctionStartedAt: 1n,
			}),
		).toBe('auction')

		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'yes',
				migratedRep: 1n,
				systemState: 'operational',
				truthAuction: undefined,
				truthAuctionStartedAt: 1n,
			}),
		).toBe('settlement')
	})

	void test('maps stage labels and order values', () => {
		expect(getForkAuctionStageLabel('initiate')).toBe('Trigger')
		expect(getForkAuctionStageLabel('migration')).toBe('Migration')
		expect(getForkAuctionStageLabel('auction')).toBe('Auction')
		expect(getForkAuctionStageLabel('settlement')).toBe('Settlement')

		expect(getForkAuctionStageOrder('initiate')).toBe(0)
		expect(getForkAuctionStageOrder('migration')).toBe(1)
		expect(getForkAuctionStageOrder('auction')).toBe(2)
		expect(getForkAuctionStageOrder('settlement')).toBe(3)
	})

	void test('maps exact truth auction prices back to their ticks', () => {
		expect(getTruthAuctionTickAtPrice(TRUTH_AUCTION_PRICE_PRECISION)).toBe(0n)
		expect(getTruthAuctionTickAtPrice(getTruthAuctionPriceAtTick(12n))).toBe(12n)
		expect(getTruthAuctionTickAtPrice(getTruthAuctionPriceAtTick(-3n))).toBe(-3n)
	})

	void test('rounds entered truth auction prices down to the nearest valid tick', () => {
		const tick12Price = getTruthAuctionPriceAtTick(12n)
		const tick13Price = getTruthAuctionPriceAtTick(13n)
		const betweenPositiveTicksPrice = (tick12Price + tick13Price) / 2n

		expect(getTruthAuctionTickAtPrice(betweenPositiveTicksPrice)).toBe(12n)
		expect(getTruthAuctionTickAtPrice(0n)).toBeUndefined()
	})

	void test('uses settlement after finalized auction and after active fork flags in settled-like states', () => {
		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 1n,
				systemState: 'forkTruthAuction',
				truthAuction: { finalized: true },
				truthAuctionStartedAt: 2n,
			}),
		).toBe('settlement')

		expect(
			getForkAuctionStageView({
				claimingAvailable: true,
				forkOutcome: 'yes',
				migratedRep: 0n,
				systemState: 'forkMigration',
				truthAuction: undefined,
				truthAuctionStartedAt: 3n,
			}),
		).toBe('settlement')
	})

	void test('guards bid submission through wallet, network, timing, and balance checks', () => {
		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: undefined,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '1',
				truthAuction: createTruthAuction(),
				walletEthBalance: 100n,
			}),
		).toBe('Connect a wallet before submitting a truth auction bid.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: false,
				submitBidAmountInput: '1',
				truthAuction: createTruthAuction(),
				walletEthBalance: 100n,
			}),
		).toBe('Switch to Ethereum mainnet before submitting a truth auction bid.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '1',
				truthAuction: undefined,
				walletEthBalance: 100n,
			}),
		).toBe('Load the truth auction before bidding.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 1_000n,
				isMainnet: true,
				submitBidAmountInput: '1',
				truthAuction: createTruthAuction({ timeRemaining: 0n }),
				walletEthBalance: 100n,
			}),
		).toBe('Truth auction has ended.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '',
				truthAuction: createTruthAuction(),
				walletEthBalance: 100n,
			}),
		).toBe('Enter a bid amount greater than zero.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: 'abc',
				truthAuction: createTruthAuction(),
				walletEthBalance: 100n,
			}),
		).toBe('Enter a valid bid amount.')
	})

	void test('reports minimum and balance errors for too-small bids', () => {
		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '500000000000000000',
				truthAuction: createTruthAuction(),
				walletEthBalance: 10n * 10n ** 18n,
			}),
		).toBe('Bid must be at least 1 ETH.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2000000000000000000',
				truthAuction: createTruthAuction({ minBidSize: 2n * 10n ** 18n }),
				walletEthBalance: 1n * 10n ** 18n,
			}),
		).toBe('Need 1 more ETH in this wallet to bid the selected amount.')
		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2000000000000000000',
				truthAuction: createTruthAuction({ minBidSize: 2n * 10n ** 18n }),
				walletEthBalance: 2n * 10n ** 18n,
			}),
		).toBeUndefined()
	})

	void test('allows a valid bid when conditions are satisfied', () => {
		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2000000000000000000',
				truthAuction: createTruthAuction({ minBidSize: 2n * 10n ** 18n }),
				walletEthBalance: 10n * 10n ** 18n,
			}),
		).toBeUndefined()
	})

	void test('uses finalized and wallet-loading guard branches before bid sizing', () => {
		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2000000000000000000',
				truthAuction: createTruthAuction({ finalized: true }),
				walletEthBalance: 10n * 10n ** 18n,
			}),
		).toBe('Truth auction is already finalized.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2000000000000000000',
				truthAuction: createTruthAuction(),
				walletEthBalance: undefined,
			}),
		).toBe('Loading wallet ETH balance.')
	})
})
