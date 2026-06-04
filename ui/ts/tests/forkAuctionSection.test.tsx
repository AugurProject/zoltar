/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { h } from 'preact'
import { type Address, getAddress, zeroAddress } from 'viem'
import { ForkAuctionSection } from '../components/ForkAuctionSection.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
import type { AccountState, ForkAuctionFormState } from '../types/app.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails, ReadClient } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

const PARENT_POOL_ADDRESS: Address = '0x00000000000000000000000000000000000000f0'

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

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	return {
		auctionedSecurityBondAllowance: 0n,
		claimingAvailable: false,
		completeSetCollateralAmount: 0n,
		currentTime: 3n,
		hasForkActivity: true,
		forkOutcome: 'yes',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedRep: 1n,
		migrationEndsAt: 100n,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'yes',
		repAtFork: 0n,
		securityPoolAddress: PARENT_POOL_ADDRESS,
		systemState: 'forkTruthAuction',
		truthAuction: undefined,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 1n,
		universeId: 1n,
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
		securityPoolAddress: '0x00000000000000000000000000000000000000f1',
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 0n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 1n,
		universeHasForked: true,
		universeId: 11n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
}

function createForkMigrationReadClient(): Pick<ReadClient, 'readContract'> {
	return {
		readContract: mock(async request => {
			switch (request.functionName) {
				case 'getChildUniverseId':
					return 11n
				case 'getMigrationProxyAddress':
					return zeroAddress
				case 'getRepToken':
					return zeroAddress
				case 'balanceOf':
					return 0n
				default:
					throw new Error(`Unexpected readContract call: ${String(request.functionName)}`)
			}
		}) as ReadClient['readContract'],
	}
}

function createProps(overrides: Partial<ForkAuctionSectionProps> = {}): ForkAuctionSectionProps {
	return {
		accountState: createAccountState(),
		currentStageView: 'auction',
		embedInCard: true,
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: createForkAuctionDetails(),
		forkAuctionError: undefined,
		forkAuctionForm: createForkAuctionForm(),
		forkMigrationReadClient: createForkMigrationReadClient(),
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
		onSelectedStageViewChange: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: () => undefined,
		securityPools: [createChildPool()],
		selectedStageView: 'migration',
		showHeader: false,
		showSecurityPoolAddressInput: false,
		...overrides,
	}
}

describe('ForkAuctionSection', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('renders the embedded fork workflow navigator and reports stage changes', async () => {
		const onSelectedStageViewChange = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(h(ForkAuctionSection, createProps({ onSelectedStageViewChange })))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const tablist = documentQueries.getByRole('tablist', { name: 'Fork lifecycle stages' })
		expect(tablist).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Fork Workflow' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Migration Status' })).not.toBeNull()

		const forkTriggeredTab = documentQueries.getByRole('tab', { name: 'Fork Triggered' })
		const migrationTab = documentQueries.getByRole('tab', { name: 'Migration' })
		const auctionTab = documentQueries.getByRole('tab', { name: 'Truth Auction' })
		const settlementTab = documentQueries.getByRole('tab', { name: 'Settlement' })

		expect(documentQueries.queryByText('View stage')).toBeNull()
		expect(documentQueries.queryByText('Current stage')).toBeNull()
		expect(forkTriggeredTab.querySelector('.fork-workflow-stage-icon')).not.toBeNull()
		expect(migrationTab.className.includes('is-selected')).toBe(true)
		expect(migrationTab.className.includes('is-complete')).toBe(true)
		expect(within(migrationTab).getByText('Viewing')).not.toBeNull()
		expect(auctionTab.getAttribute('aria-current')).toBe('step')
		expect(auctionTab.className.includes('is-current')).toBe(true)
		expect(settlementTab.className.includes('is-upcoming')).toBe(true)
		expect(documentQueries.queryByRole('tab', { name: 'New Security Pools' })).toBeNull()
		const separators = Array.from(document.body.querySelectorAll('.fork-workflow-stage-separator'))
		expect(separators).toHaveLength(3)
		expect(separators[0]?.className.includes('is-complete')).toBe(true)
		expect(separators[1]?.className.includes('is-complete')).toBe(true)
		expect(separators[2]?.className.includes('is-upcoming')).toBe(true)

		fireEvent.click(settlementTab)
		expect(onSelectedStageViewChange).toHaveBeenLastCalledWith('settlement')

		fireEvent.keyDown(forkTriggeredTab, { key: 'ArrowRight' })
		expect(onSelectedStageViewChange).toHaveBeenLastCalledWith('migration')

		fireEvent.keyDown(migrationTab, { key: 'ArrowRight' })
		expect(onSelectedStageViewChange).toHaveBeenLastCalledWith('auction')
	})

	test('shows the fork trigger timestamp when the system is forking', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentTimestamp: 2_000n,
					selectedStageView: 'fork-triggered',
					universeForkTime: 1_000n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('System is forking')).not.toBeNull()
		expect(documentQueries.getByText('1970-01-01 00:16:40 UTC')).not.toBeNull()
		expect(documentQueries.queryByText('The system is not forking.')).toBeNull()
		expect(documentQueries.queryByText('This required step marks the start of the fork workflow before assets migrate or auctions begin.')).toBeNull()
	})

	test('shows a not-forking message when no fork has been triggered', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					selectedStageView: 'fork-triggered',
					universeForkTime: 0n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('The system is not forking.')).not.toBeNull()
		expect(documentQueries.queryByText('System is forking')).toBeNull()
	})

	test('keeps settlement as the current step while finalized bids are still claimable', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'settlement',
					forkAuctionDetails: createForkAuctionDetails({
						claimingAvailable: true,
						systemState: 'operational',
						truthAuction: {
							accumulatedEth: 0n,
							auctionEndsAt: 10n,
							clearingPrice: 1n,
							clearingTick: 0n,
							ethAtClearingTick: 0n,
							ethRaiseCap: 1n,
							ethRaised: 0n,
							finalized: true,
							hitCap: false,
							maxRepBeingSold: 1n,
							minBidSize: 1n,
							repPurchasableAtBid: undefined,
							timeRemaining: 0n,
							totalRepPurchased: 0n,
							underfunded: false,
						},
					}),
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-current')).toBe(true)
		expect(documentQueries.queryByRole('tab', { name: 'New Security Pools' })).toBeNull()
		expect(documentQueries.getByRole('tabpanel', { name: 'Settlement' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Settlement Status' })).not.toBeNull()
	})

	test('shows the selected outcome field and child-pool link in the settlement child pools section', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'settlement',
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Outcome' })).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: 'Selected Yes Child pool' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Child Security Pools' })).not.toBeNull()
	})

	test('uses the current child pool as the selected outcome pool during truth auction', async () => {
		const currentChildPool = createChildPool()
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'auction',
					forkAuctionDetails: createForkAuctionDetails({
						parentSecurityPoolAddress: PARENT_POOL_ADDRESS,
						questionOutcome: 'yes',
						securityPoolAddress: currentChildPool.securityPoolAddress,
						systemState: 'forkTruthAuction',
						truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f6'),
						truthAuctionStartedAt: 1n,
						universeId: currentChildPool.universeId,
					}),
					previewPool: currentChildPool,
					securityPools: [currentChildPool],
					selectedStageView: 'auction',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('link', { name: 'Selected Yes Child pool' })).not.toBeNull()
		expect(documentQueries.queryByText('Child universe not created for the Yes outcome yet.')).toBeNull()
	})

	test('offers child-universe creation from the missing child-pool notice', async () => {
		const onCreateChildUniverse = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(
			h(
				ForkAuctionSection,
				createProps({
					currentStageView: 'migration',
					forkAuctionDetails: createForkAuctionDetails({
						forkOutcome: 'none',
						migratedRep: 0n,
						systemState: 'poolForked',
						truthAuction: undefined,
						truthAuctionStartedAt: 0n,
					}),
					onCreateChildUniverse,
					securityPools: [],
					selectedStageView: 'settlement',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Child universe not created for the Yes outcome yet.')).not.toBeNull()

		const createChildUniverseButton = documentQueries.getByRole('button', { name: 'Create Yes Child Universe' })
		fireEvent.click(createChildUniverseButton)
		expect(onCreateChildUniverse).toHaveBeenCalledTimes(1)
	})
})
