/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import type { Address } from 'viem'
import { getForkAuctionStageLabel, getForkAuctionStageOrder, getForkAuctionStageView, getForkStageDescriptionForState, getOutcomeActionLabel, hasForkActivity } from '../lib/forkAuction.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import {
	buildTruthAuctionDepthPoints,
	getTruthAuctionBidDisposition,
	getTruthAuctionBidGuardMessage,
	getTruthAuctionBidPreview,
	getTruthAuctionBidPriceValidationMessage,
	TRUTH_AUCTION_MIN_SUPPORTED_TICK,
	TRUTH_AUCTION_MIN_TICK,
	getTruthAuctionOverviewProgress,
	getTruthAuctionPriceAtTick,
	getTruthAuctionTickAtPrice,
	sortTruthAuctionBidsByPriority,
	sortTruthAuctionTickSummariesDescending,
	TRUTH_AUCTION_MAX_TICK,
	TRUTH_AUCTION_PRICE_PRECISION,
} from '../lib/truthAuctionBook.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidKey, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionState } from '../lib/truthAuctionSettlement.js'
import type { TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '../types/contracts.js'

const walletAddress: Address = '0x0000000000000000000000000000000000000001'
const otherWalletAddress: Address = '0x0000000000000000000000000000000000000002'

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

function createTickSummary(overrides: { tick: bigint } & Partial<Omit<TruthAuctionTickSummary, 'tick'>>): TruthAuctionTickSummary {
	return {
		active: overrides.active ?? false,
		currentTotalEth: overrides.currentTotalEth ?? 0n,
		price: overrides.price ?? getTruthAuctionPriceAtTick(overrides.tick),
		submissionCount: overrides.submissionCount ?? 0n,
		tick: overrides.tick,
	}
}

function createBid(overrides: { bidIndex: bigint; tick: bigint } & Partial<Omit<TruthAuctionBidView, 'bidIndex' | 'tick'>>): TruthAuctionBidView {
	const ethAmount = overrides.ethAmount ?? 1n * 10n ** 18n
	return {
		activeCumulativeEthBeforeBid: overrides.activeCumulativeEthBeforeBid ?? 0n,
		bidIndex: overrides.bidIndex,
		bidder: overrides.bidder ?? walletAddress,
		claimed: overrides.claimed ?? false,
		cumulativeEth: overrides.cumulativeEth ?? ethAmount,
		ethAmount,
		refunded: overrides.refunded ?? false,
		tick: overrides.tick,
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
		expect(getForkAuctionStageLabel('auction')).toBe('Truth Auction')
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

	void test('rejects prices outside the contract-supported truth auction range', () => {
		const maxSupportedPrice = getTruthAuctionPriceAtTick(TRUTH_AUCTION_MAX_TICK)
		const smallestSupportedPositiveTick = getTruthAuctionTickAtPrice(1n)

		expect(smallestSupportedPositiveTick).not.toBeUndefined()
		expect(getTruthAuctionTickAtPrice(maxSupportedPrice)).toBe(TRUTH_AUCTION_MAX_TICK)
		expect(getTruthAuctionTickAtPrice(maxSupportedPrice + 1n)).toBeUndefined()
		expect(getTruthAuctionBidPriceValidationMessage((maxSupportedPrice + 1n).toString())).toBe('Bid price is outside the supported auction range.')
		expect(getTruthAuctionBidPriceValidationMessage('9'.repeat(2_048))).toBe('Bid price is outside the supported auction range.')
		expect(getTruthAuctionBidPreview('9'.repeat(2_048))).toBeUndefined()
	})

	void test('rejects ticks outside the contract-supported truth auction range', () => {
		expect(TRUTH_AUCTION_MIN_SUPPORTED_TICK).toBeGreaterThan(TRUTH_AUCTION_MIN_TICK)
		expect(getTruthAuctionPriceAtTick(TRUTH_AUCTION_MIN_SUPPORTED_TICK)).toBeGreaterThan(0n)
		expect(() => getTruthAuctionPriceAtTick(TRUTH_AUCTION_MAX_TICK + 1n)).toThrow('Truth auction tick is outside the supported range.')
		expect(() => getTruthAuctionPriceAtTick(TRUTH_AUCTION_MIN_SUPPORTED_TICK - 1n)).toThrow('Truth auction tick is outside the supported range.')
		expect(() => getTruthAuctionPriceAtTick(TRUTH_AUCTION_MIN_TICK)).toThrow('Truth auction tick is outside the supported range.')
		expect(() => getTruthAuctionPriceAtTick(1_048_576n)).toThrow('Truth auction tick is outside the supported range.')
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
				submitBidAmountInput: '0.5',
				truthAuction: createTruthAuction(),
				walletEthBalance: 10n * 10n ** 18n,
			}),
		).toBe('Bid must be at least 1 ETH.')

		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2',
				truthAuction: createTruthAuction({ minBidSize: 2n * 10n ** 18n }),
				walletEthBalance: 1n * 10n ** 18n,
			}),
		).toBe('Need 1 more ETH in this wallet to bid the selected amount.')
		expect(
			getTruthAuctionBidGuardMessage({
				accountAddress: zeroAddress,
				currentTimestamp: 10n,
				isMainnet: true,
				submitBidAmountInput: '2',
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
				submitBidAmountInput: '2',
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

	void test('derives depth points from visible tick summaries', () => {
		const auction = createTruthAuction({
			clearingPrice: getTruthAuctionPriceAtTick(2n),
			clearingTick: 2n,
			hitCap: true,
		})
		const tickSummaries = sortTruthAuctionTickSummariesDescending([
			createTickSummary({ active: true, currentTotalEth: 2n * 10n ** 18n, submissionCount: 2n, tick: 1n }),
			createTickSummary({ active: true, currentTotalEth: 3n * 10n ** 18n, submissionCount: 3n, tick: 3n }),
			createTickSummary({ active: true, currentTotalEth: 0n, submissionCount: 1n, tick: 2n }),
			createTickSummary({ active: false, currentTotalEth: 0n, submissionCount: 1n, tick: 4n }),
		])

		const depthPoints = buildTruthAuctionDepthPoints({
			enteredBidTick: 1n,
			selectedBookTick: 3n,
			tickSummaries,
			truthAuction: auction,
		})

		expect(depthPoints.map(point => point.tick)).toEqual([3n, 2n, 1n])
		expect(depthPoints.map(point => point.cumulativeEth)).toEqual([3n * 10n ** 18n, 3n * 10n ** 18n, 5n * 10n ** 18n])
		expect(depthPoints.map(point => point.disposition.label)).toEqual(['Above Clearing', 'Historical', 'Below Clearing'])
		expect(depthPoints.map(point => point.isSelected)).toEqual([true, false, false])
		expect(depthPoints.map(point => point.isPreviewTick)).toEqual([false, false, true])
		expect(depthPoints.map(point => point.submissionCount)).toEqual([3n, 1n, 2n])
	})

	void test('derives provisional truth auction progress from loaded depth', () => {
		const ethUnit = 10n ** 18n
		const progress = getTruthAuctionOverviewProgress(
			createTruthAuction({
				clearingPrice: TRUTH_AUCTION_PRICE_PRECISION,
				clearingTick: 10n,
				ethAtClearingTick: 4n * ethUnit,
				ethRaiseCap: 10n * ethUnit,
				hitCap: true,
				maxRepBeingSold: 100n * ethUnit,
			}),
			[
				createTickSummary({ active: true, currentTotalEth: 8n * ethUnit, price: TRUTH_AUCTION_PRICE_PRECISION, tick: 12n }),
				createTickSummary({ active: true, currentTotalEth: 6n * ethUnit, price: TRUTH_AUCTION_PRICE_PRECISION, tick: 10n }),
				createTickSummary({ active: true, currentTotalEth: 5n * ethUnit, price: TRUTH_AUCTION_PRICE_PRECISION, tick: 8n }),
			],
		)

		expect(progress).toEqual({
			ethRaised: 10n * ethUnit,
			repSold: 10n * ethUnit,
		})
	})

	void test('sorts auction bids by price priority and bid index', () => {
		const sortedBids = sortTruthAuctionBidsByPriority([createBid({ bidIndex: 3n, tick: 9n }), createBid({ bidIndex: 2n, tick: 11n }), createBid({ bidIndex: 1n, tick: 11n })])

		expect(sortedBids.map(bid => getTruthAuctionSettlementBidKey(bid))).toEqual(['11:1', '11:2', '9:3'])
	})

	void test('derives mixed settlement selection and guard messages', () => {
		const finalizedAuction = createTruthAuction({
			clearingPrice: TRUTH_AUCTION_PRICE_PRECISION,
			clearingTick: 10n,
			ethAtClearingTick: 2n * 10n ** 18n,
			finalized: true,
			hitCap: true,
			maxRepBeingSold: 100n * 10n ** 18n,
			totalRepPurchased: 10n * 10n ** 18n,
		})
		const refundableBid = createBid({ bidIndex: 1n, tick: 9n })
		const winningBid = createBid({ bidIndex: 2n, tick: 11n })
		const otherWalletBid = createBid({ bidIndex: 3n, bidder: otherWalletAddress, tick: 12n })
		const refundedBid = createBid({ bidIndex: 4n, refunded: true, tick: 8n })

		expect(getTruthAuctionBidDisposition(winningBid, finalizedAuction).summaryKind).toBe('winning')
		expect(getTruthAuctionBidDisposition(refundableBid, finalizedAuction).summaryKind).toBe('refundable')

		const settlementRows = getTruthAuctionSettlementBidRows({
			accountAddress: walletAddress,
			truthAuction: finalizedAuction,
			viewerBids: [refundableBid, winningBid, otherWalletBid, refundedBid],
		})
		const settlementSelection = getTruthAuctionSettlementSelectionState({
			selectedBidKeys: settlementRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid)),
			settlementBidRows: settlementRows,
		})

		expect(settlementRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid))).toEqual(['9:1', '11:2'])
		expect(settlementSelection.selectionMode).toBe('mixed')
		expect(settlementSelection.selectedRefundKeys).toEqual(['9:1'])
		expect(settlementSelection.selectedClaimKeys).toEqual(['11:2'])
		expect(
			getTruthAuctionSettlementActionAvailabilityMessage({
				claimingAvailable: false,
				selectedClaimRows: settlementSelection.selectedClaimRows,
				selectedRows: settlementSelection.selectedRows,
				selectionHasClaims: settlementSelection.selectionHasClaims,
				selectionHasRefunds: settlementSelection.selectionHasRefunds,
				truthAuction: finalizedAuction,
			}),
		).toBe('Finalized settlement is not yet available for this pool.')
		expect(
			getTruthAuctionSettlementActionAvailabilityMessage({
				claimingAvailable: true,
				selectedClaimRows: settlementSelection.selectedClaimRows,
				selectedRows: settlementSelection.selectedRows,
				selectionHasClaims: settlementSelection.selectionHasClaims,
				selectionHasRefunds: settlementSelection.selectionHasRefunds,
				truthAuction: finalizedAuction,
			}),
		).toBeUndefined()
	})

	void test('builds truth auction bid row view models without component state', () => {
		const finalizedAuction = createTruthAuction({
			clearingTick: 10n,
			finalized: true,
			hitCap: true,
		})
		const rows = buildTruthAuctionBidRows({
			bids: [createBid({ bidIndex: 1n, cumulativeEth: 3n, ethAmount: 2n, tick: 11n })],
			truthAuction: finalizedAuction,
		})

		expect(rows).toEqual([
			{
				bidder: walletAddress,
				cumulativeEth: 3n,
				ethAmount: 2n,
				key: 'aggregate:11:1',
				price: getTruthAuctionPriceAtTick(11n),
				statusLabel: 'Winning',
				statusToneClassName: 'is-success',
			},
		])
		expect(buildTruthAuctionBidRows({ bids: rows.map(row => createBid({ bidIndex: 1n, bidder: row.bidder, cumulativeEth: row.cumulativeEth, ethAmount: row.ethAmount, tick: 11n })), truthAuction: undefined })).toEqual([])
	})

	void test('builds viewer bid rows with settlement controls and local result status', () => {
		const finalizedAuction = createTruthAuction({
			clearingTick: 10n,
			finalized: true,
			hitCap: true,
		})
		const refundableBid = createBid({ bidIndex: 1n, tick: 9n })
		const winningBid = createBid({ bidIndex: 2n, tick: 11n })
		const otherWalletBid = createBid({ bidIndex: 3n, bidder: otherWalletAddress, tick: 12n })
		const winningBidKey = getTruthAuctionSettlementBidKey(winningBid)
		const rowsViewModel = buildViewerTruthAuctionBidRows({
			accountAddress: walletAddress,
			isSettlementInProgress: false,
			selectedBidKeys: [winningBidKey],
			selectedStage: 'settlement',
			settlementResultByKey: {
				[getTruthAuctionSettlementBidKey(refundableBid)]: 'refunded',
			},
			truthAuction: finalizedAuction,
			viewerBids: [refundableBid, winningBid, otherWalletBid],
		})

		expect(rowsViewModel.showSettlementActionColumn).toBe(true)
		expect(rowsViewModel.rows.map(row => row.statusLabel)).toEqual(['Refunded', 'Winning', 'Winning'])
		expect(rowsViewModel.rows[0]?.settlementControl?.disabled).toBe(true)
		expect(rowsViewModel.rows[1]?.settlementControl).toEqual({
			ariaLabel: 'Select bid for settlement',
			bidKey: winningBidKey,
			checked: true,
			disabled: false,
			title: 'Select bid for settlement',
		})
		expect(rowsViewModel.rows[2]?.settlementControl?.ariaLabel).toBe('Bid is not settlement-eligible')
		expect(updateTruthAuctionSettlementBidSelection([winningBidKey], winningBidKey, true)).toEqual([winningBidKey])
		expect(updateTruthAuctionSettlementBidSelection([winningBidKey], '9:1', true)).toEqual([winningBidKey, '9:1'])
		expect(updateTruthAuctionSettlementBidSelection([winningBidKey, '9:1'], winningBidKey, false)).toEqual(['9:1'])
	})
})
