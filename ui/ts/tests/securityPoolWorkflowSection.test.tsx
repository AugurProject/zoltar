/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { SecurityPoolWorkflowSection } from '../components/SecurityPoolWorkflowSection.js'
import type { AccountState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails, SecurityPoolVaultSummary, SecurityVaultDetails } from '../types/contracts.js'
import type { ForkAuctionRouteContentProps, ReportingRouteContentProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createTradingProps(overrides: Partial<TradingRouteContentProps> = {}): TradingRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingTradingForkUniverse: false,
		loadingTradingDetails: false,
		onCreateCompleteSet: () => undefined,
		onMigrateShares: () => undefined,
		onRedeemCompleteSet: () => undefined,
		onRedeemShares: () => undefined,
		onTradingFormChange: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		selectedPool: undefined,
		tradingActiveAction: undefined,
		tradingDetails: undefined,
		tradingError: undefined,
		tradingForkUniverse: undefined,
		tradingForm: {
			completeSetAmount: '',
			redeemAmount: '',
			securityPoolAddress: '',
			selectedShareOutcome: 'yes',
			targetOutcomeIndexes: '',
		},
		tradingResult: undefined,
		...overrides,
	}
}

function createReportingProps(overrides: Partial<ReportingRouteContentProps> = {}): ReportingRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingReportingDetails: false,
		onLoadReporting: () => undefined,
		onReportOutcome: () => undefined,
		onReportingFormChange: () => undefined,
		onWithdrawEscalation: () => undefined,
		reportingActiveAction: undefined,
		reportingDetails: undefined,
		reportingError: undefined,
		reportingForm: {
			reportAmount: '',
			securityPoolAddress: '',
			selectedOutcome: 'yes',
			withdrawDepositIndexes: '',
		},
		reportingResult: undefined,
		...overrides,
	}
}

function createSecurityVaultProps(overrides: Partial<SecurityVaultRouteContentProps> = {}): SecurityVaultRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingSecurityVault: false,
		onApproveRep: () => undefined,
		onDepositRep: () => undefined,
		onLoadSecurityVault: () => undefined,
		onRedeemFees: () => undefined,
		onSetSecurityBondAllowance: () => undefined,
		onSecurityVaultFormChange: () => undefined,
		onWithdrawRep: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolVaults: undefined,
		securityVaultActiveAction: undefined,
		securityVaultDetails: undefined,
		securityVaultError: undefined,
		securityVaultForm: {
			depositAmount: '',
			repWithdrawAmount: '',
			securityBondAllowanceAmount: '',
			securityPoolAddress: '',
			selectedVaultAddress: '',
		},
		securityVaultMissing: false,
		securityVaultRepApproval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		securityVaultRepBalance: undefined,
		securityVaultResult: undefined,
		selectedPoolSecurityMultiplier: undefined,
		...overrides,
	}
}

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		currentRetentionRate: 10n,
		lockedRepInEscalationGame: 0n,
		managerAddress: zeroAddress,
		poolOwnershipDenominator: 1n,
		repDepositShare: 5n * 10n ** 18n,
		repToken: zeroAddress,
		securityBondAllowance: 2n * 10n ** 18n,
		securityPoolAddress: zeroAddress,
		totalSecurityBondAllowance: 3n * 10n ** 18n,
		unpaidEthFees: 1n * 10n ** 18n,
		universeId: 1n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createSecurityPoolVaultSummary(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	return {
		lockedRepInEscalationGame: 1n * 10n ** 18n,
		repDepositShare: 5n * 10n ** 18n,
		securityBondAllowance: 2n * 10n ** 18n,
		unpaidEthFees: 1n * 10n ** 18n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

function createForkAuctionProps(overrides: Partial<ForkAuctionRouteContentProps> = {}): ForkAuctionRouteContentProps {
	return {
		accountState: createAccountState(),
		forkAuctionActiveAction: undefined,
		forkAuctionDetails: undefined,
		forkAuctionError: undefined,
		forkAuctionForm: {
			claimBidIndex: '',
			claimBidTick: '',
			depositIndexes: '',
			directForkQuestionId: '',
			directForkUniverseId: '',
			refundBidIndex: '',
			refundTick: '',
			repMigrationOutcomes: '',
			securityPoolAddress: '',
			selectedOutcome: 'yes',
			submitBidAmount: '',
			submitBidTick: '',
			vaultAddress: '',
			withdrawBidIndex: '',
			withdrawForAddress: '',
			withdrawTick: '',
		},
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

function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'yes',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
}

function createSecurityPoolWorkflowProps(overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}): SecurityPoolWorkflowRouteContentProps {
	return {
		accountState: createAccountState(),
		activeUniverseId: 1n,
		checkedSecurityPoolAddress: undefined,
		closeLiquidationModal: () => undefined,
		forkAuction: createForkAuctionProps(),
		liquidationAmount: '',
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		loadingPoolOracleManager: false,
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLiquidationTargetVaultChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onRefreshSelectedPoolData: () => undefined,
		onRequestPoolPrice: () => undefined,
		onSecurityPoolAddressChange: () => undefined,
		onViewPendingReport: () => undefined,
		poolOracleActiveAction: undefined,
		poolOracleManagerDetails: undefined,
		poolOracleManagerError: undefined,
		poolPriceOracleResult: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		reporting: createReportingProps(),
		securityPoolAddress: '',
		securityPoolOverviewActiveAction: undefined,
		securityPools: [],
		securityVault: createSecurityVaultProps(),
		trading: createTradingProps(),
		...overrides,
	}
}

describe('SecurityPoolWorkflowSection', () => {
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

	test('keeps the workflow rail visible with disabled items before a pool loads', async () => {
		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...createSecurityPoolWorkflowProps()} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('tablist', { name: 'Selected pool views' })).not.toBeNull()

		for (const label of ['Vaults', 'Trading', 'Reporting', 'Fork']) {
			const button = documentQueries.getByRole('tab', { name: label }) as HTMLButtonElement
			expect(button.disabled).toBe(true)
			expect(button.title).toBe('Load a pool to open this workflow.')
		}

		expect(documentQueries.getByRole('heading', { name: 'Pool Workflows' })).not.toBeNull()
		expect(documentQueries.getByText('No pool selected.')).not.toBeNull()
		expect(documentQueries.queryByText('Locked')).toBeNull()
	})

	test('renders a vault workspace header and local mode switch for a loaded pool', async () => {
		const poolVault = createSecurityPoolVaultSummary()
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							vaultCount: 1n,
							vaults: [poolVault],
						}),
					],
					securityVault: createSecurityVaultProps({
						selectedPoolSecurityMultiplier: 2n,
						securityVaultDetails: createSecurityVaultDetails({ vaultAddress: poolVault.vaultAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Security pools' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Pool Summary' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Price Oracle' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Workflow')).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault Lookup' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Summary' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Vault' })).toBeNull()
		expect(documentQueries.getByLabelText('Selected Vault Address')).not.toBeNull()
		expect(documentQueries.getByText('Claimable Fees')).not.toBeNull()
		expect(documentQueries.getAllByText('Approved REP').length).toBeGreaterThan(0)
		expect(documentQueries.queryByText('Enter a deposit amount greater than zero.')).toBeNull()
		expect(documentQueries.queryByText('Fork Flow')).toBeNull()
		expect(documentQueries.queryByText('Oracle Status')).toBeNull()
		expect(documentQueries.queryByText('Truth Auction')).toBeNull()
		expect(documentQueries.getByText('Security Multiplier')).not.toBeNull()
		const directoryButton = documentQueries.getByRole('tab', { name: 'Directory' })
		expect(documentQueries.getByRole('tab', { name: 'Selected' })).not.toBeNull()

		await act(() => {
			fireEvent.click(directoryButton)
		})

		expect(documentQueries.getByRole('heading', { name: 'Vault Directory' })).not.toBeNull()
		expect(documentQueries.getAllByText('Locked REP').length).toBeGreaterThan(0)
	})

	test('hides the truth auction metric when the selected pool has no truth auction address', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					activeUniverseId: 1n,
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							systemState: 'poolForked',
							truthAuctionAddress: zeroAddress,
						}),
					],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Truth Auction')).toBeNull()
	})

	test('shows disabled reporting actions before market end instead of a placeholder message', async () => {
		const futureMarket = createMarketDetails({ endTime: BigInt(Math.floor(Date.now() / 1000) + 3600) })
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool({ marketDetails: futureMarket })],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Reporting' }))
		})

		expect(documentQueries.getByRole('heading', { name: 'Reporting Context' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Withdraw Escalation Deposits' })).not.toBeNull()
		expect(documentQueries.queryByText('Reporting unlocks after the market end timestamp for the selected pool.')).toBeNull()
		expect(documentQueries.getAllByText('Reporting opens after market end.').length).toBeGreaterThan(0)

		const reportButton = documentQueries.getByRole('button', { name: 'Report / Contribute On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe('Reporting opens after market end.')
	})
})
