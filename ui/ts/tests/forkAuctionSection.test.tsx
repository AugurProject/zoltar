/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { h } from 'preact'
import { zeroAddress } from 'viem'
import { ForkAuctionSection } from '../components/ForkAuctionSection.js'
import type { AccountState, ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionDetails, MarketDetails } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

const ETH = 10n ** 18n

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
		await Promise.resolve()

		const modal = documentQueries.getByRole('dialog')
		const modalQueries = within(modal)
		expect(modalQueries.getByText('Create Child Universe')).not.toBeNull()
		expect(modalQueries.getByText('Selected Outcome')).not.toBeNull()

		fireEvent.click(modalQueries.getByRole('button', { name: 'Create Yes Child Universe' }))

		expect(createChildUniverseCallCount).toBe(1)
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
})
