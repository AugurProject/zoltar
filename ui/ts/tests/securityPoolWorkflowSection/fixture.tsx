/// <reference types="bun-types" />

import { afterEach, beforeEach } from 'bun:test'
import { fireEvent, waitFor, within } from '../testUtils/queries'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from 'viem'
import { SecurityPoolWorkflowSection } from '../../components/SecurityPoolWorkflowSection.js'
import { ChainTimestampContext } from '../../lib/chainTimestamp.js'
import { deriveHasForkActivity } from '../../lib/forkAuction.js'
import { getReportingLockedUntilMessage } from '../../lib/reporting.js'
import type { AccountState } from '../../types/app.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails, OracleManagerDetails, SecurityPoolVaultSummary, SecurityVaultDetails } from '../../types/contracts.js'
import type { ForkAuctionRouteContentProps, ReportingRouteContentProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '../../types/components.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, expectTransactionButtonEnabled } from '../testUtils/transactionActionButton.js'

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
		escalationEscrowedRep: 0n,
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
	const details = {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 1n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingSettlementOperationIds: [],
		pendingReportId: 0n,
		priceRoundRemainingNotional: 1n,
		priceValidUntilTimestamp: 1000n,
		requestPriceEthCost: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
		...overrides,
	}
	return details
}

function createSecurityPoolVaultSummary(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	return {
		escalationEscrowedRep: 1n * 10n ** 18n,
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
		auctionableRepAtFork: 0n,
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
		liquidationTimeoutMinutes: '5',
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
		securityPoolLiquidationError: undefined,
		securityPoolOverviewResult: undefined,
		securityPools: [],
		securityVault: createSecurityVaultProps(),
		trading: createTradingProps(),
		...overrides,
	}
}

export function useSecurityPoolWorkflowSectionTestDom() {
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

	const renderWorkflow = async (props: SecurityPoolWorkflowRouteContentProps, options: { showHeader?: boolean } = {}) => {
		const renderedComponent = await renderIntoDocument(<SecurityPoolWorkflowSection {...props} showHeader={options.showHeader ?? false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return renderedComponent
	}

	const renderLoadedPool = async (overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}) =>
		await renderWorkflow(
			createSecurityPoolWorkflowProps({
				checkedSecurityPoolAddress: zeroAddress,
				securityPoolAddress: zeroAddress,
				securityPools: [createSelectedPool()],
				...overrides,
			}),
		)

	return {
		renderLoadedPool,
		renderWorkflow,
		setCleanup(cleanup: () => Promise<void>) {
			cleanupRenderedComponent = cleanup
		},
	}
}

function createSecurityPoolWorkflowSectionFixture() {
	return {
		fireEvent,
		waitFor,
		within,
		render,
		act,
		getAddress,
		zeroAddress,
		SecurityPoolWorkflowSection,
		ChainTimestampContext,
		getReportingLockedUntilMessage,
		renderIntoDocument,
		expectTransactionButtonDisabled,
		expectTransactionButtonEnabled,
		createAccountState,
		createTradingProps,
		createReportingProps,
		createSecurityVaultProps,
		createSecurityVaultDetails,
		createOracleManagerDetails,
		createSecurityPoolVaultSummary,
		createForkAuctionProps,
		createForkAuctionDetails,
		createMarketDetails,
		createSelectedPool,
		createSecurityPoolWorkflowProps,
	}
}

export function createForkWorkflowStateFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		waitFor: fixture.waitFor,
		within: fixture.within,
		render: fixture.render,
		act: fixture.act,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		ChainTimestampContext: fixture.ChainTimestampContext,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonEnabled: fixture.expectTransactionButtonEnabled,
		createReportingProps: fixture.createReportingProps,
		createForkAuctionProps: fixture.createForkAuctionProps,
		createForkAuctionDetails: fixture.createForkAuctionDetails,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createRefreshAutoloadFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		render: fixture.render,
		act: fixture.act,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		ChainTimestampContext: fixture.ChainTimestampContext,
		renderIntoDocument: fixture.renderIntoDocument,
		createAccountState: fixture.createAccountState,
		createReportingProps: fixture.createReportingProps,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createForkAuctionProps: fixture.createForkAuctionProps,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createReportingAndOracleFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		within: fixture.within,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		ChainTimestampContext: fixture.ChainTimestampContext,
		getReportingLockedUntilMessage: fixture.getReportingLockedUntilMessage,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonDisabled: fixture.expectTransactionButtonDisabled,
		createAccountState: fixture.createAccountState,
		createReportingProps: fixture.createReportingProps,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createSelectedPoolStateFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		within: fixture.within,
		act: fixture.act,
		getAddress: fixture.getAddress,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonDisabled: fixture.expectTransactionButtonDisabled,
		expectTransactionButtonEnabled: fixture.expectTransactionButtonEnabled,
		createAccountState: fixture.createAccountState,
		createTradingProps: fixture.createTradingProps,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createSecurityPoolVaultSummary: fixture.createSecurityPoolVaultSummary,
		createForkAuctionProps: fixture.createForkAuctionProps,
		createForkAuctionDetails: fixture.createForkAuctionDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createStagedOperationsFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		within: fixture.within,
		act: fixture.act,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		renderIntoDocument: fixture.renderIntoDocument,
		createAccountState: fixture.createAccountState,
		createReportingProps: fixture.createReportingProps,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createMarketDetails: fixture.createMarketDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}

export function createVaultControlsFixture() {
	const fixture = createSecurityPoolWorkflowSectionFixture()
	return {
		fireEvent: fixture.fireEvent,
		within: fixture.within,
		act: fixture.act,
		zeroAddress: fixture.zeroAddress,
		SecurityPoolWorkflowSection: fixture.SecurityPoolWorkflowSection,
		renderIntoDocument: fixture.renderIntoDocument,
		expectTransactionButtonDisabled: fixture.expectTransactionButtonDisabled,
		expectTransactionButtonEnabled: fixture.expectTransactionButtonEnabled,
		createAccountState: fixture.createAccountState,
		createSecurityVaultProps: fixture.createSecurityVaultProps,
		createSecurityVaultDetails: fixture.createSecurityVaultDetails,
		createOracleManagerDetails: fixture.createOracleManagerDetails,
		createSelectedPool: fixture.createSelectedPool,
		createSecurityPoolWorkflowProps: fixture.createSecurityPoolWorkflowProps,
	}
}
