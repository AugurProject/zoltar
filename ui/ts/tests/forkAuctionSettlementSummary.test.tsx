/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, type Address, zeroAddress } from '@zoltar/shared/ethereum'
import { getTruthAuctionBidDisposition, TRUTH_AUCTION_PRICE_PRECISION } from '../lib/truthAuctionBook.js'
import { getTruthAuctionSettlementBidKey, getTruthAuctionSettlementSelectionState, type TruthAuctionSettlementBidRow } from '../lib/truthAuctionSettlement.js'
import type { AccountState, ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails, TruthAuctionBidView, TruthAuctionMetrics } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const actualContracts = await import('../contracts.js')
const actualClients = await import('../lib/clients.js')
const actualTruthAuctionBookHook = await import('../hooks/useTruthAuctionBookData.js')
const actualTruthAuctionSettlementHook = await import('../hooks/useTruthAuctionSettlementActionState.js')

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

mock.module('../contracts.js', () => ({
	...actualContracts,
	loadAllSecurityPools: mock(async () => mockedSecurityPools),
	loadForkAuctionDetails: mock(async () => mockedForkAuctionDetails),
}))

mock.module('../lib/clients.js', () => ({
	...actualClients,
	createConnectedReadClient: mock(() => ({
		readContract: mock(async () => {
			throw new Error('Unexpected readContract call in fork auction settlement summary test')
		}),
	})),
}))

mock.module('../hooks/useTruthAuctionBookData.js', () => ({
	...actualTruthAuctionBookHook,
	useTruthAuctionBookData: mock(() => mockedTruthAuctionBookState),
}))

mock.module('../hooks/useTruthAuctionSettlementActionState.js', () => ({
	...actualTruthAuctionSettlementHook,
	useTruthAuctionSettlementActionState: mock(() => mockedTruthAuctionSettlementState),
}))

const { ForkAuctionSection } = await import('../components/ForkAuctionSection.js')

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
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
		accumulatedEth: 0n,
		auctionEndsAt: 604_801n,
		clearingPrice: TRUTH_AUCTION_PRICE_PRECISION,
		clearingTick: 10n,
		ethAtClearingTick: ONE_UNIT + HALF_UNIT,
		ethRaiseCap: 10n * ONE_UNIT,
		ethRaised: 4n * ONE_UNIT,
		finalized: true,
		hitCap: true,
		maxRepBeingSold: 4n * ONE_UNIT,
		minBidSize: ONE_UNIT,
		repPurchasableAtBid: undefined,
		timeRemaining: 0n,
		totalRepPurchased: 4n * ONE_UNIT,
		underfunded: false,
		underfundedThreshold: undefined,
		underfundedWinningEth: 0n,
		...overrides,
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 8n * ONE_UNIT,
		claimingAvailable: true,
		completeSetCollateralAmount: 0n,
		currentTime: 700_000n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		migrationEndsAt: 100n,
		parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		auctionableRepAtFork: 0n,
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
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		parent: PARENT_POOL_ADDRESS,
		questionOutcome: 'yes',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: CHILD_POOL_ADDRESS,
		shareTokenSupply: 0n,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 0n,
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
	const ethAmount = overrides.ethAmount ?? ONE_UNIT
	return {
		activeCumulativeEthBeforeBid: overrides.activeCumulativeEthBeforeBid ?? 0n,
		bidIndex: overrides.bidIndex,
		bidder: overrides.bidder ?? CONNECTED_WALLET,
		claimed: overrides.claimed ?? false,
		cumulativeEth: overrides.cumulativeEth ?? ethAmount,
		ethAmount,
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
		loadNextAuctionBidPage: () => undefined,
		loadNextTickPage: () => undefined,
		loadNextViewerBidPage: () => undefined,
		loadingAggregatedAuctionBids: false,
		loadingTruthAuctionBook: false,
		selectTruthAuctionTick: () => undefined,
		selectedBookTick: undefined,
		truthAuctionBookData: {
			tickCount: 0n,
			tickSummaries: [],
			viewerBidCount: 0n,
			viewerBids: [],
		},
		truthAuctionBookError: undefined,
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
		onMigrateEscalationDeposits: () => undefined,
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

	test('shows selected-bid settlement estimates for REP, assigned OI debt, and refunds', async () => {
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
					activeCumulativeEthBeforeBid: ONE_UNIT,
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
		expect(documentQueries.getByText(/Winning rows receive estimated child-pool REP plus estimated Auctioned Bond Allowance \(OI Debt\), while refund rows return locked ETH\./)).not.toBeNull()
		expect(documentQueries.getByText('Estimated Auctioned Bond Allowance (OI Debt)')).not.toBeNull()
		expect(documentQueries.getByText('≈ 1.50 REP')).not.toBeNull()
		expect(documentQueries.getByText('≈ 3.00 ETH')).not.toBeNull()
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
			fireEvent.click(documentQueries.getByRole('button', { name: 'Settle Selected Bids' }))
		})

		expect(documentQueries.queryByRole('dialog', { name: 'Review Finalized Refund Settlement' })).toBeNull()
	})

	test('does not render a winning-threshold metric for finalized underfunded auctions with no winning prefix', async () => {
		const truthAuction = createTruthAuction({
			clearingPrice: undefined,
			clearingTick: 0n,
			ethRaised: ONE_UNIT,
			finalized: true,
			hitCap: false,
			totalRepPurchased: 0n,
			underfunded: true,
			underfundedThreshold: 2n ** 256n - 1n,
			underfundedWinningEth: 0n,
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
			ethRaised: 4n * ONE_UNIT,
			finalized: true,
			hitCap: false,
			maxRepBeingSold: 8n * ONE_UNIT,
			totalRepPurchased: 8n * ONE_UNIT,
			underfunded: true,
			underfundedThreshold: HALF_UNIT,
			underfundedWinningEth: 4n * ONE_UNIT,
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
		expect(documentQueries.getByText('Estimated REP Claimed')).not.toBeNull()
		expect(documentQueries.queryByText(/per-tick ETH denominator/i)).toBeNull()
	})
})
