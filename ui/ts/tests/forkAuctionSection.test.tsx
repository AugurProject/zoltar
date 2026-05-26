/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@testing-library/dom'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { ForkAuctionSection } from '../components/ForkAuctionSection.js'
import { AUCTION_TIME_SECONDS } from '../lib/forkAuction.js'
import { formatDuration } from '../lib/formatters.js'
import type { AccountState, ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionDetails, MarketDetails, ReadClient, TruthAuctionBidView, TruthAuctionTickSummary } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

const ETH = 10n ** 18n
type TruthAuctionReadContractRequest = Parameters<ReadClient['readContract']>[0]
type TruthAuctionReadContractHandler = (request: TruthAuctionReadContractRequest) => Promise<unknown>

function createReadContractStub(handler: TruthAuctionReadContractHandler): ReadClient['readContract'] {
	return async request => (await handler(request as TruthAuctionReadContractRequest)) as never
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createMarketDetails(): MarketDetails {
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
	}
}

function createForkAuctionDetails(): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 10n,
		claimingAvailable: false,
		completeSetCollateralAmount: 1n,
		currentTime: 100n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		migrationEndsAt: 200n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		repAtFork: 20n,
		securityPoolAddress: zeroAddress,
		systemState: 'forkMigration',
		truthAuction: undefined,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeId: 1n,
	}
}

function createTruthAuctionMetrics() {
	return {
		accumulatedEth: 0n,
		auctionEndsAt: 200n,
		clearingPrice: undefined,
		clearingTick: undefined,
		ethAtClearingTick: 0n,
		ethRaiseCap: 100n * ETH,
		ethRaised: 0n,
		finalized: false,
		hitCap: false,
		maxRepBeingSold: 100n * ETH,
		minBidSize: 2n * ETH,
		repPurchasableAtBid: undefined,
		timeRemaining: 100n,
		totalRepPurchased: 0n,
		underfunded: false,
	}
}

function createForkAuctionForm(): ForkAuctionFormState {
	return {
		claimBidIndex: '',
		claimBidTick: '',
		depositIndexes: '',
		directForkQuestionId: '',
		directForkUniverseId: '',
		refundBidIndex: '',
		refundTick: '',
		repMigrationOutcomes: '',
		securityPoolAddress: zeroAddress,
		selectedOutcome: 'yes',
		submitBidAmount: '',
		submitBidTick: '',
		vaultAddress: '',
		withdrawBidIndex: '',
		withdrawForAddress: '',
		withdrawTick: '',
	}
}

function createTruthAuctionTickSummary(overrides: Partial<TruthAuctionTickSummary> = {}): TruthAuctionTickSummary {
	return {
		tick: 0n,
		price: ETH,
		currentTotalEth: 0n,
		submissionCount: 0n,
		active: false,
		...overrides,
	}
}

function createTruthAuctionBidView(overrides: Partial<TruthAuctionBidView> = {}): TruthAuctionBidView {
	return {
		tick: 0n,
		bidIndex: 0n,
		bidder: zeroAddress,
		ethAmount: 0n,
		cumulativeEth: 0n,
		activeCumulativeEthBeforeBid: 0n,
		claimed: false,
		refunded: false,
		...overrides,
	}
}

function createTruthAuctionReadClient(
	readContract: TruthAuctionReadContractHandler = async request => {
		if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary()
		if (request.functionName === 'activeTickCount') return 0n
		if (request.functionName === 'getActiveTickPage') return []
		if (request.functionName === 'getTickCount') return 0n
		if (request.functionName === 'getTickPage') return []
		if (request.functionName === 'getBidCountAtTick') return 0n
		if (request.functionName === 'getBidPageAtTick') return []
		if (request.functionName === 'getBidderBidCount') return 0n
		if (request.functionName === 'getBidderBidPage') return []
		throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
	},
): Pick<ReadClient, 'readContract'> {
	return {
		readContract: createReadContractStub(readContract),
	}
}

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return {
		accountState: createAccountState(),
		embedInCard: false,
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
		onMigrateRepToZoltar: () => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		onWithdrawBids: () => undefined,
		showHeader: false,
		showSecurityPoolAddressInput: false,
		truthAuctionReadClient: createTruthAuctionReadClient(),
		...overrides,
	}
}

describe('ForkAuctionSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('omits the redundant stage banner and collapses lower-priority detail below the action area', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('This pool is operational. If it is a child universe, the fork and auction path has completed.')).toBeNull()
		expect(documentQueries.queryByText('Fork Workflow')).toBeNull()

		const summaries = Array.from(document.body.querySelectorAll('summary')).map(node => node.textContent?.trim() ?? '')
		expect(summaries).not.toContain('Pool Context')
		expect(summaries).toContain('Live Snapshot')
	})

	test('launches create child universe in a focused modal', async () => {
		let createChildUniverseCallCount = 0
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					onCreateChildUniverse: () => {
						createChildUniverseCallCount += 1
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Create child universe' }))
		const modal = await waitFor(() => documentQueries.getByRole('dialog'))
		const modalQueries = within(modal)
		expect(modalQueries.getByText('Create Child Universe')).not.toBeNull()
		expect(modalQueries.getByText('Selected Outcome')).not.toBeNull()

		fireEvent.click(modalQueries.getByRole('button', { name: 'Create Yes Child Universe' }))

		expect(createChildUniverseCallCount).toBe(1)
	})

	test('gates fork stage write buttons through the shared action matrix', async () => {
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Initiate' }))
		})
		expectTransactionButtonDisabled(document.body, 'Fork With Own Escalation')
		expectTransactionButtonDisabled(document.body, 'Initiate Pool Fork')
		expectTransactionButtonDisabled(document.body, 'Fork Universe Directly')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Auction' }))
		})
		expectTransactionButtonDisabled(document.body, 'Start Truth Auction')
		expectTransactionButtonDisabled(document.body, 'Submit Bid')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Settlement' }))
		})
		expectTransactionButtonDisabled(document.body, 'Finalize Truth Auction')
		expectTransactionButtonDisabled(document.body, 'Refund Losing Bid')
		expectTransactionButtonDisabled(document.body, 'Claim Auction Proceeds')
		expect(documentQueries.queryByRole('button', { name: 'Withdraw Bids' })).toBeNull()
	})

	test('gates disabled fork-workflow write controls while keeping the workflow banner visible', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					disabled: true,
					disabledMessage: 'This pool is currently operational, so fork and truth auction actions are read only.',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)

		expectTransactionButtonDisabled(document.body, 'Create child universe')
		expectTransactionButtonDisabled(document.body, 'Migrate REP To Zoltar')
		expectTransactionButtonDisabled(document.body, 'Migrate Vault')
		expectTransactionButtonDisabled(document.body, 'Migrate Escalation Deposits')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Auction' }))
		})
		expectTransactionButtonDisabled(document.body, 'Start Truth Auction')
		expectTransactionButtonDisabled(document.body, 'Submit Bid')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Settlement' }))
		})
		expectTransactionButtonDisabled(document.body, 'Finalize Truth Auction')
		expectTransactionButtonDisabled(document.body, 'Refund Losing Bid')
		expectTransactionButtonDisabled(document.body, 'Claim Auction Proceeds')
		expect(documentQueries.queryByRole('button', { name: 'Withdraw Bids' })).toBeNull()
	})

	test('prefers the live chain timestamp over the loaded snapshot for migration time left', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 150n,
					forkAuctionDetails: createForkAuctionDetails(),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatDuration(200n - 100n))).toBe(false)
		expect(document.body.textContent?.includes(formatDuration(200n - 150n))).toBe(true)
	})

	test('renders latest fork action status outside action rows', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					forkAuctionResult: {
						action: 'migrateVault',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(document.body.querySelector('.workflow-transaction-status')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Latest Fork / Auction Action' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Latest Fork / Auction Action' }).closest('.actions')).toBeNull()
	})

	test('recomputes truth auction time left from the live chain timestamp', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 150n,
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						currentTime: 100n,
						systemState: 'forkTruthAuction',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 200n,
							clearingPrice: undefined,
							clearingTick: undefined,
							ethAtClearingTick: 0n,
							ethRaiseCap: 10n,
							ethRaised: 0n,
							finalized: false,
							hitCap: false,
							maxRepBeingSold: 10n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 100n,
							totalRepPurchased: 0n,
							underfunded: false,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 200n - AUCTION_TIME_SECONDS,
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes(formatDuration(100n))).toBe(false)
		expect(document.body.textContent?.includes(formatDuration(50n))).toBe(true)
	})

	test('blocks truth auction bids below the minimum bid size', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (1n * ETH).toString(),
						submitBidTick: '1',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Bid must be at least 2 ETH.')
	})

	test('blocks truth auction bids when the wallet lacks enough ETH for the selected amount', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 2n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: createTruthAuctionMetrics(),
						truthAuctionStartedAt: 1n,
					},
					forkAuctionForm: {
						...createForkAuctionForm(),
						submitBidAmount: (3n * ETH).toString(),
						submitBidTick: '1',
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Submit Bid', 'Need 1 more ETH in this wallet to bid the selected amount.')
	})

	test('renders the bid ladder, selected price level, and wallet bids from contract-backed auction pages', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 2n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 2n, active: true }), createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 3n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 5n * ETH, submissionCount: 3n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 2n
			if (request.functionName === 'getBidPageAtTick')
				return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH }), createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, bidder: '0x0000000000000000000000000000000000000001', ethAmount: 3n * ETH, cumulativeEth: 5n * ETH, activeCumulativeEthBeforeBid: 2n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 0n, ethAmount: 2n * ETH, cumulativeEth: 2n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'forkTruthAuction',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							ethRaised: 9n * ETH,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(document.body.textContent?.includes('Tick 12')).toBe(true)
			expect(documentQueries.getByRole('heading', { name: 'My Bids' })).not.toBeNull()
		})
		expect(documentQueries.getByRole('heading', { name: 'Bid Ladder' })).not.toBeNull()
		expect(document.body.textContent?.includes('Tick 12')).toBe(true)
		fireEvent.click(documentQueries.getByText('Tick 12'))
		await waitFor(() => {
			expect(documentQueries.getByText('Selected Price Level')).not.toBeNull()
		})
		expect(documentQueries.getByText('Selected Price Level')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'My Bids' })).not.toBeNull()
		expect(document.body.textContent?.includes('2 submissions')).toBe(true)
	})

	test('reloads the paged bidbook after a successful fork-auction action result changes', async () => {
		let activeTickPageCalls = 0
		let bidderBidPageCalls = 0
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') {
				activeTickPageCalls += 1
				return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			}
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') {
				bidderBidPageCalls += 1
				return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			}
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const baseProps = createProps({
			accountState: createAccountState({ ethBalance: 10n * ETH }),
			forkAuctionDetails: {
				...createForkAuctionDetails(),
				systemState: 'forkTruthAuction',
				truthAuction: {
					...createTruthAuctionMetrics(),
					clearingPrice: 2n * ETH,
					clearingTick: 10n,
					ethAtClearingTick: 5n * ETH,
					hitCap: true,
				},
				truthAuctionAddress: '0x0000000000000000000000000000000000000001',
				truthAuctionStartedAt: 1n,
			},
			truthAuctionReadClient,
		})
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, baseProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(activeTickPageCalls).toBeGreaterThan(0)
			expect(bidderBidPageCalls).toBeGreaterThan(0)
		})
		const initialActiveTickPageCalls = activeTickPageCalls
		const initialBidderBidPageCalls = bidderBidPageCalls

		await act(() => {
			render(
				h(ForkAuctionSection, {
					...baseProps,
					forkAuctionResult: {
						action: 'submitBid',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000d4',
						securityPoolAddress: zeroAddress,
						universeId: 1n,
					},
				}),
				renderedComponent.container,
			)
		})
		await waitFor(() => {
			expect(activeTickPageCalls).toBeGreaterThan(initialActiveTickPageCalls)
			expect(bidderBidPageCalls).toBeGreaterThan(initialBidderBidPageCalls)
		})

		expect(activeTickPageCalls).toBeGreaterThan(initialActiveTickPageCalls)
		expect(bidderBidPageCalls).toBeGreaterThan(initialBidderBidPageCalls)
	})

	test('uses active cumulative ETH before the bid when classifying clearing-tick bids', async () => {
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 3n * ETH, submissionCount: 2n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 10n, price: 2n * ETH, currentTotalEth: 3n * ETH, submissionCount: 2n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, ethAmount: 3n * ETH, cumulativeEth: 5n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 10n, bidIndex: 1n, ethAmount: 3n * ETH, cumulativeEth: 5n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 3n * ETH,
							finalized: true,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('tab', { name: 'Auction' }))
		})

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getAllByText('Winning').length).toBeGreaterThan(0)
		})
		expect(documentQueries.queryByText('Partial')).toBeNull()
		expect(documentQueries.getAllByText('Winning').length).toBeGreaterThan(0)
	})

	test('prefills claim inputs from wallet bid shortcuts in settlement mode', async () => {
		const formUpdates: Partial<ForkAuctionFormState>[] = []
		const truthAuctionReadClient = createTruthAuctionReadClient(async request => {
			if (request.functionName === 'activeTickCount') return 1n
			if (request.functionName === 'getActiveTickPage') return [createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })]
			if (request.functionName === 'getTickSummary') return createTruthAuctionTickSummary({ tick: 12n, price: 3n * ETH, currentTotalEth: 4n * ETH, submissionCount: 1n, active: true })
			if (request.functionName === 'getBidCountAtTick') return 1n
			if (request.functionName === 'getBidPageAtTick') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			if (request.functionName === 'getBidderBidCount') return 1n
			if (request.functionName === 'getBidderBidPage') return [createTruthAuctionBidView({ tick: 12n, bidIndex: 0n, ethAmount: 4n * ETH, cumulativeEth: 4n * ETH })]
			throw new Error(`Unexpected truth auction read: ${String(request.functionName)}`)
		})
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					accountState: createAccountState({ ethBalance: 10n * ETH }),
					forkAuctionDetails: {
						...createForkAuctionDetails(),
						systemState: 'operational',
						truthAuction: {
							...createTruthAuctionMetrics(),
							clearingPrice: 2n * ETH,
							clearingTick: 10n,
							ethAtClearingTick: 5n * ETH,
							finalized: true,
							hitCap: true,
						},
						truthAuctionAddress: '0x0000000000000000000000000000000000000001',
						truthAuctionStartedAt: 1n,
					},
					onForkAuctionFormChange: update => {
						formUpdates.push(update)
					},
					truthAuctionReadClient,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(documentQueries.getAllByRole('button', { name: 'Prefill Claim' }).length).toBeGreaterThan(0)
		})
		fireEvent.click(
			documentQueries.getAllByRole('button', { name: 'Prefill Claim' })[0] ??
				(() => {
					throw new Error('Expected at least one Prefill Claim button')
				})(),
		)

		expect(formUpdates).toContainEqual({
			claimBidIndex: '0',
			claimBidTick: '12',
		})
	})
})
