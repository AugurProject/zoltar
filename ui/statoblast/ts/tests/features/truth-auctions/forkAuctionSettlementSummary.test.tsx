/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { getTruthAuctionBidDisposition, TRUTH_AUCTION_PRICE_PRECISION } from '../../../features/truth-auctions/lib/truthAuctionBook.js'
import { getTruthAuctionSettlementBidKey, getTruthAuctionSettlementSelectionState, type TruthAuctionSettlementBidRow } from '../../../features/truth-auctions/lib/truthAuctionSettlement.js'
import type { AccountState, ForkAuctionFormState } from '@zoltar/ui-zoltar/types/app.js'
import type { ForkAuctionSectionProps } from '@zoltar/ui-zoltar/features/types.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails, TruthAuctionBidView, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'

const actualContracts = await import('../../../protocol/index.js')
const actualClients = await import('@zoltar/ui-core-shared/lib/clients.js')
const actualTruthAuctionBookHook = await import('../../../features/truth-auctions/hooks/useTruthAuctionBookData.js')
const actualTruthAuctionSettlementHook = await import('../../../features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js')

type TruthAuctionBookHookState = ReturnType<typeof actualTruthAuctionBookHook.useTruthAuctionBookData>
type TruthAuctionSettlementHookState = ReturnType<typeof actualTruthAuctionSettlementHook.useTruthAuctionSettlementActionState>

const ONE_UNIT = 10n ** 18n
const HALF_UNIT = 5n * 10n ** 17n
const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'
const CHILD_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f7'
const TRUTH_AUCTION_ADDRESS: Address = '0x00000000000000000000000000000000000000f8'
const CONNECTED_WALLET: Address = '0x00000000000000000000000000000000000000aa'

let mockedForkAuctionDetails: ForkAuctionDetails | undefined
let mockedSecurityPools: ListedSecurityPool[] = []
let mockedTruthAuctionBookState: TruthAuctionBookHookState
let mockedTruthAuctionSettlementState: TruthAuctionSettlementHookState

mock.module('../../../protocol/index.js', () => ({
	...actualContracts,
	loadSecurityPoolChildren: mock(async () => mockedSecurityPools),
	loadForkAuctionDetails: mock(async () => mockedForkAuctionDetails),
}))

mock.module('@zoltar/ui-core-shared/lib/clients.js', () => ({
	...actualClients,
	createConnectedReadClient: mock(() => ({
		readContract: mock(async () => {
			throw new Error('Unexpected readContract call in fork auction settlement summary test')
		}),
	})),
}))

mock.module('../../../features/truth-auctions/hooks/useTruthAuctionBookData.js', () => ({
	...actualTruthAuctionBookHook,
	useTruthAuctionBookData: mock(() => mockedTruthAuctionBookState),
}))

mock.module('../../../features/truth-auctions/hooks/useTruthAuctionSettlementActionState.js', () => ({
	...actualTruthAuctionSettlementHook,
	useTruthAuctionSettlementActionState: mock(() => mockedTruthAuctionSettlementState),
}))

const { ForkAuctionSection } = await import('../../../features/truth-auctions/components/ForkAuctionSection.js')

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalanceAttoEth: 0n,
		wethBalanceAttoEth: 0n,
		...overrides,
	}
}

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

function createForkAuctionForm(overrides: Partial<ForkAuctionFormState> = {}): ForkAuctionFormState {
	return {
		claimBidIndex: '',
		claimBidTick: '',
		depositIndexes: '',
		directForkQuestionId: '',
		directForkUniverseId: '',
		refundBidIndex: '',
		refundTick: '',
		repMigrationOutcomes: '',
		securityPoolAddress: PARENT_POOL_ADDRESS,
		selectedOutcome: 'yes',
		settlementAddress: '',
		submitBidAmount: '',
		submitBidPrice: '',
		vaultAddress: '',
		...overrides,
	}
}

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
		auctionedCapacityOwnershipAttoRep: 8n * ONE_UNIT,
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

function createChildPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 10n,
		feeEligibleCapacityOwnershipAttoRep: 0n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 1n,
		parent: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		questionId: '0x01',
		statoblastSecurityMultiplierBps: 20_000n,
		securityPoolAddress: CHILD_POOL_ADDRESS,
		shareTokenSupplyAttoShares: 0n,
		systemState: 'operational',
		totalPoolHeldAttoRep: 0n,
		totalCapacityOwnershipAttoRep: 0n,
		truthAuctionAddress: TRUTH_AUCTION_ADDRESS,
		truthAuctionStartedAt: 1n,
		universeHasForked: true,
		universeId: 11n,
		vaultCount: 0n,
		vaults: [],
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

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return {
		accountState: createAccountState(),
		currentStageView: 'settlement',
		embedInCard: true,
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: createForkAuctionDetails(),
		forkAuctionError: undefined,
		forkAuctionForm: createForkAuctionForm(),
		forkAuctionResult: undefined,
		loadingForkAuctionDetails: false,
		onClaimAuctionProceeds: () => undefined,
		onCreateChildUniverse: () => undefined,
		onFinalizeTruthAuction: () => undefined,
		onForkAuctionFormChange: () => undefined,
		onForkUniverse: () => undefined,
		onForkWithOwnEscalation: () => undefined,
		onInitiateFork: () => undefined,
		onLoadForkAuction: () => undefined,
		onClaimParentEscalationDeposits: () => undefined,
		onMigrateUnresolvedEscalation: _selectedChildOutcome => undefined,
		onMigrateRepToZoltar: () => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onSelectedStageViewChange: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawForkedEscalation: (_outcome, _parentDepositIndexes) => undefined,
		securityPools: [createChildPool()],
		selectedStageView: 'settlement',
		showHeader: false,
		showSecurityPoolAddressInput: false,
		...overrides,
	}
}

installTestRouting()
describe('ForkAuctionSection settlement summary', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
		cleanupRenderedComponent = undefined
		mockedForkAuctionDetails = undefined
		mockedSecurityPools = []
		mockedTruthAuctionBookState = createTruthAuctionBookState()
		mockedTruthAuctionSettlementState = createTruthAuctionSettlementState([])
	})

	afterEach(async () => {
		if (cleanupRenderedComponent !== undefined) {
			await cleanupRenderedComponent()
			cleanupRenderedComponent = undefined
		}
		if (cleanupDom !== undefined) {
			cleanupDom()
			cleanupDom = undefined
		}
	})

	test('shows selected-bid settlement estimates for REP, assigned capacity ownership, and refunds', async () => {
		const truthAuction = createTruthAuction()
		const childPool = createChildPool()
		mockedForkAuctionDetails = createForkAuctionDetails({
			truthAuction,
		})
		mockedSecurityPools = [childPool]
		mockedTruthAuctionSettlementState = createTruthAuctionSettlementState([
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

		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({
						address: getAddress(CONNECTED_WALLET),
					}),
					currentTimestamp: 700_000n,
					forkAuctionDetails: mockedForkAuctionDetails,
					previewPool: childPool,
					securityPools: [childPool],
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Selected-bid settlement preview.')).not.toBeNull()
		expect(documentQueries.getByText(/Winning rows receive estimated REP backing units plus estimated Auctioned capacity ownership, while refund rows return locked ETH\./)).not.toBeNull()
		expect(documentQueries.getByText('Estimated Auctioned capacity ownership')).not.toBeNull()
		expect(documentQueries.getByText('≈ 1.50 REP')).not.toBeNull()
		expect(documentQueries.getByText('≈ 3.00 REP')).not.toBeNull()
		expect(documentQueries.getByText('≈ 1.50 ETH')).not.toBeNull()
		expect(documentQueries.getByText('These are pre-transaction estimates. Final on-chain settlement can differ slightly because claim math is rounded on-chain.')).not.toBeNull()
		expect(documentQueries.getByText('Estimated ETH refunded includes fully losing bids and any unfilled remainder on partially cleared winning bids.')).not.toBeNull()
	})

	test('does not open a confirmation dialog for refund-only settlement selections', async () => {
		const truthAuction = createTruthAuction({
			finalized: true,
		})
		const refundRow = createSettlementRow(createBid({ bidIndex: 9n, tick: 8n }), truthAuction)
		const childPool = createChildPool()
		mockedForkAuctionDetails = createForkAuctionDetails({
			truthAuction,
		})
		mockedSecurityPools = [childPool]
		mockedTruthAuctionSettlementState = createTruthAuctionSettlementState([refundRow])

		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({
						address: getAddress(CONNECTED_WALLET),
					}),
					currentTimestamp: 700_000n,
					forkAuctionDetails: mockedForkAuctionDetails,
					previewPool: childPool,
					securityPools: [childPool],
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

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
		const childPool = createChildPool()
		mockedForkAuctionDetails = createForkAuctionDetails({
			truthAuction,
		})
		mockedSecurityPools = [childPool]

		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({
						address: getAddress(CONNECTED_WALLET),
					}),
					currentTimestamp: 700_000n,
					forkAuctionDetails: mockedForkAuctionDetails,
					previewPool: childPool,
					securityPools: [childPool],
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Winning Threshold')).toBeNull()
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
		const childPool = createChildPool()
		mockedForkAuctionDetails = createForkAuctionDetails({
			truthAuction,
		})
		mockedSecurityPools = [childPool]
		mockedTruthAuctionSettlementState = createTruthAuctionSettlementState([createSettlementRow(createBid({ bidIndex: 1n, tick: 0n }), truthAuction)])

		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({
						address: getAddress(CONNECTED_WALLET),
					}),
					currentTimestamp: 700_000n,
					forkAuctionDetails: mockedForkAuctionDetails,
					previewPool: childPool,
					securityPools: [childPool],
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Estimated REP backing')).not.toBeNull()
		expect(documentQueries.getByText(/Selected-bid settlement preview/)).not.toBeNull()
		expect(documentQueries.queryByText(/Winning claims add REP backing units/)).toBeNull()
		expect(documentQueries.queryByText(/Select winning bids and settle them together/)).toBeNull()
		expect(documentQueries.queryByText(/per-tick ETH denominator/i)).toBeNull()
	})
})
