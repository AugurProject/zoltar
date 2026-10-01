import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types='bun-types' />

import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import type { ForkAuctionDetails, ListedSecurityPool, TruthAuctionBidView, TruthAuctionMetrics } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { getTruthAuctionBidDisposition } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionBook.js'
import { getTruthAuctionSettlementBidKey, getTruthAuctionSettlementSelectionState, type TruthAuctionSettlementBidRow } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/truthAuctionSettlement.js'
import { describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { createForkAuctionSectionProps, createForkChildPool, PARENT_POOL_ADDRESS } from './forkAuctionFixtures.js'

const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))

type TruthAuctionBookHookState = ReturnType<typeof import('@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionBookData.js')['useTruthAuctionBookData']>
type TruthAuctionSettlementHookState = ReturnType<typeof import('@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js')['useTruthAuctionSettlementActionState']>

const ONE_UNIT = 10n ** 18n
const HALF_UNIT = 5n * 10n ** 17n
const CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f7'
const TRUTH_AUCTION_ADDRESS: Address = '0x00000000000000000000000000000000000000f8'
const CONNECTED_WALLET: Address = '0x00000000000000000000000000000000000000aa'

let mockedForkAuctionDetails: ForkAuctionDetails | undefined
let mockedSecurityPools: ListedSecurityPool[] = []
let mockedTruthAuctionBookState: TruthAuctionBookHookState
let mockedTruthAuctionSettlementState: TruthAuctionSettlementHookState

await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/protocol/securityPools.js', () => ({
	loadSecurityPoolChildren: mock(async () => mockedSecurityPools),
}))

await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/protocol/forks.js', () => ({
	loadForkAuctionDetails: mock(async () => mockedForkAuctionDetails),
}))

await moduleMocks.mockModule('@zoltar/ui-core-shared/wallet/clients.js', () => ({
	createConnectedReadClient: mock(() => ({
		readContract: mock(async () => {
			throw new Error('Unexpected readContract call in fork auction settlement summary test')
		}),
	})),
}))

await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionBookData.js', () => ({
	useTruthAuctionBookData: mock(() => mockedTruthAuctionBookState),
}))

await moduleMocks.mockModule('@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js', () => ({
	useTruthAuctionSettlementActionState: mock(() => mockedTruthAuctionSettlementState),
}))

const { ForkAuctionSection } = await import('@zoltar/ui-statoblast-shared/features/truth-auctions/components/ForkAuctionSection.js')

function createTruthAuction(overrides: Partial<TruthAuctionMetrics> = {}): TruthAuctionMetrics {
	return {
		accumulatedBidAttoEth: 0n,
		auctionEndsAt: 604_801n,
		clearingPrice: TRUTH_AUCTION_PRICE_PRECISION,
		clearingTick: 10n,
		bidAtClearingTickAttoEth: ONE_UNIT + HALF_UNIT,
		attoEthRaiseCap: 10n * ONE_UNIT,
		attoEthRaised: 4n * ONE_UNIT,
		finalized: true,
		hitCap: true,
		maxAttoRepBeingSold: 4n * ONE_UNIT,
		minBidSizeAttoEth: ONE_UNIT,
		attoRepPurchasableAtBid: undefined,
		timeRemaining: 0n,
		totalAttoRepPurchased: 4n * ONE_UNIT,
		underfunded: false,
		underfundedThreshold: undefined,
		underfundedWinningAttoEth: 0n,
		...overrides,
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedUnderwritingLimitAttoEth: 8n * ONE_UNIT,
		claimingAvailable: true,
		settlementCollateralAttoEth: 0n,
		currentTime: 700_000n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 1n,
		migrationEndsAt: 100n,
		parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		auctionableAttoRepAtFork: 0n,
		securityPoolAddress: CHILD_POOL_ADDRESS,
		systemState: 'operational',
		truthAuction: createTruthAuction(),
		truthAuctionAddress: TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 1n,
		universeId: 11n,
		...overrides,
	}
}

function createBid(overrides: { bidIndex: bigint; tick: bigint } & Partial<Omit<TruthAuctionBidView, 'bidIndex' | 'tick'>>): TruthAuctionBidView {
	const bidAmountAttoEth = overrides.bidAmountAttoEth ?? ONE_UNIT
	return {
		activeCumulativeBidBeforeAttoEth: overrides.activeCumulativeBidBeforeAttoEth ?? 0n,
		bidIndex: overrides.bidIndex,
		bidder: overrides.bidder ?? CONNECTED_WALLET,
		claimed: overrides.claimed ?? false,
		cumulativeBidAttoEth: overrides.cumulativeBidAttoEth ?? bidAmountAttoEth,
		bidAmountAttoEth,
		refunded: overrides.refunded ?? false,
		tick: overrides.tick,
	}
}

function createSettlementRow(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics): TruthAuctionSettlementBidRow {
	return {
		bid,
		disposition: getTruthAuctionBidDisposition(bid, truthAuction),
	}
}

function createTruthAuctionBookState(overrides: Partial<TruthAuctionBookHookState> = {}): TruthAuctionBookHookState {
	return {
		aggregatedAuctionBidCountForLoadedTicks: 0n,
		aggregatedAuctionBids: [],
		hasMoreAggregatedAuctionBids: false,
		hasMoreTickSummaries: false,
		hasMoreViewerBids: false,
		hasLoadedAggregatedAuctionBids: false,
		hasLoadedTruthAuctionBook: false,
		hasLoadedViewerTruthAuctionBids: false,
		loadNextAuctionBidPage: () => undefined,
		loadNextTickPage: () => undefined,
		loadNextViewerBidPage: () => undefined,
		loadingAggregatedAuctionBids: false,
		loadingTruthAuctionBook: false,
		loadingViewerTruthAuctionBids: false,
		retryingPublicTruthAuctionBook: false,
		retryingViewerTruthAuctionBids: false,
		retryPublicTruthAuctionBook: () => undefined,
		retryViewerTruthAuctionBids: () => undefined,
		selectTruthAuctionTick: () => undefined,
		selectedBookTick: undefined,
		truthAuctionBookData: {
			tickCount: 0n,
			tickSummaries: [],
			viewerBidCount: 0n,
			viewerBids: [],
		},
		truthAuctionBookError: undefined,
		viewerTruthAuctionBidsError: undefined,
		...overrides,
	}
}

function createTruthAuctionSettlementState(settlementBidRows: TruthAuctionSettlementBidRow[]): TruthAuctionSettlementHookState {
	const selectedBidKeys = settlementBidRows.map(({ bid }) => getTruthAuctionSettlementBidKey(bid))
	return {
		isSettleSelectedBidsInProgress: false,
		selectedSettlementBidKeys: selectedBidKeys,
		setSelectedSettlementBidKeys: _update => undefined,
		settlementBidResultByKey: {},
		settlementBidResultRefreshToken: 0,
		settlementSelectionState: getTruthAuctionSettlementSelectionState({
			selectedBidKeys,
			settlementBidRows,
		}),
		submitClaimBidsByKeys: _claimBidKeys => undefined,
		submitRefundBidsByKeys: _refundBidKeys => undefined,
		submitSelectedSettlementBids: () => undefined,
	}
}

async function renderSettlementSummary(truthAuction: TruthAuctionMetrics, settlementBidRows: TruthAuctionSettlementBidRow[] = []) {
	const childPool = createForkChildPool({ securityPoolAddress: CHILD_POOL_ADDRESS, truthAuctionAddress: TRUTH_AUCTION_ADDRESS })
	mockedForkAuctionDetails = createForkAuctionDetails({ truthAuction })
	mockedSecurityPools = [childPool]
	mockedTruthAuctionSettlementState = createTruthAuctionSettlementState(settlementBidRows)
	return await renderIntoDocument(
		h(
			ForkAuctionSection,
			createForkAuctionSectionProps(mockedForkAuctionDetails, {
				accountState: createAccountState({ address: getAddress(CONNECTED_WALLET) }),
				currentStageView: 'settlement',
				currentTimestamp: 700_000n,
				embedInCard: true,
				onSelectedStageViewChange: () => undefined,
				previewPool: childPool,
				securityPools: [childPool],
				selectedStageView: 'settlement',
				showHeader: false,
				showSecurityPoolAddressInput: false,
			}),
		),
	)
}

installTestRouting()
describe('ForkAuctionSection settlement summary', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		beforeTest: () => {
			mockedForkAuctionDetails = undefined
			mockedSecurityPools = []
			mockedTruthAuctionBookState = createTruthAuctionBookState()
			mockedTruthAuctionSettlementState = createTruthAuctionSettlementState([])
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('shows selected-bid settlement estimates for REP, assigned underwriting commitments, and refunds', async () => {
		const truthAuction = createTruthAuction()
		cleanupRenderedComponent = (
			await renderSettlementSummary(truthAuction, [
				createSettlementRow(createBid({ bidIndex: 1n, tick: 9n }), truthAuction),
				createSettlementRow(createBid({ bidIndex: 2n, tick: 11n }), truthAuction),
				createSettlementRow(
					createBid({
						activeCumulativeBidBeforeAttoEth: ONE_UNIT,
						bidIndex: 3n,
						tick: 10n,
					}),
					truthAuction,
				),
			])
		).cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Settlement preview.')).not.toBeNull()
		expect(documentQueries.getByText('Winning bids add REP backing units to your vault, with a matching share of the auctioned underwriting commitments. Refundable bids credit their ETH for withdrawal.')).not.toBeNull()
		expect(documentQueries.getByText('Estimated underwriting commitments')).not.toBeNull()
		expect(documentQueries.getByText('1.50 REP')).not.toBeNull()
		expect(documentQueries.getByText('3.00 ETH')).not.toBeNull()
		expect(documentQueries.getByText('1.50 ETH')).not.toBeNull()
		expect(documentQueries.getByText('These are pre-transaction estimates. Final on-chain settlement can differ slightly because claim math is rounded on-chain.')).not.toBeNull()
		expect(documentQueries.getByText('Estimated ETH refunded includes fully losing bids and any unfilled remainder on partially cleared winning bids.')).not.toBeNull()
	})

	test('does not open a confirmation dialog for refund-only settlement selections', async () => {
		const truthAuction = createTruthAuction({
			finalized: true,
		})
		const refundRow = createSettlementRow(createBid({ bidIndex: 9n, tick: 8n }), truthAuction)
		cleanupRenderedComponent = (await renderSettlementSummary(truthAuction, [refundRow])).cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Settle selected bids' }))
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Review Finalized Refund Settlement' })).toBeNull()
	})

	test('does not render a winning-threshold metric for finalized underfunded auctions with no winning prefix', async () => {
		const truthAuction = createTruthAuction({
			clearingPrice: undefined,
			clearingTick: 0n,
			attoEthRaised: 0n,
			finalized: true,
			hitCap: false,
			totalAttoRepPurchased: 0n,
			underfunded: true,
			underfundedThreshold: 2n * ONE_UNIT,
			underfundedWinningAttoEth: 0n,
		})
		cleanupRenderedComponent = (await renderSettlementSummary(truthAuction)).cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Winning threshold')).toBeNull()
	})

	test('does not render the legacy per-tick-denominator warning when synthetic underfunded estimates are available', async () => {
		const truthAuction = createTruthAuction({
			attoEthRaised: 4n * ONE_UNIT,
			finalized: true,
			hitCap: false,
			maxAttoRepBeingSold: 8n * ONE_UNIT,
			totalAttoRepPurchased: 8n * ONE_UNIT,
			underfunded: true,
			underfundedThreshold: HALF_UNIT,
			underfundedWinningAttoEth: 4n * ONE_UNIT,
		})
		cleanupRenderedComponent = (await renderSettlementSummary(truthAuction, [createSettlementRow(createBid({ bidIndex: 1n, tick: 0n }), truthAuction)])).cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Estimated REP backing')).not.toBeNull()
		expect(documentQueries.getByText(/Settlement preview/)).not.toBeNull()
		expect(documentQueries.queryByText(/Winning claims add REP backing units/)).toBeNull()
		expect(documentQueries.queryByText(/Select winning bids and settle them together/)).toBeNull()
		expect(documentQueries.queryByText(/per-tick ETH denominator/i)).toBeNull()
	})
})
