/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from '@testing-library/dom'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from 'viem'
import { SecurityPoolWorkflowSection } from '../components/SecurityPoolWorkflowSection.js'
import { ChainTimestampContext } from '../lib/chainTimestamp.js'
import { deriveHasForkActivity } from '../lib/forkAuction.js'
import { getReportingLockedUntilMessage } from '../lib/reporting.js'
import type { AccountState } from '../types/app.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails, OracleManagerDetails, SecurityPoolVaultSummary, SecurityVaultDetails } from '../types/contracts.js'
import type { ForkAuctionRouteContentProps, ReportingRouteContentProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from './testUtils/transactionActionButton.js'

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
		onWithdrawEscalation: (_outcome, _depositIndexes) => undefined,
		reportingActiveAction: undefined,
		reportingDetails: undefined,
		reportingError: undefined,
		reportingForm: {
			reportAmount: '',
			securityPoolAddress: '',
			selectedOutcome: undefined,
			selectedWithdrawDepositIndexesByOutcome: {
				invalid: [],
				yes: [],
				no: [],
			},
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
		onRedeemRep: () => undefined,
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

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 1n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 1000n,
		requestPriceEthCost: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
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
			settlementAddress: '',
			submitBidAmount: '',
			submitBidPrice: '',
			vaultAddress: '',
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
		onMigrateEscalationDeposits: (_outcome, _depositIndexes) => undefined,
		onMigrateUnresolvedEscalation: _selectedChildOutcome => undefined,
		onMigrateRepToZoltar: _outcomes => undefined,
		onMigrateVault: () => undefined,
		onRefundLosingBids: () => undefined,
		onStartTruthAuction: () => undefined,
		onSubmitBid: (_securityPoolAddressOverride?: Address) => undefined,
		onWithdrawForkedEscalation: (_outcome, _parentDepositIndexes) => undefined,
		...overrides,
	}
}

function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	const forkAuctionDetails: ForkAuctionDetails = {
		auctionedSecurityBondAllowance: 0n,
		claimingAvailable: false,
		completeSetCollateralAmount: 0n,
		currentTime: 3n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		migrationEndsAt: undefined,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'none',
		repAtFork: 0n,
		securityPoolAddress: zeroAddress,
		systemState: 'operational',
		truthAuction: undefined,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeId: 1n,
		...overrides,
	}
	return {
		...forkAuctionDetails,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(forkAuctionDetails),
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
	const selectedPool: ListedSecurityPool = {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'none',
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
	return {
		...selectedPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(selectedPool),
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
		liquidationMaxAmount: undefined,
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		liquidationTimeoutMinutes: '30',
		loadingPoolOracleManager: false,
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLiquidationTimeoutMinutesChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onExecutePendingPoolOperation: () => undefined,
		onRefreshSelectedPoolData: () => undefined,
		onRequestPoolPrice: () => undefined,
		onSelectedPoolViewChange: () => undefined,
		onSecurityPoolAddressChange: () => undefined,
		selectedPoolRefreshNonce: 0,
		onViewPendingReport: () => undefined,
		poolOracleActiveAction: undefined,
		poolOracleManagerDetails: undefined,
		poolOracleManagerError: undefined,
		poolPriceOracleResult: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		reporting: createReportingProps(),
		selectedPoolView: '',
		securityPoolAddress: '',
		securityPoolOverviewActiveAction: undefined,
		securityPoolOverviewError: undefined,
		securityPoolOverviewResult: undefined,
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
		const secondaryGroup = documentQueries.getByRole('group', { name: 'Additional pool workflows' })
		expect(within(secondaryGroup).getByRole('tab', { name: 'Staged Operations' })).not.toBeNull()
		expect(within(secondaryGroup).getByRole('tab', { name: 'Open Oracle' })).not.toBeNull()

		for (const label of ['Vaults', 'Trading', 'Reporting', 'Fork Workflow', 'Staged Operations', 'Open Oracle']) {
			const button = documentQueries.getByRole('tab', { name: label }) as HTMLButtonElement
			expect(button.disabled).toBe(true)
			expect(button.title).toBe('Load a pool to open this workflow.')
		}
		expect(documentQueries.queryByRole('tab', { name: 'Migration' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Truth Auction' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Settlement' })).toBeNull()

		expect(documentQueries.getByRole('heading', { name: 'Pool Workflows' })).not.toBeNull()
		expect(documentQueries.getByText('No pool selected.')).not.toBeNull()
		expect(documentQueries.queryByText('Paste a security pool address or browse pools.')).toBeNull()
		expect(documentQueries.queryByText('Locked')).toBeNull()
	})

	test('shows a pool not found warning while an entered address is still unresolved', async () => {
		const unresolvedAddress = '0x00000000000000000000000000000000000000ab'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					securityPoolAddress: unresolvedAddress,
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Pool Workflows' })).not.toBeNull()
		expect(documentQueries.getByText('Pool not found.')).not.toBeNull()
		expect(documentQueries.queryByText('Refresh this address after the pool is deployed.')).toBeNull()
	})

	test('shows a pool not found card when the selected address does not resolve', async () => {
		const missingAddress = '0x00000000000000000000000000000000000000ab'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: missingAddress,
					securityPoolAddress: missingAddress,
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Pool not found' })).not.toBeNull()
		expect(documentQueries.getByText('This security pool address was not found.')).not.toBeNull()
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
		expect(documentQueries.queryByRole('heading', { name: 'Security pools' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Action Readiness')).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Open Oracle' })).toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Pool Summary' })).toBeNull()
		expect(documentQueries.queryByText('Workflow')).toBeNull()
		expect(documentQueries.getByText('Question description')).not.toBeNull()
		expect(documentQueries.getByText('Question description')).not.toBeNull()
		expect(documentQueries.getByText('Open Interest Minted')).not.toBeNull()
		expect(documentQueries.getByText('Total REP Backing')).not.toBeNull()
		expect(documentQueries.queryByText('Total Security Bond Allowance')).toBeNull()
		expect(documentQueries.getByText('Current Oracle Price')).not.toBeNull()
		expect(documentQueries.queryByText('Oracle Expires In')).toBeNull()
		const selectedPoolContext = document.body.querySelector('.sticky-object-context.static')
		if (!(selectedPoolContext instanceof HTMLElement)) throw new Error('Expected a non-sticky selected pool context card')
		const lookupLabel = within(selectedPoolContext).getByText('Security Pool Address')
		const firstSummaryMetric = within(selectedPoolContext).getByText('Total REP Backing')
		const lookupPosition = selectedPoolContext.textContent?.indexOf(lookupLabel.textContent ?? '') ?? -1
		const summaryPosition = selectedPoolContext.textContent?.indexOf(firstSummaryMetric.textContent ?? '') ?? -1
		expect(lookupPosition).toBeGreaterThanOrEqual(0)
		expect(summaryPosition).toBeGreaterThanOrEqual(0)
		expect(lookupPosition < summaryPosition).toBe(true)
		expect(documentQueries.getByRole('heading', { name: 'Vault Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Vault Lookup' })).toBeNull()
		const vaultSummaryHeading = documentQueries.getByRole('heading', { name: /Vault Summary/ })
		expect(vaultSummaryHeading).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Selected Vault' })).toBeNull()
		expect(documentQueries.getByText('Selected Vault Address')).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Vault Action Launchers' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Staged Operations' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Open Oracle' })).not.toBeNull()
		expect(documentQueries.getAllByRole('button', { name: 'Claim Fees' }).length).toBeGreaterThan(0)
		const vaultSummarySection = vaultSummaryHeading.closest('section')
		if (!(vaultSummarySection instanceof HTMLElement)) throw new Error('Expected a vault summary section')
		expect(within(vaultSummarySection).queryByText('Approved REP')).toBeNull()
		expect(documentQueries.queryByText('Enter a deposit amount greater than zero.')).toBeNull()
		expect(documentQueries.queryByText('Fork Flow')).toBeNull()
		expect(documentQueries.queryByText(/^Blocked:/)).toBeNull()
		expect(documentQueries.queryByText('Oracle Status')).toBeNull()
		expect(documentQueries.queryByText('After market end')).toBeNull()
		expect(documentQueries.queryByText('Manager')).toBeNull()
		expect(documentQueries.getAllByText('Operational').length).toBeGreaterThan(0)
		expect(documentQueries.getByText('Security Multiplier')).not.toBeNull()
		const directoryButton = documentQueries.getByRole('tab', { name: 'Directory' })
		expect(documentQueries.getByRole('tab', { name: 'Selected' })).not.toBeNull()

		await act(() => {
			fireEvent.click(directoryButton)
		})

		expect(documentQueries.getByRole('heading', { name: 'Vault Directory' })).not.toBeNull()
		expect(documentQueries.getAllByText('Locked REP').length).toBeGreaterThan(0)
	})

	test('shows a parent-pool metric for child pools in the selected summary', async () => {
		const parentPoolAddress = getAddress('0x0000000000000000000000000000000000000200')
		const parentPool = createSelectedPool({
			parent: zeroAddress,
			securityPoolAddress: parentPoolAddress,
			universeId: 1n,
		})
		const selectedPool = createSelectedPool({
			parent: parentPoolAddress,
			securityPoolAddress: getAddress('0x0000000000000000000000000000000000000201'),
			universeId: 11n,
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					securityPoolAddress: selectedPool.securityPoolAddress,
					securityPools: [parentPool, selectedPool],
					selectedPoolView: 'fork-workflow',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const parentPoolLink = documentQueries.getByRole('link', { name: '0x0000…0200' })
		expect(parentPoolLink).not.toBeNull()
		expect(document.body.textContent?.includes('Parent Pool')).toBe(true)
		expect(parentPoolLink.getAttribute('title')).toBe(parentPoolAddress)
	})

	test('does not show a parent-pool metric for root pools', async () => {
		const selectedPool = createSelectedPool({
			parent: zeroAddress,
			securityPoolAddress: getAddress('0x0000000000000000000000000000000000000202'),
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					securityPoolAddress: selectedPool.securityPoolAddress,
					securityPools: [selectedPool],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Parent Pool')).toBeNull()
	})

	test('marks selected-pool collateralization as success when it is above the multiplier threshold', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					repPerEthPrice: 10n ** 18n,
					repPerEthSource: 'mock',
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							securityMultiplier: 2n,
							totalRepDeposit: 10_000n * 10n ** 18n,
							totalSecurityBondAllowance: 2_500n * 10n ** 18n,
						}),
					],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const collateralizationMetric = document.querySelector('.security-pool-collateralization-display.tone-success, .security-pool-hero-collateralization.tone-success, .security-pool-card-title-collateralization.tone-success')
		expect(collateralizationMetric).not.toBeNull()
		expect(collateralizationMetric?.textContent?.includes('400')).toBe(true)
	})

	test('renders the claim-fees modal vault with the shared address value component', async () => {
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const poolVault = createSecurityPoolVaultSummary({ vaultAddress })
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
						securityVaultDetails: createSecurityVaultDetails({ vaultAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: vaultAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const claimFeesButton = documentQueries.getAllByRole('button', { name: 'Claim Fees' })[0]
		if (!(claimFeesButton instanceof HTMLElement)) throw new Error('Expected claim fees launcher button')

		await act(() => {
			fireEvent.click(claimFeesButton)
		})

		const dialog = documentQueries.getByRole('dialog')
		expect(within(dialog).getByRole('button', { name: `Copy address ${vaultAddress}` })).not.toBeNull()
	})

	test('auto-loads the selected vault when a routed pool opens in the vault view', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: selectedPoolAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('does not auto-load the selected vault until the vault form has the selected pool address', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: '',
							selectedVaultAddress: selectedPoolAddress,
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadSecurityVaultCalls).toEqual([])
	})

	test('treats stale loaded vault details from a different pool as unloaded', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const stalePoolAddress = getAddress('0x00000000000000000000000000000000000000b2')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: stalePoolAddress,
							vaultAddress: zeroAddress,
						}),
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Vault Summary' })).toBeNull()
		expectTransactionButtonEnabled(document.body, 'Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Withdraw REP')
		expectTransactionButtonEnabled(document.body, 'Set Bond Allowance')
		expectTransactionButtonEnabled(document.body, 'Claim Fees')
	})

	test('shows an Ended badge, allows REP redemption, and blocks ended-pool collateral actions in the vault workflow', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							questionOutcome: 'yes',
							securityPoolAddress: selectedPoolAddress,
						}),
					],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							lockedRepInEscalationGame: 0n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '1',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultRepBalance: 10n * 10n ** 18n,
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Finalized as Yes')).not.toBeNull()
		expectTransactionButtonDisabled(document.body, 'Deposit REP')
		expectTransactionButtonEnabled(document.body, 'Redeem REP')
		expectTransactionButtonDisabled(document.body, 'Set Bond Allowance')
		expectTransactionButtonEnabled(document.body, 'Claim Fees')
		expectTransactionButtonDisabled(document.body, 'Liquidate Vault')
	})

	test('shows Fork Migration in the selected-pool badge once fork migration has started', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ forkOutcome: 'yes', migratedRep: 1n, securityPoolAddress: selectedPoolAddress, systemState: 'poolForked' })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Fork Migration')).not.toBeNull()
	})

	test('disables minting in trading when the workflow state shows the selected pool has ended', async () => {
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const selectedPool = createSelectedPool({
			questionOutcome: 'none',
			securityPoolAddress: selectedPoolAddress,
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							questionOutcome: 'yes',
							securityPoolAddress: selectedPoolAddress,
						}),
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [selectedPool],
					selectedPoolView: 'trading',
					trading: createTradingProps({
						selectedPool,
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Mint complete sets')
	})

	test('allows selecting a vault from the directory within the current pool', async () => {
		const formChanges: Array<{ selectedVaultAddress?: string }> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const vaultAddress = getAddress('0x00000000000000000000000000000000000000c1')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							securityPoolAddress: selectedPoolAddress,
							vaultCount: 1n,
							vaults: [createSecurityPoolVaultSummary({ vaultAddress })],
						}),
					],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: nextVaultAddress => {
							loadSecurityVaultCalls.push(nextVaultAddress)
						},
						onSecurityVaultFormChange: update => {
							formChanges.push(update)
						},
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Directory' }))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Select Vault' }))
		})

		expect(formChanges).toContainEqual({ selectedVaultAddress: vaultAddress })
		expect(loadSecurityVaultCalls.at(-1)).toBe(vaultAddress)
	})

	test('refreshes staged operations after queueing a vault withdrawal', async () => {
		const loadPoolOracleManagerCalls: string[] = []
		const selectedPoolAddress = zeroAddress
		const managerAddress = '0x00000000000000000000000000000000000000aa'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onLoadPoolOracleManager: managerAddressInput => {
						loadPoolOracleManagerCalls.push(managerAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({ managerAddress }),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ managerAddress, securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
							stagedExecution: {
								errorMessage: undefined,
								operation: 'withdrawRep',
								operationId: 7n,
								success: true,
							},
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(loadPoolOracleManagerCalls).toEqual([managerAddress])
	})

	test('keeps the withdraw modal open and links to the queued staged operation', async () => {
		const selectedViews: string[] = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('A REP withdrawal was queued for the selected vault.')).toBeNull()
		expect(documentQueries.queryByText('Next: Review the queued entry in Staged Operations and execute it when the oracle price is valid.')).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
		expect(dialogQueries.getByText('#7')).not.toBeNull()
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' }).closest('.actions')).toBeNull()

		await act(() => {
			fireEvent.click(dialogQueries.getByRole('button', { name: 'View In Staged Operations' }))
		})

		expect(selectedViews).toEqual(['staged-operations'])
		expect(dialogQueries.getByRole('heading', { name: 'Withdraw REP' })).not.toBeNull()
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
	})

	test('shows manual execution guidance for off-slot queued withdrawals', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						pendingOperation: {
							amount: 3n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'liquidation',
							operationId: 6n,
							targetVault: '0x0000000000000000000000000000000000000001',
						},
						pendingOperationSlotId: 6n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bc',
							queuedOperation: {
								isPendingSlot: false,
								operation: 'withdrawRep',
								operationId: 11n,
							},
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Queued' })).not.toBeNull()
		expect(dialogQueries.getByText('#11')).not.toBeNull()
		expect(dialogQueries.getByText('Another staged operation already holds the auto-execute slot. Execute this staged operation manually with its id after a valid oracle price is available.')).not.toBeNull()
	})

	test('shows immediate execution when a withdraw uses an already valid oracle price', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000bb',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Executed' })).not.toBeNull()
		expect(dialogQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
		expect(dialogQueries.getByText('A valid oracle price was already available, so the withdrawal executed immediately and no staged operation was created.')).not.toBeNull()
	})

	test('shows withdraw failure details when the staged execution event reports a rejection', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails(),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000be',
							stagedExecution: {
								errorMessage: 'Local Security Bond Allowance broken',
								operation: 'withdrawRep',
								operationId: 8n,
								success: false,
							},
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		const dialogQueries = within(withdrawDialog)
		expect(dialogQueries.getByRole('heading', { name: 'REP Withdrawal Failed' })).not.toBeNull()
		expect(dialogQueries.getByText('Local Security Bond Allowance broken')).not.toBeNull()
		expect(dialogQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
	})

	test('shows liquidation successful in the selected pool workflow after an immediate execution', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					liquidationManagerAddress: zeroAddress,
					liquidationSecurityPoolAddress: selectedPoolAddress,
					liquidationTargetVault: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						managerAddress: zeroAddress,
						pendingOperation: undefined,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000c1',
						securityPoolAddress: selectedPoolAddress,
					},
					securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const dialog = within(document.body).getByRole('dialog', { name: 'Execute Vault Liquidation' })
		const dialogQueries = within(dialog)
		expect(dialogQueries.getByRole('heading', { name: 'Liquidation Executed' })).not.toBeNull()
		expect(dialogQueries.getByText('A valid oracle price was already available, so the liquidation executed immediately and no staged operation was created.')).not.toBeNull()
	})

	test('shows liquidation failed in the selected pool workflow with the revert detail', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					liquidationManagerAddress: zeroAddress,
					liquidationSecurityPoolAddress: selectedPoolAddress,
					liquidationTargetVault: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						managerAddress: zeroAddress,
						pendingOperation: undefined,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000c2',
						securityPoolAddress: selectedPoolAddress,
						stagedExecution: {
							errorMessage: 'Local Security Bond Allowance broken',
							operation: 'liquidation',
							operationId: 13n,
							success: false,
						},
					},
					securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const dialog = within(document.body).getByRole('dialog', { name: 'Execute Vault Liquidation' })
		const dialogQueries = within(dialog)
		expect(dialogQueries.getByRole('heading', { name: 'Liquidation Failed' })).not.toBeNull()
		expect(dialogQueries.getByText('Local Security Bond Allowance broken')).not.toBeNull()
	})

	test('refreshes the selected pool and loaded vault after an immediate REP withdrawal execution', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultResult: {
							action: 'queueWithdrawRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000dd',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes the selected pool and loaded vault after withdrawing escalation deposits from reporting', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					reporting: createReportingProps({
						reportingResult: {
							action: 'withdrawEscalation',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000de',
							outcome: 'yes',
							securityPoolAddress: selectedPoolAddress,
							universeId: 1n,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes loaded reporting after depositing REP into the selected vault', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const reportingLoadCalls: string[] = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					reporting: createReportingProps({
						onLoadReporting: () => {
							reportingLoadCalls.push('refresh')
						},
						reportingDetails: {
							completeSetCollateralAmount: 1n,
							currentTime: 3n,
							forkThreshold: 10n,
							marketDetails: createMarketDetails({ endTime: 0n }),
							nonDecisionThreshold: 20n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							startBond: 1n,
							status: 'not-started',
							systemState: 'operational',
							universeId: 1n,
							settlementState: 'locked',
							parentWithdrawalEnabled: false,
							viewerVaultAvailableEscalationRep: 12_000n,
							viewerVaultExists: true,
							viewerVaultLockedRepInEscalationGame: 0n,
							viewerVaultRepDepositShare: 12_000n,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultResult: {
							action: 'depositRep',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000df',
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(reportingLoadCalls).toEqual(['refresh'])
	})

	test('refreshes the selected pool and loaded vault after a liquidation resolves as queued', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					liquidationManagerAddress: zeroAddress,
					liquidationSecurityPoolAddress: selectedPoolAddress,
					liquidationTargetVault: zeroAddress,
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: false,
						managerAddress: zeroAddress,
						pendingOperation: {
							amount: 1n,
							initiatorVault: zeroAddress,
							operation: 'liquidation',
							operationId: 10n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 10n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000d1',
						securityPoolAddress: selectedPoolAddress,
					},
					securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes the selected pool and loaded vault after an immediate liquidation execution', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					liquidationManagerAddress: zeroAddress,
					liquidationSecurityPoolAddress: selectedPoolAddress,
					liquidationTargetVault: zeroAddress,
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						managerAddress: zeroAddress,
						pendingOperation: undefined,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000d2',
						securityPoolAddress: selectedPoolAddress,
					},
					securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes the selected pool and loaded vault after a failed immediate liquidation execution', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					liquidationManagerAddress: zeroAddress,
					liquidationSecurityPoolAddress: selectedPoolAddress,
					liquidationTargetVault: zeroAddress,
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						managerAddress: zeroAddress,
						pendingOperation: undefined,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000d3',
						securityPoolAddress: selectedPoolAddress,
						stagedExecution: {
							errorMessage: 'Local Security Bond Allowance broken',
							operation: 'liquidation',
							operationId: 14n,
							success: false,
						},
					},
					securityPools: [createSelectedPool({ managerAddress: zeroAddress, securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes the selected pool and loaded vault after executing a staged operation', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000cc',
					},
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('refreshes loaded reporting after executing a staged REP withdrawal', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const reportingLoadCalls: string[] = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000cf',
						stagedExecution: {
							errorMessage: undefined,
							operation: 'withdrawRep',
							operationId: 15n,
							success: true,
						},
					},
					reporting: createReportingProps({
						onLoadReporting: () => {
							reportingLoadCalls.push('refresh')
						},
						reportingDetails: {
							completeSetCollateralAmount: 1n,
							currentTime: 3n,
							forkThreshold: 10n,
							marketDetails: createMarketDetails({ endTime: 0n }),
							nonDecisionThreshold: 20n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							startBond: 1n,
							status: 'not-started',
							systemState: 'operational',
							universeId: 1n,
							settlementState: 'locked',
							parentWithdrawalEnabled: false,
							viewerVaultAvailableEscalationRep: 12_000n,
							viewerVaultExists: true,
							viewerVaultLockedRepInEscalationGame: 0n,
							viewerVaultRepDepositShare: 12_000n,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(reportingLoadCalls).toEqual(['refresh'])
	})

	test('refreshes the selected pool after a failed staged operation execution', async () => {
		const refreshSelectedPoolCalls: Array<string | undefined> = []
		const loadSecurityVaultCalls: Array<string | undefined> = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshSelectedPoolCalls.push(securityPoolAddressInput)
					},
					poolPriceOracleResult: {
						action: 'executeStagedOperation',
						hash: '0x00000000000000000000000000000000000000000000000000000000000000ce',
						stagedExecution: {
							errorMessage: 'Local Security Bond Allowance broken',
							operation: 'withdrawRep',
							operationId: 12n,
							success: false,
						},
					},
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						managerAddress: zeroAddress,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: vaultAddress => {
							loadSecurityVaultCalls.push(vaultAddress)
						},
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress, vaultAddress: zeroAddress }),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshSelectedPoolCalls).toEqual([selectedPoolAddress])
		expect(loadSecurityVaultCalls).toEqual([])
	})

	test('opens vault launchers even before a selected vault is loaded', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					securityVault: createSecurityVaultProps({
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '1',
							securityPoolAddress: zeroAddress,
							selectedVaultAddress: '',
						},
					}),
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const depositLauncherButton = documentQueries.getByRole('button', { name: 'Deposit REP' })
		if (!(depositLauncherButton instanceof HTMLElement)) throw new Error('Expected deposit launcher button')

		expect(depositLauncherButton.hasAttribute('disabled')).toBe(false)

		await act(() => {
			fireEvent.click(depositLauncherButton)
		})

		const dialog = documentQueries.getByRole('dialog')
		expect(within(dialog).getByText('Refresh the selected vault before depositing REP.')).not.toBeNull()
	})

	test('keeps REP approval guidance inside the approval control in the deposit modal', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({ securityPoolAddress: selectedPoolAddress }),
						securityVaultForm: {
							depositAmount: '10',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
						securityVaultRepBalance: 25n * 10n ** 18n,
						securityVaultRepApproval: {
							error: undefined,
							loading: false,
							value: 0n,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Deposit REP' })[0] as HTMLElement)
		})

		const depositDialog = documentQueries.getByRole('dialog', { name: 'Deposit REP' })
		const modalQueries = within(depositDialog)
		expect(modalQueries.queryByText('Review the selected vault, complete REP approval if needed, then deposit REP.')).toBeNull()
		expect(modalQueries.queryByText('REP approval is sufficient for the deposit amount')).toBeNull()
		expect(modalQueries.queryByText('Approve REP inside this modal before depositing.')).toBeNull()
		expect(modalQueries.getByText('Wallet REP')).not.toBeNull()
		expect(modalQueries.getByText('Required REP')).not.toBeNull()
		expect(modalQueries.getByText('REP Approval Amount')).not.toBeNull()
	})

	test('caps REP withdrawals to the oracle-backed amount in the seeded security-pool shape', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 10_000n * 10n ** 18n,
							totalSecurityBondAllowance: 2_500n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 10_000n * 10n ** 18n,
							securityBondAllowance: 2_500n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '10000',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Reduce the withdrawal to 2 500 REP or less.')
	})

	test('fills the set bond allowance input from the backed Max amount', async () => {
		const selectedPoolAddress = zeroAddress
		const formChanges: Array<{ securityBondAllowanceAmount?: string }> = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						onSecurityVaultFormChange: update => {
							formChanges.push(update)
						},
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		await act(() => {
			fireEvent.click(within(allowanceDialog).getByRole('button', { name: 'Security Bond Allowance Amount' }))
		})

		expect(formChanges.at(-1)).toEqual({ securityBondAllowanceAmount: '1.999999999999999999' })
	})

	test('allows clearing the bond allowance back to zero in the workflow modal', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 2n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalance: 2n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '0',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		expect(within(allowanceDialog).queryByText(/^Blocked:/)).toBeNull()
		expectTransactionButtonEnabled(allowanceDialog as HTMLElement, 'Set Security Bond Allowance')
	})

	test('blocks the workflow bond-allowance modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
						requestPriceEthCost: 10n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '0',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Set Bond Allowance' })[0] as HTMLElement)
		})

		const allowanceDialog = documentQueries.getByRole('dialog', { name: 'Set Bond Allowance' })
		expectTransactionButtonDisabled(allowanceDialog as HTMLElement, 'Set Security Bond Allowance', 'Need 7 more ETH in this wallet to queue this bond allowance update.')
	})

	test('blocks withdraw REP in the workflow modal when the wallet lacks the buffered oracle bounty ETH', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
					poolOracleManagerDetails: createOracleManagerDetails({
						isPriceValid: true,
						lastPrice: 3n * 10n ** 18n,
						requestPriceEthCost: 10n * 10n ** 18n,
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							managerAddress: zeroAddress,
							securityPoolAddress: selectedPoolAddress,
							totalRepDeposit: 9n * 10n ** 18n,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
					],
					securityVault: createSecurityVaultProps({
						accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
						securityVaultDetails: createSecurityVaultDetails({
							repDepositShare: 12n * 10n ** 18n,
							securityBondAllowance: 1n * 10n ** 18n,
							securityPoolAddress: selectedPoolAddress,
							totalSecurityBondAllowance: 2n * 10n ** 18n,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '1',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'vaults',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getAllByRole('button', { name: 'Withdraw REP' })[0] as HTMLElement)
		})

		const withdrawDialog = documentQueries.getByRole('dialog', { name: 'Withdraw REP' })
		expectTransactionButtonDisabled(withdrawDialog as HTMLElement, 'Withdraw REP', 'Need 7 more ETH in this wallet to queue this REP withdrawal.')
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

		const selectedPoolSummary = document.body.querySelector('.selected-pool-context-summary')
		if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary')
		const summaryLabels = Array.from(selectedPoolSummary.querySelectorAll('.metric-label')).map(element => element.textContent?.trim() ?? '')
		expect(summaryLabels).not.toContain('Truth Auction')
	})

	test('shows disabled reporting actions before market end instead of a placeholder message', async () => {
		const futureMarket = createMarketDetails({ endTime: 1_700_003_600n })
		const expectedLockedReason = getReportingLockedUntilMessage(futureMarket.endTime, 1_700_000_000n)
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_700_000_000n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ marketDetails: futureMarket })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('heading', { name: 'Question' }).length).toBe(1)
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Reporting Not Enabled' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Outcome Sides' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Escalation Metrics' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(documentQueries.queryByText('Load reporting details to populate live stakes, bond progression, and deposit indexes.')).toBeNull()
		expect(documentQueries.queryByText('Reporting unlocks after the market end timestamp for the selected pool.')).toBeNull()
		expect(documentQueries.queryByText(expectedLockedReason)).not.toBeNull()
		expect(document.body.querySelectorAll('.escalation-side')).toHaveLength(3)
		expect(document.body.textContent?.includes('Your deposits: None')).toBe(false)
		expect(document.body.textContent?.includes('Projected payout for current amount')).toBe(false)
		expect(document.body.textContent?.includes('Projected profit if this side wins')).toBe(false)

		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe(expectedLockedReason)
	})

	test('locks reporting actions while the selected pool is not operational', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1_700_000_000n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						reporting: createReportingProps({
							reportingDetails: {
								activationTime: 1_699_999_000n,
								bindingCapital: 5n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 1_700_000_000n,
								escalationEndTime: 1_700_000_500n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 10n,
								hasReachedNonDecision: false,
								marketDetails: createMarketDetails({ endTime: 0n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: zeroAddress,
								sides: [
									{ balance: 1n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 5n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 2n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'forkTruthAuction',
								totalCost: 2n,
								universeId: 1n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
								viewerVaultAvailableEscalationRep: 10n,
								viewerVaultExists: true,
								viewerVaultLockedRepInEscalationGame: 0n,
								viewerVaultRepDepositShare: 10n,
							},
						}),
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ securityPoolAddress: zeroAddress, systemState: 'forkTruthAuction' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' })
		if (!(reportButton instanceof HTMLButtonElement)) throw new Error('Expected report button')
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe('This pool is in truth auction. Reporting actions unlock once the pool becomes operational.')
	})

	test('uses the shared chain timestamp context for oracle expiry text', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n + 60n * 60n + 60n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [
							createSelectedPool({
								lastOraclePrice: 3n * 10n ** 18n,
								lastOracleSettlementTimestamp: 1n,
							}),
						],
						selectedPoolView: 'price-oracle',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('(expired 1m ago)')).toBe(true)
	})

	test('uses the shared chain timestamp context to unlock reporting after market end', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={150n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 100n }) })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const reportButton = documentQueries.getByRole('button', { name: 'Report On Selected Side' }) as HTMLButtonElement
		expect(reportButton.disabled).toBe(true)
		expect(reportButton.title).toBe('Load reporting details before reporting on an outcome.')
	})

	test('renders staged operations management inside the staged operations tab instead of a standalone section', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
						pendingReportId: 0n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('tab', { name: 'Staged Operations' }) as HTMLElement).getAttribute('aria-selected')).toBe('true')
		expect(documentQueries.getByRole('heading', { name: 'Staged Operations' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Pool Oracle & Pending Operations' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Staged Operations List' })).not.toBeNull()
		expect(documentQueries.getByText('No staged operations are currently queued for this pool.')).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Request New Price' })).toBeNull()
	})

	test('lists staged operations in the staged operations tab', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						activeStagedOperationCount: 4n,
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
						pendingReportId: 12n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Withdraw REP')).not.toBeNull()
		expect(documentQueries.getByText('7')).not.toBeNull()
		expect(documentQueries.getByText('Showing 1 of 4 active staged operations, newest first.')).not.toBeNull()
		expect(documentQueries.queryByText('Pending Price Request')).toBeNull()
	})

	test('does not show staged-operation cancellation actions', async () => {
		const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const targetVault = getAddress('0x00000000000000000000000000000000000000a2')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: walletAddress }),
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						pendingOperation: {
							amount: 1n,
							initiatorVault: walletAddress,
							operation: 'liquidation',
							operationId: 9n,
							targetVault,
						},
						pendingOperationSlotId: 9n,
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Cancel Staged Operation' })).toBeNull()
	})

	test('blocks staged-operation execution after the selected pool has ended', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: {
							amount: 5n * 10n ** 18n,
							initiatorVault: zeroAddress,
							operation: 'withdrawRep',
							operationId: 7n,
							targetVault: zeroAddress,
						},
						pendingOperationSlotId: 7n,
						pendingReportId: 0n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [
						createSelectedPool({
							questionOutcome: 'yes',
						}),
					],
					selectedPoolView: 'staged-operations',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Execute Staged Operation')
	})

	test('renders price oracle details and request controls in the price oracle tab', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: {
						callbackStateHash: undefined,
						exactToken1Report: undefined,
						isPriceValid: true,
						lastPrice: 2n * 10n ** 18n,
						lastSettlementTimestamp: 100n,
						managerAddress: zeroAddress,
						openOracleAddress: zeroAddress,
						pendingOperation: undefined,
						pendingOperationSlotId: 0n,
						pendingReportId: 12n,
						priceValidUntilTimestamp: 1000n,
						requestPriceEthCost: 1n,
						token1: zeroAddress,
						token2: zeroAddress,
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'price-oracle',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('tab', { name: 'Open Oracle' }) as HTMLElement).getAttribute('aria-selected')).toBe('true')
		const priceOracleSection = documentQueries.getByRole('heading', { name: 'Open Oracle' }).closest('section')
		if (!(priceOracleSection instanceof HTMLElement)) throw new Error('Expected the Open Oracle section to render')
		const sectionQueries = within(priceOracleSection)
		expect(sectionQueries.getByRole('heading', { name: 'Open Oracle' })).not.toBeNull()
		expect(sectionQueries.getByText('Open Oracle Price')).not.toBeNull()
		expect(sectionQueries.queryByText('Price Window')).toBeNull()
		expect(sectionQueries.queryByText('Last Settlement')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Request New Price' })).not.toBeNull()
		expect(sectionQueries.getByText('Pending Request')).not.toBeNull()
		expect(sectionQueries.getByRole('button', { name: /Report #\s*12/ })).not.toBeNull()
	})

	test('disables Request New Price when the wallet lacks the buffered oracle bounty ETH', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ ethBalance: 5n * 10n ** 18n }),
					checkedSecurityPoolAddress: zeroAddress,
					poolOracleManagerDetails: createOracleManagerDetails({
						pendingReportId: 0n,
						requestPriceEthCost: 10n * 10n ** 18n,
					}),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'price-oracle',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expectTransactionButtonDisabled(document.body, 'Request New Price', 'Need 7 more ETH in this wallet to request a new price.')
	})

	test('uses the lifted selected pool view state and reports tab changes through the shared setter', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('tab', { name: 'Reporting' }) as HTMLElement).getAttribute('aria-selected')).toBe('true')

		expect(documentQueries.queryByRole('tab', { name: 'Withdraw Escalation Deposits' })).toBeNull()
		expect(selectedViews).toEqual([])
	})

	test('shows the shared question card above the reporting tab, including settlement controls', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: zeroAddress,
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getAllByRole('heading', { name: 'Question' }).length).toBe(1)
		expect(documentQueries.getByRole('heading', { name: 'Settle Escalation Deposits' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Reporting Context' })).toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Report Outcome' })).not.toBeNull()
	})

	test('does not offer Open Fork Workflow before the pool has entered its fork workflow', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					reporting: createReportingProps({
						reportingDetails: {
							activationTime: 120n,
							bindingCapital: 10n,
							completeSetCollateralAmount: 1n,
							currentRequiredBond: 2n,
							currentTime: 150n,
							escalationEndTime: 300n,
							escalationGameAddress: zeroAddress,
							forkThreshold: 40n,
							hasReachedNonDecision: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							nonDecisionThreshold: 20n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							sides: [
								{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
								{
									balance: 20n,
									deposits: [],
									importedUserDeposits: [],
									key: 'yes',
									label: 'Yes',
									userDeposits: [
										{
											amount: 1n,
											cumulativeAmount: 1n,
											depositIndex: 0n,
											depositor: zeroAddress,
										},
									],
								},
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
							],
							startBond: 1n,
							status: 'active',
							systemState: 'operational',
							totalCost: 40n,
							universeId: 1n,
							viewerVaultAvailableEscalationRep: 12_000n,
							viewerVaultExists: true,
							viewerVaultLockedRepInEscalationGame: 2n,
							viewerVaultRepDepositShare: 12_000n,
							settlementState: 'locked',
							parentWithdrawalEnabled: false,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress, systemState: 'operational' })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Open Fork Workflow' })).toBeNull()
	})

	test('opens the concrete migration stage when the pool is already inside its fork workflow', async () => {
		const selectedViews: string[] = []
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							forkOutcome: 'yes',
							hasForkActivity: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							migratedRep: 1n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							systemState: 'poolForked',
						}),
					}),
					onSelectedPoolViewChange: view => {
						selectedViews.push(view ?? '')
					},
					reporting: createReportingProps({
						reportingDetails: {
							activationTime: 120n,
							bindingCapital: 10n,
							completeSetCollateralAmount: 1n,
							currentRequiredBond: 2n,
							currentTime: 150n,
							escalationEndTime: 300n,
							escalationGameAddress: zeroAddress,
							forkThreshold: 40n,
							hasReachedNonDecision: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							nonDecisionThreshold: 20n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							sides: [
								{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
							],
							startBond: 1n,
							status: 'active',
							systemState: 'operational',
							totalCost: 40n,
							universeId: 1n,
							viewerVaultAvailableEscalationRep: 12_000n,
							viewerVaultExists: true,
							viewerVaultLockedRepInEscalationGame: 2n,
							viewerVaultRepDepositShare: 12_000n,
							settlementState: 'locked',
							parentWithdrawalEnabled: false,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ forkOutcome: 'yes', marketDetails: createMarketDetails({ endTime: 2n }), migratedRep: 1n, securityPoolAddress: selectedPoolAddress, systemState: 'poolForked' })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('tab', { name: 'Fork Workflow' }))
		})

		expect(selectedViews).toEqual(['fork-workflow'])
	})

	test('defaults the fork workflow to the current stage on first render', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							forkOutcome: 'yes',
							migratedRep: 1n,
							securityPoolAddress: selectedPoolAddress,
							systemState: 'forkTruthAuction',
							truthAuctionStartedAt: 1n,
						}),
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							forkOutcome: 'yes',
							migratedRep: 1n,
							securityPoolAddress: selectedPoolAddress,
							systemState: 'forkTruthAuction',
							truthAuctionStartedAt: 1n,
						}),
					],
					selectedPoolView: 'fork-workflow',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Truth Auction Status' })).not.toBeNull()
		expect(documentQueries.queryByRole('heading', { name: 'Fork Triggered' })).toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Truth Auction' }).className.includes('is-selected')).toBe(true)
	})

	test('opens the migration step for root-universe pools that present as Fork Migration after universe fork', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					securityPoolAddress: selectedPoolAddress,
					securityPools: [
						createSelectedPool({
							securityPoolAddress: selectedPoolAddress,
							systemState: 'operational',
							universeHasForked: true,
						}),
					],
					selectedPoolView: 'fork-migration',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Migration Status' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Migration' }).className.includes('is-selected')).toBe(true)
		expect(document.body.textContent?.includes('This step becomes active once the fork has been triggered.')).toBe(false)
	})

	test('advances the selected fork workflow panel when fresh fork details load a later current stage', async () => {
		const selectedPoolAddress = zeroAddress
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			forkAuction: createForkAuctionProps(),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [
				createSelectedPool({
					forkOutcome: 'yes',
					migratedRep: 1n,
					securityPoolAddress: selectedPoolAddress,
					systemState: 'operational',
					truthAuctionStartedAt: 1n,
				}),
			],
			selectedPoolView: 'fork-workflow',
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		let documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Settlement Status' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-selected')).toBe(true)

		await act(async () => {
			render(
				<SecurityPoolWorkflowSection
					{...baseProps}
					forkAuction={createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							claimingAvailable: false,
							forkOutcome: 'yes',
							migratedRep: 1n,
							securityPoolAddress: selectedPoolAddress,
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
							truthAuctionStartedAt: 1n,
						}),
					})}
					showHeader={false}
				/>,
				renderedComponent.container,
			)
		})

		documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Settlement Status' })).not.toBeNull()
		expect(documentQueries.getByRole('heading', { name: 'Child Security Pools' })).not.toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Settlement' }).className.includes('is-selected')).toBe(true)
		expect(documentQueries.queryByRole('tab', { name: 'New Security Pools' })).toBeNull()
	})

	test('shows Trigger Zoltar Fork in the reporting workflow after non-decision', async () => {
		let triggerZoltarForkCalls = 0
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						onForkWithOwnEscalation: () => {
							triggerZoltarForkCalls += 1
						},
					}),
					reporting: createReportingProps({
						reportingDetails: {
							activationTime: 120n,
							bindingCapital: 10n,
							completeSetCollateralAmount: 1n,
							currentRequiredBond: 2n,
							currentTime: 150n,
							escalationEndTime: 300n,
							escalationGameAddress: zeroAddress,
							forkThreshold: 40n,
							hasReachedNonDecision: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							nonDecisionThreshold: 20n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							sides: [
								{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
							],
							startBond: 1n,
							status: 'active',
							systemState: 'operational',
							totalCost: 40n,
							universeId: 1n,
							viewerVaultAvailableEscalationRep: 12_000n,
							viewerVaultExists: true,
							viewerVaultLockedRepInEscalationGame: 2n,
							viewerVaultRepDepositShare: 12_000n,
							settlementState: 'locked',
							parentWithdrawalEnabled: false,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress, systemState: 'operational' })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expectTransactionButtonEnabled(document.body, 'Trigger Zoltar Fork')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Trigger Zoltar Fork' }))
		})

		expect(triggerZoltarForkCalls).toBe(1)
	})

	test('hides Trigger Zoltar Fork after the pool has already entered its fork workflow and keeps Open Fork Workflow available', async () => {
		const selectedPoolAddress = zeroAddress
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							forkOutcome: 'yes',
							hasForkActivity: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							migratedRep: 1n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							systemState: 'poolForked',
						}),
					}),
					reporting: createReportingProps({
						reportingDetails: {
							activationTime: 120n,
							bindingCapital: 10n,
							completeSetCollateralAmount: 1n,
							currentRequiredBond: 2n,
							currentTime: 150n,
							escalationEndTime: 300n,
							escalationGameAddress: zeroAddress,
							forkThreshold: 40n,
							hasReachedNonDecision: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							nonDecisionThreshold: 20n,
							questionOutcome: 'none',
							securityPoolAddress: selectedPoolAddress,
							sides: [
								{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
								{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
							],
							startBond: 1n,
							status: 'active',
							systemState: 'operational',
							totalCost: 40n,
							universeId: 1n,
							viewerVaultAvailableEscalationRep: 12_000n,
							viewerVaultExists: true,
							viewerVaultLockedRepInEscalationGame: 2n,
							viewerVaultRepDepositShare: 12_000n,
							settlementState: 'locked',
							parentWithdrawalEnabled: false,
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ forkOutcome: 'yes', marketDetails: createMarketDetails({ endTime: 2n }), migratedRep: 1n, securityPoolAddress: selectedPoolAddress, systemState: 'poolForked' })],
					selectedPoolView: 'reporting',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Trigger Zoltar Fork' })).toBeNull()
		expect(documentQueries.getByRole('tab', { name: 'Fork Workflow' })).not.toBeNull()
		expect(document.body.textContent?.includes('Fork Migration')).toBe(true)
	})

	test('prefers fresh fork-auction activity over stale pool-list state on the fork tab', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = zeroAddress
		const freshTruthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							completeSetCollateralAmount: 2n,
							forkOutcome: 'yes',
							forkOwnSecurityPool: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							migratedRep: 5n,
							securityPoolAddress: selectedPoolAddress,
							systemState: 'operational',
							truthAuctionAddress: freshTruthAuctionAddress,
						}),
					}),
					reporting: createReportingProps({
						onLoadReporting: () => {
							reportingLoadCalls += 1
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ completeSetCollateralAmount: 0n, marketDetails: createMarketDetails({ endTime: 2n }), securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionAddress: zeroAddress })],
					selectedPoolView: 'fork-migration',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectedPoolSummary = document.body.querySelector('.selected-pool-context-summary')
		if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary to render')
		const selectedPoolSummaryQueries = within(selectedPoolSummary)
		expect(reportingLoadCalls).toBe(0)
		expect(documentQueries.queryByText('This pool is currently operational, so fork and truth auction actions are read only.')).toBeNull()
		expect(selectedPoolSummaryQueries.queryByText('Fork Mode')).toBeNull()
		expect(selectedPoolSummaryQueries.queryByText('Fork Outcome')).toBeNull()
		expect(selectedPoolSummary.textContent?.includes(freshTruthAuctionAddress)).toBe(false)
	})

	test('prefers fresh operational selected-pool state over stale fork-auction details on the fork tab', async () => {
		let forkAuctionLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f2')
		const staleTruthAuctionAddress = getAddress('0x00000000000000000000000000000000000000f3')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							completeSetCollateralAmount: 2n,
							forkOutcome: 'yes',
							forkOwnSecurityPool: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							migratedRep: 5n,
							securityPoolAddress: selectedPoolAddress,
							systemState: 'forkTruthAuction',
							truthAuctionAddress: staleTruthAuctionAddress,
							truthAuctionStartedAt: 10n,
						}),
						onLoadForkAuction: () => {
							forkAuctionLoadCalls += 1
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ forkOutcome: 'yes', marketDetails: createMarketDetails({ endTime: 2n }), migratedRep: 5n, securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionStartedAt: 10n })],
					selectedPoolView: 'fork-workflow',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const selectedPoolSummary = document.body.querySelector('.selected-pool-context-summary')
		if (!(selectedPoolSummary instanceof HTMLElement)) throw new Error('Expected selected pool summary to render')
		const settlementStageTab = documentQueries.getByRole('tab', { name: 'Settlement' })
		expect(forkAuctionLoadCalls).toBe(1)
		expect(settlementStageTab.getAttribute('aria-current')).toBe('step')
		expect(selectedPoolSummary.textContent?.includes(staleTruthAuctionAddress)).toBe(false)
	})

	test('reloads fork-auction details instead of trusting stale same-address operational details after the pool enters fork mode', async () => {
		let forkAuctionLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000fa')
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionDetails: createForkAuctionDetails({
							completeSetCollateralAmount: 2n,
							forkOutcome: 'yes',
							forkOwnSecurityPool: true,
							hasForkActivity: true,
							marketDetails: createMarketDetails({ endTime: 2n }),
							migratedRep: 5n,
							questionOutcome: 'yes',
							securityPoolAddress: selectedPoolAddress,
							systemState: 'operational',
							truthAuctionStartedAt: 0n,
						}),
						onLoadForkAuction: () => {
							forkAuctionLoadCalls += 1
						},
					}),
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'forkTruthAuction', truthAuctionStartedAt: 10n })],
					selectedPoolView: 'fork-workflow',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(forkAuctionLoadCalls).toBe(1)
	})

	test('reloads reporting instead of trusting stale same-address reporting details once the pool is operational again', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f4')
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={150n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingDetails: {
								activationTime: 120n,
								bindingCapital: 10n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 150n,
								escalationEndTime: 300n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 40n,
								hasReachedNonDecision: false,
								marketDetails: createMarketDetails({ endTime: 2n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'forkTruthAuction',
								totalCost: 40n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultLockedRepInEscalationGame: 2n,
								viewerVaultRepDepositShare: 12_000n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: undefined,
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ forkOutcome: 'yes', hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionStartedAt: 10n })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(reportingLoadCalls).toBe(1)
		})
		expect(document.body.textContent?.includes('This pool is in truth auction. Reporting actions unlock once the pool becomes operational.')).toBe(false)
		expect(documentQueries.queryByText('Market finalized as Yes')).toBeNull()
	})

	test('reloads reporting instead of trusting stale same-address operational reporting details after the pool enters fork mode', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000fb')
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={150n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingDetails: {
								activationTime: 120n,
								bindingCapital: 10n,
								completeSetCollateralAmount: 1n,
								currentRequiredBond: 2n,
								currentTime: 150n,
								escalationEndTime: 300n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 40n,
								hasReachedNonDecision: false,
								marketDetails: createMarketDetails({ endTime: 2n }),
								nonDecisionThreshold: 20n,
								questionOutcome: 'yes',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 1n,
								status: 'active',
								systemState: 'operational',
								totalCost: 40n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 12_000n,
								viewerVaultExists: true,
								viewerVaultLockedRepInEscalationGame: 2n,
								viewerVaultRepDepositShare: 12_000n,
								settlementState: 'resolved',
								parentWithdrawalEnabled: true,
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: undefined,
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'forkTruthAuction' })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(reportingLoadCalls).toBe(1)
		})
	})

	test('reloads same-address reporting details after a selected-pool refresh', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f5')
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
				reportingDetails: {
					activationTime: 120n,
					bindingCapital: 10n,
					completeSetCollateralAmount: 1n,
					currentRequiredBond: 2n,
					currentTime: 150n,
					escalationEndTime: 300n,
					escalationGameAddress: zeroAddress,
					forkThreshold: 40n,
					hasReachedNonDecision: false,
					marketDetails: createMarketDetails({ endTime: 2n }),
					nonDecisionThreshold: 20n,
					questionOutcome: 'yes',
					securityPoolAddress: selectedPoolAddress,
					sides: [
						{ balance: 7n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
						{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: 20n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
					],
					startBond: 1n,
					status: 'active',
					systemState: 'operational',
					totalCost: 40n,
					universeId: 1n,
					viewerVaultAvailableEscalationRep: 12_000n,
					viewerVaultExists: true,
					viewerVaultLockedRepInEscalationGame: 2n,
					viewerVaultRepDepositShare: 12_000n,
					settlementState: 'resolved',
					parentWithdrawalEnabled: true,
				},
				reportingForm: {
					reportAmount: '',
					securityPoolAddress: selectedPoolAddress,
					selectedOutcome: undefined,
					selectedWithdrawDepositIndexesByOutcome: {
						invalid: [],
						yes: [],
						no: [],
					},
				},
			}),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ hasForkActivity: false, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'operational' })],
			selectedPoolView: 'reporting',
			selectedPoolRefreshNonce: 0,
		})

		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={150n}>
				<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(reportingLoadCalls).toBe(0)

		await act(() => {
			render(
				<ChainTimestampContext.Provider value={150n}>
					<SecurityPoolWorkflowSection {...baseProps} selectedPoolRefreshNonce={1} showHeader={false} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(reportingLoadCalls).toBe(1)
		})
	})

	test('reloads same-address fork auction details after a selected-pool refresh', async () => {
		let forkAuctionLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000f6')
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			forkAuction: createForkAuctionProps({
				forkAuctionDetails: createForkAuctionDetails({
					completeSetCollateralAmount: 2n,
					forkOutcome: 'yes',
					forkOwnSecurityPool: true,
					hasForkActivity: true,
					marketDetails: createMarketDetails({ endTime: 2n }),
					migratedRep: 5n,
					questionOutcome: 'yes',
					securityPoolAddress: selectedPoolAddress,
					systemState: 'operational',
					truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f7'),
				}),
				onLoadForkAuction: () => {
					forkAuctionLoadCalls += 1
				},
			}),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ hasForkActivity: true, marketDetails: createMarketDetails({ endTime: 2n }), questionOutcome: 'yes', securityPoolAddress: selectedPoolAddress, systemState: 'operational', truthAuctionAddress: getAddress('0x00000000000000000000000000000000000000f7') })],
			selectedPoolView: 'fork-workflow',
			selectedPoolRefreshNonce: 0,
		})

		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(forkAuctionLoadCalls).toBe(0)

		await act(() => {
			render(<SecurityPoolWorkflowSection {...baseProps} selectedPoolRefreshNonce={1} showHeader={false} />, renderedComponent.container)
		})

		await waitFor(() => {
			expect(forkAuctionLoadCalls).toBe(1)
		})
	})

	test('autoloads reporting once after the reporting form pool matches the selected pool', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000a1')
		const stalePoolAddress = getAddress('0x00000000000000000000000000000000000000a2')
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: createReportingProps({
				onLoadReporting: () => {
					reportingLoadCalls += 1
				},
				reportingForm: {
					reportAmount: '',
					securityPoolAddress: '',
					selectedOutcome: 'yes',
					selectedWithdrawDepositIndexesByOutcome: {
						invalid: [],
						yes: [],
						no: [],
					},
				},
			}),
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
			selectedPoolView: 'reporting',
		})

		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n}>
				<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(reportingLoadCalls).toBe(0)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection
						{...baseProps}
						reporting={createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: stalePoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(0)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection
						{...baseProps}
						reporting={createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection
						{...baseProps}
						reporting={createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						})}
						showHeader={false}
					/>
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(1)
	})

	test('re-arms reporting autoload after leaving and re-entering the reporting tab', async () => {
		let reportingLoadCalls = 0
		const selectedPoolAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const reportingProps = createReportingProps({
			onLoadReporting: () => {
				reportingLoadCalls += 1
			},
			reportingForm: {
				reportAmount: '',
				securityPoolAddress: selectedPoolAddress,
				selectedOutcome: 'yes',
				selectedWithdrawDepositIndexesByOutcome: {
					invalid: [],
					yes: [],
					no: [],
				},
			},
		})
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: selectedPoolAddress,
			reporting: reportingProps,
			securityPoolAddress: selectedPoolAddress,
			securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
		})

		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n}>
				<SecurityPoolWorkflowSection {...baseProps} selectedPoolView='reporting' showHeader={false} />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection {...baseProps} selectedPoolView='vaults' showHeader={false} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(1)

		await act(async () => {
			render(
				<ChainTimestampContext.Provider value={1n}>
					<SecurityPoolWorkflowSection {...baseProps} selectedPoolView='reporting' showHeader={false} />
				</ChainTimestampContext.Provider>,
				renderedComponent.container,
			)
		})

		expect(reportingLoadCalls).toBe(2)
	})

	test('retries fork autoload on rerender until matching details are available', async () => {
		let forkLoadCalls = 0
		const baseProps = createSecurityPoolWorkflowProps({
			checkedSecurityPoolAddress: zeroAddress,
			forkAuction: createForkAuctionProps({
				onLoadForkAuction: () => {
					forkLoadCalls += 1
				},
			}),
			securityPoolAddress: zeroAddress,
			securityPools: [createSelectedPool()],
			selectedPoolView: 'fork-migration',
		})

		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...baseProps} showHeader={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(forkLoadCalls).toBe(1)

		await act(async () => {
			render(
				<SecurityPoolWorkflowSection
					{...baseProps}
					forkAuction={createForkAuctionProps({
						onLoadForkAuction: () => {
							forkLoadCalls += 1
						},
					})}
					showHeader={false}
				/>,
				renderedComponent.container,
			)
		})

		expect(forkLoadCalls).toBe(2)
	})

	test('refreshes the selected pool and current vault after finalized auction settlement', async () => {
		const selectedPoolAddress = zeroAddress
		let refreshedPoolAddress: string | undefined
		let vaultLoadCalls = 0
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState(),
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						forkAuctionResult: {
							action: 'claimAuctionProceeds',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000ca',
							securityPoolAddress: selectedPoolAddress,
							universeId: 1n,
						},
					}),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshedPoolAddress = securityPoolAddressInput
					},
					securityPoolAddress: selectedPoolAddress,
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
					securityVault: createSecurityVaultProps({
						onLoadSecurityVault: () => {
							vaultLoadCalls += 1
						},
						securityVaultDetails: createSecurityVaultDetails({
							securityPoolAddress: selectedPoolAddress,
							vaultAddress: zeroAddress,
						}),
						securityVaultForm: {
							depositAmount: '',
							repWithdrawAmount: '',
							securityBondAllowanceAmount: '',
							securityPoolAddress: selectedPoolAddress,
							selectedVaultAddress: zeroAddress,
						},
					}),
					selectedPoolView: 'fork-migration',
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshedPoolAddress).toBe(selectedPoolAddress)
		expect(vaultLoadCalls).toBe(1)
	})

	test('refreshes the selected pool after starting truth auction', async () => {
		const selectedPoolAddress = zeroAddress
		let refreshedPoolAddress: string | undefined
		const loadedForkAuctionAddresses: string[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					checkedSecurityPoolAddress: selectedPoolAddress,
					forkAuction: createForkAuctionProps({
						onLoadForkAuction: securityPoolAddressOverride => {
							if (securityPoolAddressOverride !== undefined) loadedForkAuctionAddresses.push(securityPoolAddressOverride)
						},
						forkAuctionResult: {
							action: 'startTruthAuction',
							hash: '0x00000000000000000000000000000000000000000000000000000000000000cc',
							securityPoolAddress: selectedPoolAddress,
							universeId: 1n,
						},
					}),
					onRefreshSelectedPoolData: securityPoolAddressInput => {
						refreshedPoolAddress = securityPoolAddressInput
					},
					securityPoolAddress: selectedPoolAddress,
					selectedPoolView: 'fork-migration',
					securityPools: [createSelectedPool({ securityPoolAddress: selectedPoolAddress })],
				})}
				showHeader={false}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshedPoolAddress).toBe(selectedPoolAddress)
		expect(loadedForkAuctionAddresses).toContain(selectedPoolAddress)
	})

	test('reloads reporting after migrating escalation deposits in the fork workflow', async () => {
		const selectedPoolAddress = zeroAddress
		let reportingLoadCalls = 0
		let refreshedPoolAddress: string | undefined
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={1n}>
				<SecurityPoolWorkflowSection
					{...createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: selectedPoolAddress,
						forkAuction: createForkAuctionProps({
							forkAuctionResult: {
								action: 'migrateEscalationDeposits',
								hash: '0x00000000000000000000000000000000000000000000000000000000000000cb',
								securityPoolAddress: selectedPoolAddress,
								universeId: 1n,
							},
						}),
						onRefreshSelectedPoolData: securityPoolAddressInput => {
							refreshedPoolAddress = securityPoolAddressInput
						},
						reporting: createReportingProps({
							onLoadReporting: () => {
								reportingLoadCalls += 1
							},
							reportingDetails: {
								activationTime: 0n,
								bindingCapital: 0n,
								completeSetCollateralAmount: 0n,
								currentRequiredBond: 0n,
								currentTime: 1n,
								escalationEndTime: 2n,
								escalationGameAddress: zeroAddress,
								forkThreshold: 0n,
								hasReachedNonDecision: false,
								marketDetails: createMarketDetails({ endTime: 0n }),
								nonDecisionThreshold: 0n,
								questionOutcome: 'none',
								securityPoolAddress: selectedPoolAddress,
								sides: [
									{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
									{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
									{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
								],
								startBond: 0n,
								status: 'active',
								systemState: 'operational',
								totalCost: 0n,
								universeId: 1n,
								viewerVaultAvailableEscalationRep: 0n,
								viewerVaultExists: true,
								viewerVaultLockedRepInEscalationGame: 0n,
								viewerVaultRepDepositShare: 0n,
								settlementState: 'locked',
								parentWithdrawalEnabled: false,
							},
							reportingForm: {
								reportAmount: '',
								securityPoolAddress: selectedPoolAddress,
								selectedOutcome: 'yes',
								selectedWithdrawDepositIndexesByOutcome: {
									invalid: [],
									yes: [],
									no: [],
								},
							},
						}),
						securityPoolAddress: selectedPoolAddress,
						securityPools: [createSelectedPool({ marketDetails: createMarketDetails({ endTime: 0n }), securityPoolAddress: selectedPoolAddress })],
						selectedPoolView: 'reporting',
					})}
					showHeader={false}
				/>
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(refreshedPoolAddress).toBe(selectedPoolAddress)
		expect(reportingLoadCalls).toBe(1)
	})
})
