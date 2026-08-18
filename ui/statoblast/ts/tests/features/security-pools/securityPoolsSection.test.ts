installTestRouting()
/// <reference types="bun-types" />
installTestRouting()

installTestRouting()
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
installTestRouting()
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
installTestRouting()
import { h } from 'preact'
installTestRouting()
import { render } from 'preact'
installTestRouting()
import { act } from 'preact/test-utils'
installTestRouting()
import { getAddress, zeroAddress, zeroHash, type Address } from '@zoltar/shared/ethereum'
installTestRouting()
import { SecurityPoolsSection, shouldRefreshSelectedPoolDataOnViewOpen } from '../../../features/security-pools/components/SecurityPoolsSection.js'
installTestRouting()
import { deriveHasForkActivity } from '../../../features/truth-auctions/lib/forkAuction.js'
installTestRouting()
import type { AccountState } from '@zoltar/ui-zoltar/types/app.js'
installTestRouting()
import type { ListedSecurityPool, MarketDetails, SecurityPoolBrowsePage, SecurityPoolPage } from '@zoltar/ui-core-shared/types/contracts.js'
installTestRouting()
import type { ForkAuctionRouteContentProps, ReportingRouteContentProps, SecurityPoolRouteContentProps, SecurityPoolsOverviewRouteContentProps, SecurityPoolsSectionProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '@zoltar/ui-zoltar/features/types.js'
installTestRouting()
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
installTestRouting()
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
installTestRouting()
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
installTestRouting()

installTestRouting()
function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
installTestRouting()
	return {
installTestRouting()
		address: zeroAddress,
installTestRouting()
		chainId: '0x1',
installTestRouting()
		ethBalanceAttoEth: 0n,
installTestRouting()
		wethBalanceAttoEth: 0n,
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createTradingProps(overrides: Partial<TradingRouteContentProps> = {}): TradingRouteContentProps {
installTestRouting()
	return {
installTestRouting()
		accountState: createAccountState(),
installTestRouting()
		loadingTradingForkUniverse: false,
installTestRouting()
		loadingTradingDetails: false,
installTestRouting()
		onCreateCompleteSet: () => undefined,
installTestRouting()
		onMigrateShares: () => undefined,
installTestRouting()
		onRedeemCompleteSet: () => undefined,
installTestRouting()
		onRedeemShares: () => undefined,
installTestRouting()
		onTradingFormChange: () => undefined,
installTestRouting()
		repPerEthPrice: undefined,
installTestRouting()
		repPerEthSource: undefined,
installTestRouting()
		repPerEthSourceUrl: undefined,
installTestRouting()
		selectedPool: undefined,
installTestRouting()
		tradingActiveAction: undefined,
installTestRouting()
		tradingDetails: undefined,
installTestRouting()
		tradingError: undefined,
installTestRouting()
		tradingForkUniverse: undefined,
installTestRouting()
		tradingForm: {
installTestRouting()
			completeSetAmount: '',
installTestRouting()
			redeemAmount: '',
installTestRouting()
			securityPoolAddress: '',
installTestRouting()
			selectedShareOutcome: 'yes',
installTestRouting()
			targetOutcomeIndexes: '',
installTestRouting()
		},
installTestRouting()
		tradingResult: undefined,
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createReportingProps(overrides: Partial<ReportingRouteContentProps> = {}): ReportingRouteContentProps {
installTestRouting()
	return {
installTestRouting()
		accountState: createAccountState(),
installTestRouting()
		loadingReportingDetails: false,
installTestRouting()
		onLoadReporting: () => undefined,
installTestRouting()
		onReportOutcome: () => undefined,
installTestRouting()
		onReportingFormChange: () => undefined,
installTestRouting()
		onWithdrawEscalation: (_outcome, _depositIndexes) => undefined,
installTestRouting()
		reportingActiveAction: undefined,
installTestRouting()
		reportingDetails: undefined,
installTestRouting()
		reportingError: undefined,
installTestRouting()
		reportingForm: {
installTestRouting()
			reportAmount: '',
installTestRouting()
			securityPoolAddress: '',
installTestRouting()
			selectedOutcome: undefined,
installTestRouting()
			selectedWithdrawDepositIndexesByOutcome: {
installTestRouting()
				invalid: [],
installTestRouting()
				yes: [],
installTestRouting()
				no: [],
installTestRouting()
			},
installTestRouting()
		},
installTestRouting()
		reportingResult: undefined,
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createSecurityVaultProps(overrides: Partial<SecurityVaultRouteContentProps> = {}): SecurityVaultRouteContentProps {
installTestRouting()
	return {
installTestRouting()
		accountState: createAccountState(),
installTestRouting()
		loadingSecurityVault: false,
installTestRouting()
		onApproveRep: () => undefined,
installTestRouting()
		onDepositRepToVault: () => undefined,
installTestRouting()
		onLoadSecurityVault: () => undefined,
installTestRouting()
		onRedeemFees: () => undefined,
installTestRouting()
		onRedeemRepFromVault: () => undefined,
installTestRouting()
		onSecurityVaultFormChange: () => undefined,
installTestRouting()
		onWithdrawRep: () => undefined,
installTestRouting()
		repPerEthPrice: undefined,
installTestRouting()
		repPerEthSource: undefined,
installTestRouting()
		repPerEthSourceUrl: undefined,
installTestRouting()
		securityPoolVaults: undefined,
installTestRouting()
		securityVaultActiveAction: undefined,
installTestRouting()
		securityVaultDetails: undefined,
installTestRouting()
		securityVaultError: undefined,
installTestRouting()
		securityVaultForm: {
installTestRouting()
			depositAmount: '',
installTestRouting()
			repWithdrawAmount: '',
installTestRouting()
			targetHealthFactor: '',
installTestRouting()
			securityPoolAddress: '',
installTestRouting()
			selectedVaultOwner: '',
installTestRouting()
		},
installTestRouting()
		securityVaultMissing: false,
installTestRouting()
		securityVaultRepApproval: {
installTestRouting()
			error: undefined,
installTestRouting()
			loading: false,
installTestRouting()
			value: 0n,
installTestRouting()
		},
installTestRouting()
		walletRepBalanceAttoRep: undefined,
installTestRouting()
		securityVaultResult: undefined,
installTestRouting()
		selectedPoolStatoblastSecurityMultiplierBps: undefined,
installTestRouting()
		...overrides,
installTestRouting()
		walletRepBalanceError: overrides.walletRepBalanceError,
installTestRouting()
		walletRepBalanceLoading: overrides.walletRepBalanceLoading ?? false,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createForkAuctionProps(overrides: Partial<ForkAuctionRouteContentProps> = {}): ForkAuctionRouteContentProps {
installTestRouting()
	return {
installTestRouting()
		accountState: createAccountState(),
installTestRouting()
		forkAuctionActiveAction: undefined,
installTestRouting()
		forkAuctionDetails: undefined,
installTestRouting()
		forkAuctionError: undefined,
installTestRouting()
		forkAuctionForm: {
installTestRouting()
			claimBidIndex: '',
installTestRouting()
			claimBidTick: '',
installTestRouting()
			depositIndexes: '',
installTestRouting()
			directForkQuestionId: '',
installTestRouting()
			directForkUniverseId: '',
installTestRouting()
			refundBidIndex: '',
installTestRouting()
			refundTick: '',
installTestRouting()
			repMigrationOutcomes: '',
installTestRouting()
			securityPoolAddress: '',
installTestRouting()
			selectedOutcome: 'yes',
installTestRouting()
			settlementAddress: '',
installTestRouting()
			submitBidAmount: '',
installTestRouting()
			submitBidPrice: '',
installTestRouting()
			vaultAddress: '',
installTestRouting()
		},
installTestRouting()
		forkAuctionResult: undefined,
installTestRouting()
		loadingForkAuctionDetails: false,
installTestRouting()
		onClaimAuctionProceeds: () => undefined,
installTestRouting()
		onCreateChildUniverse: () => undefined,
installTestRouting()
		onFinalizeTruthAuction: () => undefined,
installTestRouting()
		onForkAuctionFormChange: () => undefined,
installTestRouting()
		onForkUniverse: () => undefined,
installTestRouting()
		onForkWithOwnEscalation: () => undefined,
installTestRouting()
		onInitiateFork: () => undefined,
installTestRouting()
		onLoadForkAuction: () => undefined,
installTestRouting()
		onClaimParentEscalationDeposits: (_outcome, _depositIndexes) => undefined,
installTestRouting()
		onMigrateUnresolvedEscalation: _selectedChildOutcome => undefined,
installTestRouting()
		onMigrateRepToZoltar: _outcomes => undefined,
installTestRouting()
		onMigrateVault: () => undefined,
installTestRouting()
		onRefundLosingBids: () => undefined,
installTestRouting()
		onStartTruthAuction: () => undefined,
installTestRouting()
		onSubmitBid: (_securityPoolAddressOverride?: Address) => undefined,
installTestRouting()
		onWithdrawForkedEscalation: (_outcome, _parentDepositIndexes) => undefined,
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
installTestRouting()
	return {
installTestRouting()
		answerUnit: '',
installTestRouting()
		createdAt: 1n,
installTestRouting()
		description: 'Question description',
installTestRouting()
		displayValueMax: 100n,
installTestRouting()
		displayValueMin: 0n,
installTestRouting()
		endTime: 2n,
installTestRouting()
		exists: true,
installTestRouting()
		marketType: 'binary',
installTestRouting()
		numTicks: 2n,
installTestRouting()
		outcomeLabels: ['Yes', 'No'],
installTestRouting()
		questionId: '0x01',
installTestRouting()
		startTime: 1n,
installTestRouting()
		title: 'Will this resolve?',
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
installTestRouting()
	const selectedPool: ListedSecurityPool = {
installTestRouting()
		settlementCollateralAttoEth: 0n,
installTestRouting()
		currentRetentionRate: 10n,
installTestRouting()
		feeEligibleCapacityOwnershipAttoRep: 5n * 10n ** 18n,
installTestRouting()
		hasForkActivity: false,
installTestRouting()
		forkOutcome: 'none',
installTestRouting()
		forkOwnSecurityPool: false,
installTestRouting()
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
installTestRouting()
		lastOraclePrice: undefined,
installTestRouting()
		lastOracleSettlementTimestamp: 0n,
installTestRouting()
		managerAddress: zeroAddress,
installTestRouting()
		marketDetails: createMarketDetails(),
installTestRouting()
		migratedAttoRep: 0n,
installTestRouting()
		parent: zeroAddress,
installTestRouting()
		questionOutcome: 'none',
installTestRouting()
		questionId: '0x01',
installTestRouting()
		statoblastSecurityMultiplierBps: 20_000n,
installTestRouting()
		securityPoolAddress: zeroAddress,
installTestRouting()
		shareTokenSupplyAttoShares: 0n,
installTestRouting()
		systemState: 'operational',
installTestRouting()
		totalPoolHeldAttoRep: 0n,
installTestRouting()
		totalCapacityOwnershipAttoRep: 5n * 10n ** 18n,
installTestRouting()
		truthAuctionAddress: zeroAddress,
installTestRouting()
		truthAuctionStartedAt: 0n,
installTestRouting()
		universeHasForked: false,
installTestRouting()
		universeId: 1n,
installTestRouting()
		vaultCount: 3n,
installTestRouting()
		vaults: [],
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
	return {
installTestRouting()
		...selectedPool,
installTestRouting()
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(selectedPool),
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createWorkflowProps(overrides: Partial<SecurityPoolWorkflowRouteContentProps> = {}): SecurityPoolWorkflowRouteContentProps {
installTestRouting()
	return {
installTestRouting()
		accountState: createAccountState(),
installTestRouting()
		activeUniverseId: 1n,
installTestRouting()
		checkedSecurityPoolAddress: undefined,
installTestRouting()
		closeLiquidationModal: () => undefined,
installTestRouting()
		forkAuction: createForkAuctionProps(),
installTestRouting()
		liquidationDebtEthAmount: '',
installTestRouting()
		maximumLiquidationDebtAttoEth: undefined,
installTestRouting()
		liquidationManagerAddress: undefined,
installTestRouting()
		liquidationModalOpen: false,
installTestRouting()
		liquidationSecurityPoolAddress: undefined,
installTestRouting()
		liquidationTargetVault: '',
installTestRouting()
		liquidationTimeoutMinutes: '5',
installTestRouting()
		loadingPoolOracleManager: false,
installTestRouting()
		loadingSecurityPools: false,
installTestRouting()
		onBrowsePools: () => undefined,
installTestRouting()
		onCreatePool: () => undefined,
installTestRouting()
		onLiquidationAmountChange: () => undefined,
installTestRouting()
		onLiquidationTimeoutMinutesChange: () => undefined,
installTestRouting()
		onLoadPoolOracleManager: () => undefined,
installTestRouting()
		onOpenLiquidationModal: () => undefined,
installTestRouting()
		onQueueLiquidation: () => undefined,
installTestRouting()
		onExecutePendingPoolOperation: () => undefined,
installTestRouting()
		onRefreshSelectedPoolData: () => undefined,
installTestRouting()
		onRequestPoolPrice: () => undefined,
installTestRouting()
		onSelectedPoolViewChange: () => undefined,
installTestRouting()
		onSecurityPoolAddressChange: () => undefined,
installTestRouting()
		selectedPoolRefreshNonce: 0,
installTestRouting()
		onViewPendingReport: () => undefined,
installTestRouting()
		poolOracleActiveAction: undefined,
installTestRouting()
		poolOracleManagerDetails: undefined,
installTestRouting()
		poolOracleManagerError: undefined,
installTestRouting()
		poolOracleManagerErrorAddress: undefined,
installTestRouting()
		poolPriceOracleResult: undefined,
installTestRouting()
		repPerEthPrice: undefined,
installTestRouting()
		repPerEthSource: undefined,
installTestRouting()
		repPerEthSourceUrl: undefined,
installTestRouting()
		reporting: createReportingProps(),
installTestRouting()
		selectedPoolView: '',
installTestRouting()
		securityPoolAddress: '',
installTestRouting()
		securityPoolOverviewActiveAction: undefined,
installTestRouting()
		securityPoolOverviewError: undefined,
installTestRouting()
		securityPoolLiquidationError: undefined,
installTestRouting()
		securityPoolOverviewResult: undefined,
installTestRouting()
		securityPools: [],
installTestRouting()
		securityVault: createSecurityVaultProps(),
installTestRouting()
		trading: createTradingProps(),
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
type SecurityPoolsOverviewRouteTestOverrides = Omit<Partial<SecurityPoolsOverviewRouteContentProps>, 'securityPoolPage'> & {
installTestRouting()
	securityPoolPage?: SecurityPoolPage | SecurityPoolBrowsePage | undefined
installTestRouting()
}
installTestRouting()

installTestRouting()
function getSecurityPoolPageRequestKey(page: SecurityPoolPage | SecurityPoolBrowsePage): string | undefined {
installTestRouting()
	return 'requestKey' in page ? page.requestKey : undefined
installTestRouting()
}
installTestRouting()

installTestRouting()
function createOverviewProps(overrides: SecurityPoolsOverviewRouteTestOverrides = {}): SecurityPoolsOverviewRouteContentProps {
installTestRouting()
	const accountState = overrides.accountState ?? createAccountState()
installTestRouting()
	const securityPools = overrides.securityPools ?? []
installTestRouting()
	const environmentRefreshKey = overrides.environmentRefreshKey ?? 0
installTestRouting()
	const accountRequestKey = accountState.address?.toLowerCase() ?? 'no-account'
installTestRouting()
	const hasSecurityPoolPageOverride = Object.hasOwn(overrides, 'securityPoolPage')
installTestRouting()
	const defaultSecurityPoolPage: SecurityPoolBrowsePage | undefined =
installTestRouting()
		securityPools.length === 0
installTestRouting()
			? undefined
installTestRouting()
			: {
installTestRouting()
					pageIndex: 0,
installTestRouting()
					pageSize: 6,
installTestRouting()
					poolCount: BigInt(securityPools.length),
installTestRouting()
					pools: securityPools,
installTestRouting()
					requestKey: `${environmentRefreshKey}:0:6:${accountRequestKey}`,
installTestRouting()
				}
installTestRouting()
	const overrideSecurityPoolPage = hasSecurityPoolPageOverride ? overrides.securityPoolPage : defaultSecurityPoolPage
installTestRouting()
	const securityPoolPage =
installTestRouting()
		overrideSecurityPoolPage === undefined
installTestRouting()
			? undefined
installTestRouting()
			: {
installTestRouting()
					...overrideSecurityPoolPage,
installTestRouting()
					requestKey: getSecurityPoolPageRequestKey(overrideSecurityPoolPage) ?? `${environmentRefreshKey}:${overrideSecurityPoolPage.pageIndex.toString()}:${overrideSecurityPoolPage.pageSize.toString()}:${accountRequestKey}`,
installTestRouting()
				}
installTestRouting()
	return {
installTestRouting()
		accountState,
installTestRouting()
		hasLoadedSecurityPoolPage: securityPoolPage !== undefined,
installTestRouting()
		loadingSecurityPoolPage: false,
installTestRouting()
		onLoadSecurityPoolPage: () => undefined,
installTestRouting()
		repPerEthPrice: undefined,
installTestRouting()
		securityPoolOverviewError: undefined,
installTestRouting()
		...overrides,
installTestRouting()
		environmentRefreshKey,
installTestRouting()
		securityPoolBrowseCount: securityPoolPage?.poolCount,
installTestRouting()
		securityPoolPage,
installTestRouting()
		securityPools,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createCreatePoolProps(overrides: Partial<SecurityPoolRouteContentProps> = {}): SecurityPoolRouteContentProps {
installTestRouting()
	return {
installTestRouting()
		accountState: createAccountState(),
installTestRouting()
		availableQuestionsContextKey: 'environment-1:universe-0',
installTestRouting()
		availableQuestions: [],
installTestRouting()
		checkingDuplicateOriginPool: false,
installTestRouting()
		duplicateOriginPoolExists: false,
installTestRouting()
		hasLoadedAvailableQuestions: true,
installTestRouting()
		loadingAvailableQuestions: false,
installTestRouting()
		loadingMarketDetails: false,
installTestRouting()
		marketDetails: undefined,
installTestRouting()
		onCreateSecurityPool: () => undefined,
installTestRouting()
		onLoadAvailableQuestions: async () => undefined,
installTestRouting()
		onResetSecurityPoolCreation: () => undefined,
installTestRouting()
		onSecurityPoolFormChange: () => undefined,
installTestRouting()
		poolCreationMarketDetails: undefined,
installTestRouting()
		repPerEthPrice: undefined,
installTestRouting()
		repPerEthSource: undefined,
installTestRouting()
		repPerEthSourceUrl: undefined,
installTestRouting()
		securityPools: [],
installTestRouting()
		securityPoolCreating: false,
installTestRouting()
		securityPoolError: undefined,
installTestRouting()
		securityPoolForm: {
installTestRouting()
			initialReportPriorityFeeGwei: '10',
installTestRouting()
			marketId: '',
installTestRouting()
			statoblastSecurityMultiplierBps: '',
installTestRouting()
		},
installTestRouting()
		securityPoolResult: undefined,
installTestRouting()
		zoltarUniverseHasForked: false,
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
function createSecurityPoolsSectionProps(overrides: Partial<SecurityPoolsSectionProps> = {}): SecurityPoolsSectionProps {
installTestRouting()
	return {
installTestRouting()
		activeView: 'browse',
installTestRouting()
		createPool: createCreatePoolProps(),
installTestRouting()
		onActiveViewChange: () => undefined,
installTestRouting()
		overview: createOverviewProps(),
installTestRouting()
		workflow: createWorkflowProps(),
installTestRouting()
		...overrides,
installTestRouting()
	}
installTestRouting()
}
installTestRouting()

installTestRouting()
void describe('security pools selected tab refresh', () => {
installTestRouting()
	const currentSecurityPoolAddress = '0x1234567890123456789012345678901234567890'
installTestRouting()
	const nextSecurityPoolAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
installTestRouting()

installTestRouting()
	void test('refreshes selected pool data only when opening the selected pool view for a pool that is not already loaded', () => {
installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'browse',
installTestRouting()
				nextSecurityPoolAddress: currentSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'create',
installTestRouting()
				nextSecurityPoolAddress: currentSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress: '',
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress: currentSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: true,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress: currentSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(true)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: true,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(true)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress: '   ',
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress: currentSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: true,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress: '   ',
installTestRouting()
				nextView: 'operate',
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()

installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress: '   ',
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(false)
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('refreshes selected pool data when the summary exists but vault details were deferred', () => {
installTestRouting()
		expect(
installTestRouting()
			shouldRefreshSelectedPoolDataOnViewOpen({
installTestRouting()
				currentSecurityPoolAddress,
installTestRouting()
				nextView: 'operate',
installTestRouting()
				nextSecurityPoolAddress: currentSecurityPoolAddress,
installTestRouting()
				selectedPoolHasLoadedDetails: false,
installTestRouting()
			}),
installTestRouting()
		).toBe(true)
installTestRouting()
	})
installTestRouting()
})
installTestRouting()

installTestRouting()
void describe('SecurityPoolsSection', () => {
installTestRouting()
	let restoreDomEnvironment: (() => void) | undefined
installTestRouting()
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
installTestRouting()

installTestRouting()
	beforeEach(() => {
installTestRouting()
		const domEnvironment = installDomEnvironment()
installTestRouting()
		restoreDomEnvironment = domEnvironment.cleanup
installTestRouting()
	})
installTestRouting()

installTestRouting()
	afterEach(async () => {
installTestRouting()
		await cleanupRenderedComponent?.()
installTestRouting()
		cleanupRenderedComponent = undefined
installTestRouting()
		restoreDomEnvironment?.()
installTestRouting()
		restoreDomEnvironment = undefined
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('hides the route summary in browse mode without rendering local route tabs', async () => {
installTestRouting()
		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps()))
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		const documentQueries = within(document.body)
installTestRouting()
		expect(documentQueries.queryByRole('tab', { name: 'Browse' })).toBeNull()
installTestRouting()
		expect(documentQueries.queryByRole('tab', { name: 'Create Pool' })).toBeNull()
installTestRouting()
		expect(documentQueries.queryByRole('tab', { name: 'Manage Pool' })).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Mode')).toBeNull()
installTestRouting()
		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Loaded pools')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Selected pool')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Pool status')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Next step')).toBeNull()
installTestRouting()
		expect(document.body.textContent?.includes('Use the state badge and the guidance line on each card to decide whether you are browsing an active pool, a reporting state, or a fork workflow.')).toBe(false)
installTestRouting()
		expect(document.body.textContent?.includes('Filters apply only to the currently loaded page. Use pagination to inspect other pools.')).toBe(false)
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('auto-loads pool browse data once when opening the browse view without loaded pools', async () => {
installTestRouting()
		const calls: string[] = []
installTestRouting()
		const initialProps = createSecurityPoolsSectionProps({
installTestRouting()
			overview: createOverviewProps({
installTestRouting()
				hasLoadedSecurityPoolPage: false,
installTestRouting()
				loadingSecurityPoolPage: false,
installTestRouting()
				onLoadSecurityPoolPage: (pageIndex, pageSize) => {
installTestRouting()
					calls.push(`${pageIndex}:${pageSize}`)
installTestRouting()
				},
installTestRouting()
			}),
installTestRouting()
		})
installTestRouting()

installTestRouting()
		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, initialProps))
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()
		expect(calls).toEqual(['0:6'])
installTestRouting()

installTestRouting()
		await act(() => {
installTestRouting()
			render(
installTestRouting()
				h(SecurityPoolsSection, {
installTestRouting()
					...initialProps,
installTestRouting()
					overview: createOverviewProps({
installTestRouting()
						hasLoadedSecurityPoolPage: false,
installTestRouting()
						loadingSecurityPoolPage: false,
installTestRouting()
						onLoadSecurityPoolPage: (pageIndex, pageSize) => {
installTestRouting()
							calls.push(`rerender:${pageIndex}:${pageSize}`)
installTestRouting()
						},
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
				renderedComponent.container,
installTestRouting()
			)
installTestRouting()
		})
installTestRouting()

installTestRouting()
		expect(calls).toEqual(['0:6'])
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('openView opens and refreshes selected pool data when navigating from create mode', async () => {
installTestRouting()
		const createdPoolAddress = getAddress('0x00000000000000000000000000000000000000a4')
installTestRouting()
		const activeViewChanges: string[] = []
installTestRouting()
		const refreshCalls: string[] = []
installTestRouting()

installTestRouting()
		const renderedComponent = await renderIntoDocument(
installTestRouting()
			h(
installTestRouting()
				SecurityPoolsSection,
installTestRouting()
				createSecurityPoolsSectionProps({
installTestRouting()
					activeView: 'create',
installTestRouting()
					onActiveViewChange: activeView => {
installTestRouting()
						activeViewChanges.push(activeView)
installTestRouting()
					},
installTestRouting()
					createPool: createCreatePoolProps({
installTestRouting()
						securityPoolResult: {
installTestRouting()
							deployPoolHash: zeroHash,
installTestRouting()
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
installTestRouting()
							questionId: '0x01',
installTestRouting()
							securityPoolAddress: createdPoolAddress,
installTestRouting()
							statoblastSecurityMultiplierBps: 20_000n,
installTestRouting()
							universeId: 1n,
installTestRouting()
						},
installTestRouting()
					}),
installTestRouting()
					workflow: createWorkflowProps({
installTestRouting()
						onRefreshSelectedPoolData: address => {
installTestRouting()
							if (address !== undefined) {
installTestRouting()
								refreshCalls.push(address)
installTestRouting()
							}
installTestRouting()
						},
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
			),
installTestRouting()
		)
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		const documentQueries = within(document.body)
installTestRouting()
		fireEvent.click(documentQueries.getByRole('button', { name: /^Open pool:/ }))
installTestRouting()
		expect(activeViewChanges).toEqual(['operate'])
installTestRouting()
		expect(refreshCalls).toEqual([createdPoolAddress])
installTestRouting()

installTestRouting()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Return to browse' }))
installTestRouting()
		expect(activeViewChanges).toEqual(['operate', 'browse'])
installTestRouting()
		expect(refreshCalls).toEqual([createdPoolAddress])
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('Create another pool button is wired in create mode', async () => {
installTestRouting()
		let resetCount = 0
installTestRouting()
		const renderedComponent = await renderIntoDocument(
installTestRouting()
			h(
installTestRouting()
				SecurityPoolsSection,
installTestRouting()
				createSecurityPoolsSectionProps({
installTestRouting()
					activeView: 'create',
installTestRouting()
					createPool: createCreatePoolProps({
installTestRouting()
						securityPoolResult: {
installTestRouting()
							deployPoolHash: zeroHash,
installTestRouting()
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
installTestRouting()
							questionId: '0x01',
installTestRouting()
							securityPoolAddress: '0x00000000000000000000000000000000000000a5',
installTestRouting()
							statoblastSecurityMultiplierBps: 20_000n,
installTestRouting()
							universeId: 1n,
installTestRouting()
						},
installTestRouting()
						onResetSecurityPoolCreation: () => {
installTestRouting()
							resetCount += 1
installTestRouting()
						},
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
			),
installTestRouting()
		)
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		fireEvent.click(within(document.body).getByRole('button', { name: 'Create another pool' }))
installTestRouting()
		expect(resetCount).toBe(1)
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('keeps the route summary hidden even when the selected pool is resolved in operate mode', async () => {
installTestRouting()
		const selectedPool = createSelectedPool()
installTestRouting()
		const renderedComponent = await renderIntoDocument(
installTestRouting()
			h(
installTestRouting()
				SecurityPoolsSection,
installTestRouting()
				createSecurityPoolsSectionProps({
installTestRouting()
					activeView: 'operate',
installTestRouting()
					overview: createOverviewProps({
installTestRouting()
						securityPools: [selectedPool],
installTestRouting()
					}),
installTestRouting()
					workflow: createWorkflowProps({
installTestRouting()
						checkedSecurityPoolAddress: zeroAddress,
installTestRouting()
						securityPoolAddress: zeroAddress,
installTestRouting()
						securityPools: [selectedPool],
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
			),
installTestRouting()
		)
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
installTestRouting()
		const documentQueries = within(document.body)
installTestRouting()
		expect(documentQueries.queryByText('Loaded pools')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Selected pool')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Pool status')).toBeNull()
installTestRouting()
		expect(documentQueries.queryByText('Next step')).toBeNull()
installTestRouting()
		const selectedPoolContext = document.body.querySelector('.sticky-object-context:not(.static)')
installTestRouting()
		if (!(selectedPoolContext instanceof HTMLElement)) throw new Error('Expected operate mode to render the selected pool context card')
installTestRouting()
		const contextQueries = within(selectedPoolContext)
installTestRouting()
		expect(contextQueries.queryByRole('tab', { name: 'Browse' })).toBeNull()
installTestRouting()
		expect(contextQueries.queryByRole('tab', { name: 'Create Pool' })).toBeNull()
installTestRouting()
		expect(contextQueries.queryByRole('tab', { name: 'Manage Pool' })).toBeNull()
installTestRouting()
		expect(documentQueries.queryByRole('heading', { name: 'Security pools' })).toBeNull()
installTestRouting()
		expect(contextQueries.queryByText('Total Capacity ownership')).toBeNull()
installTestRouting()
		expect(contextQueries.getByText('Security Pool Address')).not.toBeNull()
installTestRouting()
		const contextDetails = document.body.querySelector('.selected-pool-context-details')
installTestRouting()
		if (!(contextDetails instanceof HTMLElement)) throw new Error('Expected selected pool context details')
installTestRouting()
		expect(within(contextDetails).getByText('Pool-held REP')).not.toBeNull()
installTestRouting()
		expect(selectedPoolContext.compareDocumentPosition(contextDetails) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('keeps the route summary hidden in operate mode until the selected pool resolves', async () => {
installTestRouting()
		const renderedComponent = await renderIntoDocument(
installTestRouting()
			h(
installTestRouting()
				SecurityPoolsSection,
installTestRouting()
				createSecurityPoolsSectionProps({
installTestRouting()
					activeView: 'operate',
installTestRouting()
					workflow: createWorkflowProps({
installTestRouting()
						securityPoolAddress: '0x0000000000000000000000000000000000000001',
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
			),
installTestRouting()
		)
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('hides the truth auction metric when a listed pool has no truth auction address', async () => {
installTestRouting()
		const renderedComponent = await renderIntoDocument(
installTestRouting()
			h(
installTestRouting()
				SecurityPoolsSection,
installTestRouting()
				createSecurityPoolsSectionProps({
installTestRouting()
					overview: createOverviewProps({
installTestRouting()
						securityPools: [createSelectedPool()],
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
			),
installTestRouting()
		)
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		const metricLabels = Array.from(document.body.querySelectorAll('.metric-label')).map(element => element.textContent?.trim() ?? '')
installTestRouting()
		expect(metricLabels.includes('Manager')).toBe(false)
installTestRouting()
		expect(metricLabels.includes('Truth Auction')).toBe(false)
installTestRouting()
	})
installTestRouting()

installTestRouting()
	void test('filters the browse registry by search text and the derived ended state', async () => {
installTestRouting()
		const operationalPool = createSelectedPool({
installTestRouting()
			marketDetails: createMarketDetails({ title: 'First pool question' }),
installTestRouting()
			questionOutcome: 'none',
installTestRouting()
			questionId: '0x01',
installTestRouting()
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
installTestRouting()
			systemState: 'operational',
installTestRouting()
		})
installTestRouting()
		const endedPool = createSelectedPool({
installTestRouting()
			marketDetails: createMarketDetails({ title: 'Second pool question' }),
installTestRouting()
			questionOutcome: 'yes',
installTestRouting()
			questionId: '0x02',
installTestRouting()
			securityPoolAddress: '0x0000000000000000000000000000000000000002',
installTestRouting()
			systemState: 'operational',
installTestRouting()
		})
installTestRouting()
		const renderedComponent = await renderIntoDocument(
installTestRouting()
			h(
installTestRouting()
				SecurityPoolsSection,
installTestRouting()
				createSecurityPoolsSectionProps({
installTestRouting()
					overview: createOverviewProps({
installTestRouting()
						securityPools: [operationalPool, endedPool],
installTestRouting()
					}),
installTestRouting()
				}),
installTestRouting()
			),
installTestRouting()
		)
installTestRouting()
		cleanupRenderedComponent = renderedComponent.cleanup
installTestRouting()

installTestRouting()
		const documentQueries = within(document.body)
installTestRouting()
		const searchInput = documentQueries.getByPlaceholderText('Address, question ID, or text')
installTestRouting()
		if (!(searchInput instanceof HTMLInputElement)) throw new Error('Expected search input')
installTestRouting()
		searchInput.value = 'second'
installTestRouting()
		await act(() => {
installTestRouting()
			searchInput.dispatchEvent(new window.Event('input', { bubbles: true }))
installTestRouting()
		})
installTestRouting()
		expect(documentQueries.queryByText('First pool question')).toBeNull()
installTestRouting()
		expect(documentQueries.getAllByText('Second pool question').length).toBeGreaterThan(0)
installTestRouting()

installTestRouting()
		searchInput.value = ''
installTestRouting()
		await act(() => {
installTestRouting()
			searchInput.dispatchEvent(new window.Event('input', { bubbles: true }))
installTestRouting()
		})
installTestRouting()

installTestRouting()
		const systemStateSelect = documentQueries.getByLabelText('System State')
installTestRouting()
		if (!(systemStateSelect instanceof window.HTMLSelectElement)) throw new Error('Expected system state filter')
installTestRouting()
		systemStateSelect.value = 'ended'
installTestRouting()
		await act(() => {
installTestRouting()
			systemStateSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
installTestRouting()
		})
installTestRouting()
		expect(documentQueries.queryByText('First pool question')).toBeNull()
installTestRouting()
		expect(documentQueries.getAllByText('Second pool question').length).toBeGreaterThan(0)
installTestRouting()
	})
installTestRouting()
})
