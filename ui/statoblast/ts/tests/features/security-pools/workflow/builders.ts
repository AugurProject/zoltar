import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createAccountState } from '@zoltar/ui-core-shared/tests/testUtils/accountFixtures.js'
import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
import type { ActiveReportingDetails, EscalationSide, ForkAuctionDetails, ListedSecurityPool, OracleManagerDetails, SecurityPoolVaultSummary, SecurityVaultDetails, TruthAuctionMetrics } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { ReportingRouteContentProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import { deriveHasForkActivity } from '@zoltar/ui-statoblast-shared/features/truth-auctions/lib/forkAuction.js'
import type { ForkAuctionRouteContentProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '@zoltar/ui-zoltar-shared/features/types.js'

export function createTradingProps(overrides: Partial<TradingRouteContentProps> = {}): TradingRouteContentProps {
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

export function createReportingProps(overrides: Partial<ReportingRouteContentProps> = {}): ReportingRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingReportingDetails: false,
		onApproveReportingRep: () => undefined,
		onLoadReporting: () => undefined,
		onReportOutcome: () => undefined,
		onReportingFormChange: () => undefined,
		onWithdrawEscalation: (_outcome, _depositIndexes) => undefined,
		reportingActiveAction: undefined,
		reportingDetails: undefined,
		reportingError: undefined,
		reportingForm: createReportingForm(),
		reportingResult: undefined,
		...overrides,
	}
}

type ReportingForm = ReportingRouteContentProps['reportingForm']

export function createReportingForm(overrides: Partial<ReportingForm> = {}): ReportingForm {
	return {
		reportAmount: '',
		securityPoolAddress: '',
		selectedOutcome: undefined,
		selectedWithdrawDepositIndexesByOutcome: {
			invalid: [],
			yes: [],
			no: [],
		},
		...overrides,
	}
}

export function createEscalationSides([invalidBalance, yesBalance, noBalance]: readonly [bigint, bigint, bigint], overrides: Partial<Record<EscalationSide['key'], Partial<EscalationSide>>> = {}): EscalationSide[] {
	return [
		{ balance: invalidBalance, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [], ...overrides.invalid },
		{ balance: yesBalance, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [], ...overrides.yes },
		{ balance: noBalance, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [], ...overrides.no },
	]
}

export function createActiveReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		activationTime: 120n,
		bindingCapital: 10n,
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: zeroAddress,
		forkThresholdAttoRep: 40n,
		hasReachedNonDecision: false,
		marketDetails: createMarketDetails({ endTime: 2n }),
		nonDecisionThresholdAttoRep: 20n,
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
		sides: createEscalationSides([7n, 20n, 20n]),
		startBondAttoRep: 1n,
		status: 'active',
		systemState: 'operational',
		totalCostAttoRep: 40n,
		universeId: 1n,
		viewerPoolHeldVaultRepBackingAttoRep: 12_000n,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 2n,
		viewerVaultRepBackingAttoRep: 12_000n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
		...overrides,
	}
}

export function createFinalizedTruthAuction(overrides: Partial<TruthAuctionMetrics> = {}): TruthAuctionMetrics {
	return {
		accumulatedBidAttoEth: 0n,
		auctionEndsAt: 10n,
		clearingPrice: 1n,
		clearingTick: 0n,
		bidAtClearingTickAttoEth: 0n,
		attoEthRaiseCap: 1n,
		attoEthRaised: 0n,
		finalized: true,
		hitCap: true,
		maxAttoRepBeingSold: 1n,
		minBidSizeAttoEth: 1n,
		attoRepPurchasableAtBid: undefined,
		timeRemaining: 0n,
		totalAttoRepPurchased: 0n,
		underfunded: false,
		finalizationPreview: { attoEthRaised: 0n, attoRepSold: 0n },
		underfundedThreshold: undefined,
		underfundedWinningAttoEth: 0n,
		...overrides,
	}
}

type SecurityVaultForm = SecurityVaultRouteContentProps['securityVaultForm']

// Form for the connected account's own vault in the zero-address pool.
export function createSecurityVaultForm(overrides: Partial<SecurityVaultForm> = {}): SecurityVaultForm {
	return {
		depositAmount: '',
		repWithdrawAmount: '',
		targetHealthFactor: '',
		securityPoolAddress: zeroAddress,
		selectedVaultOwner: zeroAddress,
		...overrides,
	}
}

export function createSecurityVaultProps(overrides: Partial<SecurityVaultRouteContentProps> = {}): SecurityVaultRouteContentProps {
	return {
		accountState: createAccountState(),
		loadingSecurityVault: false,
		onApproveRep: () => undefined,
		onDepositRepToVault: () => undefined,
		onLoadSecurityVault: () => undefined,
		onRedeemFees: () => undefined,
		onRedeemRepFromVault: () => undefined,
		onSecurityVaultFormChange: () => undefined,
		onSetVaultUnderwritingLimit: () => undefined,
		onWithdrawRep: () => undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolVaults: undefined,
		securityVaultActiveAction: undefined,
		securityVaultDetails: undefined,
		securityVaultError: undefined,
		securityVaultForm: createSecurityVaultForm({ securityPoolAddress: '', selectedVaultOwner: '' }),
		securityVaultMissing: false,
		securityVaultRepApproval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		walletRepBalanceAttoRep: undefined,
		securityVaultResult: undefined,
		selectedPoolStatoblastSecurityMultiplierBps: undefined,
		...overrides,
		walletRepBalanceError: overrides.walletRepBalanceError,
		walletRepBalanceLoading: overrides.walletRepBalanceLoading ?? false,
	}
}

export function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		badDebtAttoEth: 0n,
		currentRetentionRate: 10n,
		disputeStakedAttoRep: 0n,
		managerAddress: zeroAddress,
		minimumVaultRepDepositAttoRep: 10n * 10n ** 18n,
		totalRepBackingUnits: 1n,
		vaultAttoRepBacking: 5n * 10n ** 18n,
		repToken: zeroAddress,
		underwritingLimitAttoEth: 2n * 10n ** 18n,
		securityPoolAddress: zeroAddress,
		totalUnderwritingLimitAttoEth: 3n * 10n ** 18n,
		claimableFeesAttoEth: 1n * 10n ** 18n,
		universeId: 1n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

export function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
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
		pendingSettlementOperationIds: [],
		pendingSettlementQueueCapacity: 4n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 1000n,
		queuedOperationCostAttoEth: 1n,
		requestPriceCostAttoEth: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
		...overrides,
	}
}

export function createSecurityPoolVaultSummary(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	return {
		disputeStakedAttoRep: 1n * 10n ** 18n,
		vaultAttoRepBacking: 5n * 10n ** 18n,
		underwritingLimitAttoEth: 2n * 10n ** 18n,
		claimableFeesAttoEth: 1n * 10n ** 18n,
		vaultAddress: zeroAddress,
		...overrides,
	}
}

export function createForkAuctionProps(overrides: Partial<ForkAuctionRouteContentProps> = {}): ForkAuctionRouteContentProps {
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
		onClaimParentEscalationDeposits: (_outcome, _depositIndexes) => undefined,
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

export function createForkAuctionDetails(overrides: Partial<ForkAuctionDetails> = {}): ForkAuctionDetails {
	const forkAuctionDetails: ForkAuctionDetails = {
		auctionedUnderwritingLimitAttoEth: 0n,
		auctionableAttoRepAtFork: 0n,
		claimingAvailable: false,
		settlementCollateralAttoEth: 0n,
		currentTime: 3n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: false,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 0n,
		migrationEndsAt: undefined,
		parentSecurityPoolAddress: zeroAddress,
		questionOutcome: 'none',
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

export function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const selectedPool: ListedSecurityPool = {
		settlementCollateralAttoEth: 0n,
		currentRetentionRate: 10n,
		feeEligibleUnderwritingLimitAttoEth: 5n * 10n ** 18n,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		hasForkActivity: false,
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedAttoRep: 0n,
		hasForkContinuationEscalationGame: false,
		ordinaryEscalationGameStarted: false,
		parent: zeroAddress,
		questionId: '0x01',
		questionOutcome: 'none',
		statoblastSecurityMultiplierBps: 20_000n,
		securityPoolAddress: zeroAddress,
		shareTokenSupplyAttoShares: 0n,
		systemState: 'operational',
		totalPoolHeldAttoRep: 0n,
		totalUnderwritingLimitAttoEth: 5n * 10n ** 18n,
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

export function createSecurityPoolWorkflowProps(overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}): SecurityPoolWorkflowRouteContentProps {
	return {
		accountState: createAccountState(),
		activeUniverseId: 1n,
		checkedSecurityPoolAddress: undefined,
		closeLiquidationModal: () => undefined,
		forkAuction: createForkAuctionProps(),
		liquidationDebtEthAmount: '',
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		liquidationTimeoutMinutes: '5',
		loadingPoolOracleManager: false,
		loadingSecurityPools: false,
		onBrowsePools: () => undefined,
		onCreatePool: () => undefined,
		onExecutePendingPoolOperation: () => undefined,
		onLiquidationAmountChange: () => undefined,
		onLiquidationTimeoutMinutesChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onRefreshSelectedPoolData: () => undefined,
		onRequestPoolPrice: () => undefined,
		onSelectedPoolViewChange: () => undefined,
		onSecurityPoolAddressChange: () => undefined,
		onViewPendingReport: () => undefined,
		poolOracleActiveAction: undefined,
		poolOracleManagerDetails: undefined,
		poolOracleManagerError: undefined,
		poolOracleManagerErrorAddress: undefined,
		poolPriceOracleResult: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		reporting: createReportingProps(),
		selectedPoolRefreshNonce: 0,
		selectedPoolView: '',
		securityPoolAddress: '',
		securityPoolLiquidationError: undefined,
		securityPoolOverviewActiveAction: undefined,
		securityPoolOverviewError: undefined,
		securityPoolOverviewResult: undefined,
		securityPools: [],
		securityVault: createSecurityVaultProps(),
		trading: createTradingProps(),
		...overrides,
	}
}

// Workflow props with the default zero-address pool loaded and selected.
export function createLoadedPoolProps(overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}): SecurityPoolWorkflowRouteContentProps {
	return createSecurityPoolWorkflowProps({
		checkedSecurityPoolAddress: zeroAddress,
		securityPoolAddress: zeroAddress,
		securityPools: [createSelectedPool()],
		...overrides,
	})
}

export { createAccountState }
export { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
