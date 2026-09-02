import type { Address } from '@zoltar/shared/ethereum'
import type { AccountState, ForkAuctionFormState, MarketFormState, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from '../types/app.js'
import type { ReportingFormState } from '@zoltar/ui-zoltar/types/app.js'
import type {
	ForkAuctionActionResult,
	ForkAuctionDetails,
	LiquidationApprovalDetails,
	LiquidationFundingPreview,
	ListedSecurityPool,
	MarketCreationResult,
	MarketDetails,
	OpenOracleActionResult,
	OracleManagerDetails,
	ReadClient,
	ReportingDetails,
	ReportingOutcomeKey,
	SecurityPoolBrowsePage,
	SecurityPoolCreationResult,
	SecurityPoolOverviewActionResult,
	SecurityPoolVaultSummary,
	SecurityVaultActionResult,
	SecurityVaultDetails,
	TradingActionResult,
	TradingDetails,
	ZoltarUniverseSummary,
} from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReadinessAction } from '@zoltar/ui-core-shared/types/components.js'
import type { SecurityPoolLifecycleState } from './security-pools/lib/securityPoolState.js'
import type { ForkAuctionStageView } from './truth-auctions/lib/forkAuction.js'
import type { SecurityPoolStateModel } from './security-pools/lib/securityPoolState.js'
import type { ForkWorkflowSelectionStage } from './security-pools/lib/securityPoolWorkflow.js'
import type { TokenApprovalState } from '@zoltar/ui-core-shared/lib/tokenApproval.js'
import type { ReportingRouteContentProps } from '@zoltar/ui-zoltar/features/types.js'

export type * from '@zoltar/ui-core-shared/types/components.js'

export type CollateralizationCircleProps = {
	collateralizationPercent: bigint | undefined
	className?: string
	label?: string
	size?: 'small' | 'medium' | 'large'
	successThreshold?: number
	targetCollateralizationPercent: bigint | undefined
	tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
	warningThreshold?: number
}

export type VaultMetricGridProps = {
	associatedRepPerCapacityBps?: bigint | undefined
	badDebtAttoEth?: bigint | undefined
	className?: string
	layout?: 'grid' | 'preview'
	disputeStakedAttoRep?: bigint | undefined
	isCurrentlyHealthy?: boolean | undefined
	poolHeldRepPerCapacityBps?: bigint | undefined
	priceValidUntilTimestamp?: bigint | undefined
	vaultAttoRepBacking: bigint | undefined
	selectedPoolStatoblastSecurityMultiplierBps: bigint | undefined
	capacityOwnershipAttoRep: bigint | undefined
	claimableFeesAttoEth: bigint | undefined
} & RepPerEthPriceProps

type RepPerEthPriceProps = {
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
}

export type SecurityPoolsView = 'browse' | 'create' | 'operate' | 'universes'

type SecurityPoolRouteContentProps = {
	accountState: AccountState
	availableQuestionsContextKey: string
	availableQuestions: MarketDetails[]
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	hasLoadedAvailableQuestions: boolean
	loadingAvailableQuestions: boolean
	onCreateSecurityPool: (questionIdOverride?: string) => void
	onCreateQuestionAndSecurityPool?: () => void
	questionAndPoolCreating?: boolean
	onLoadAvailableQuestions: () => Promise<void>
	onOpenCreatedPool?: (securityPoolAddress: Address, universeId: bigint) => void
	loadingMarketDetails: boolean
	marketDetails: MarketDetails | undefined
	poolCreationMarketDetails: MarketDetails | undefined
	onResetSecurityPoolCreation: () => void
	onSecurityPoolFormChange: (update: Partial<SecurityPoolFormState>) => void
	zoltarUniverseHasForked: boolean
	securityPools: ListedSecurityPool[]
	securityPoolCreating: boolean
	securityPoolError: string | undefined
	securityPoolForm: SecurityPoolFormState
	securityPoolResult: SecurityPoolCreationResult | undefined
	marketCreating: boolean
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	onCreateMarket: () => void
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onResetMarket: () => void
} & RepPerEthPriceProps

export type SecurityPoolSectionProps = SecurityPoolRouteContentProps & {
	activeUniverseId: bigint
	onReturnToBrowse?: () => void
	showHeader?: boolean
}

type LiquidationModalStateProps = {
	closeLiquidationModal: () => void
	liquidationDebtEthAmount: string
	maximumLiquidationDebtAttoEth: bigint | undefined
	liquidationManagerAddress: Address | undefined
	liquidationFundingPreview?: LiquidationFundingPreview | undefined
	liquidationFundingPreviewError?: string | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTimeoutMinutes: string
	loadingPoolOracleManager: boolean
	loadingLiquidationFundingPreview?: boolean | undefined
	securityPoolOverviewActiveAction: SecurityPoolOverviewActionResult['action'] | undefined
	securityPoolOverviewError: string | undefined
	securityPoolLiquidationError: string | undefined
	liquidationTargetVault: string
	liquidationReceiverVault?: string | undefined
	liquidationApprovalId?: string | undefined
	liquidationApprovalDetails?: LiquidationApprovalDetails | undefined
	liquidationApprovalError?: string | undefined
	liquidationReceiverVaultSummary?: SecurityPoolVaultSummary | undefined
	liquidationReceiverVaultSummaryError?: string | undefined
	liquidationReceiverVaultSummaryResolved?: boolean | undefined
	loadingLiquidationApproval?: boolean | undefined
	loadingLiquidationReceiverVaultSummary?: boolean | undefined
	onLiquidationAmountChange: (value: string) => void
	onLiquidationReceiverVaultChange?: ((value: string) => void) | undefined
	onLiquidationApprovalIdChange?: ((value: string) => void) | undefined
	onLoadLiquidationApproval?: (() => void) | undefined
	onLoadLiquidationReceiverVaultSummary?: (() => void) | undefined
	onLiquidationTimeoutMinutesChange: (value: string) => void
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onLoadLiquidationFundingPreview?: ((managerAddress: Address) => void) | undefined
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	poolOracleManagerDetails: OracleManagerDetails | undefined
}

type SecurityPoolsOverviewRouteContentProps = {
	accountState: AccountState
	activeUniverseId: bigint
	environmentRefreshKey: number
	hasLoadedSecurityPoolPage: boolean
	loadingSecurityPoolPage: boolean
	onCreateSecurityPool?: () => void
	onLoadSecurityPoolPage: (pageIndex: number, pageSize: number, requestKey: string) => void
	onSelectSecurityPool?: (securityPoolAddress: string, universeId: bigint) => void
	repPerEthPrice: bigint | undefined
	securityPoolOverviewError: string | undefined
	securityPoolBrowseCount: bigint | undefined
	securityPoolPage: SecurityPoolBrowsePage | undefined
	securityPools: ListedSecurityPool[]
}

export type SecurityPoolsOverviewSectionProps = SecurityPoolsOverviewRouteContentProps

export type SecurityPoolWorkflowRouteContentProps = LiquidationModalStateProps & {
	accountState: AccountState
	activeUniverseId: bigint
	checkedSecurityPoolAddress: string | undefined
	forkAuction: ForkAuctionRouteContentProps
	loadingSecurityPools: boolean
	onBrowsePools: () => void
	onCreatePool: () => void
	onOpenLiquidationModal: (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => void
	onReturnToCurrentUniverse?: () => void
	onSwitchToPoolUniverse?: (universeId: bigint, securityPoolAddress: string) => void
	onExecutePendingPoolOperation: (managerAddress: Address, operationId: bigint, securityPoolAddress: Address, universeId: bigint) => void
	onRefreshSelectedPoolData: (securityPoolAddress?: string) => void
	onRequestPoolPrice: (managerAddress: Address, securityPoolAddress: Address, reviewedRequestValueAttoEth: bigint, universeId: bigint) => void
	onSelectedPoolViewChange: (view: string | undefined) => void
	onViewPendingReport: (reportId: bigint) => void
	selectedPoolRefreshNonce: number
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	poolOracleActiveAction: OpenOracleActionResult['action'] | undefined
	poolOracleManagerError: string | undefined
	poolOracleManagerErrorAddress: Address | undefined
	poolPriceOracleResult: OpenOracleActionResult | undefined
	universeForkTime?: bigint | undefined
	selectedPoolView: string
	securityPoolAddress: string
	onSecurityPoolAddressChange: (value: string) => void
	reporting: ReportingRouteContentProps
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	securityPools: ListedSecurityPool[]
	securityVault: SecurityVaultRouteContentProps
	trading: TradingRouteContentProps
}

export type SecurityPoolsSectionProps = {
	activeView: SecurityPoolsView
	createPool: SecurityPoolRouteContentProps
	loadingUniverseDirectoryPools?: boolean | undefined
	onActiveUniverseChange?: (universeId: bigint) => void
	onActiveViewChange: (view: SecurityPoolsView) => void
	onLoadUniverseDirectoryPools?: (() => void) | undefined
	overview: SecurityPoolsOverviewRouteContentProps
	securityPools: ListedSecurityPool[]
	securityPoolUniverseDirectoryError?: string | undefined
	universeDirectoryPools?: ListedSecurityPool[] | undefined
	workflow: SecurityPoolWorkflowRouteContentProps
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

type SecurityVaultRouteContentProps = {
	accountState: AccountState
	loadingSecurityVault: boolean
	onApproveRep: (amount?: bigint) => void
	onDepositRepToVault: () => void
	onLoadSecurityVault: (vaultAddress?: string) => void
	onRedeemFees: () => void
	onRedeemRepFromVault: () => void
	onSecurityVaultFormChange: (update: Partial<SecurityVaultFormState>) => void
	onWithdrawRep: () => void
	securityVaultActiveAction: SecurityVaultActionResult['action'] | undefined
	securityVaultDetails: SecurityVaultDetails | undefined
	securityVaultError: string | undefined
	securityVaultForm: SecurityVaultFormState
	securityVaultMissing: boolean
	securityVaultRepApproval: TokenApprovalState
	walletRepBalanceAttoRep: bigint | undefined
	walletRepBalanceError: string | undefined
	walletRepBalanceLoading: boolean
	securityVaultResult: SecurityVaultActionResult | undefined
	selectedPoolStatoblastSecurityMultiplierBps: bigint | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	securityPoolVaults?: SecurityPoolVaultSummary[] | undefined
}

export type SecurityVaultSectionProps = SecurityVaultRouteContentProps & {
	compactLayout?: boolean
	extraReadinessActions?: ReadinessAction[]
	modalFirst?: boolean
	onViewStagedOperations?: () => void
	oracleManagerDetails?: OracleManagerDetails | undefined
	poolState?: SecurityPoolStateModel | undefined
	selectedPoolTotalPoolHeldAttoRep?: bigint | undefined
	selectedPoolTotalCapacityOwnershipAttoRep?: bigint | undefined
	selectedMarketTitle?: string | undefined
	autoLoadVault?: boolean
	showLookupSection?: boolean
	showSummarySection?: boolean
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

type TradingRouteContentProps = {
	accountState: AccountState
	loadingTradingForkUniverse: boolean
	loadingTradingDetails: boolean
	onCreateCompleteSet: () => void
	onMigrateShares: () => void
	onRedeemCompleteSet: () => void
	onRedeemShares: () => void
	onTradingFormChange: (update: Partial<TradingFormState>) => void
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | 'mock' | undefined
	repPerEthSourceUrl: string | undefined
	selectedPool: ListedSecurityPool | undefined
	tradingActiveAction: TradingActionResult['action'] | undefined
	tradingDetails: TradingDetails | undefined
	tradingError: string | undefined
	tradingForkUniverse: ZoltarUniverseSummary | undefined
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | undefined
}

export type TradingSectionProps = TradingRouteContentProps & {
	embedInCard?: boolean
	poolState?: SecurityPoolStateModel | undefined
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

export type SettlementSelectedBid = {
	tick: bigint
	bidIndex: bigint
}

type ForkAuctionRouteContentProps = {
	accountState: AccountState
	forkAuctionDetails: ForkAuctionDetails | undefined
	forkAuctionActiveAction: ForkAuctionActionResult['action'] | undefined
	forkAuctionError: string | undefined
	forkAuctionForm: ForkAuctionFormState
	forkAuctionResult: ForkAuctionActionResult | undefined
	loadingForkAuctionDetails: boolean
	onClaimAuctionProceeds: (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[], universeIdOverride?: bigint) => void
	onCreateChildUniverse: () => void
	onFinalizeTruthAuction: (securityPoolAddressOverride?: Address, universeIdOverride?: bigint) => void
	onForkAuctionFormChange: (update: Partial<ForkAuctionFormState>) => void
	onForkUniverse: () => void
	onForkWithOwnEscalation: () => void
	onInitiateFork: () => void
	onLoadForkAuction: (securityPoolAddressOverride?: Address) => void
	onClaimParentEscalationDeposits: (outcome: ReportingOutcomeKey, depositIndexes?: bigint[]) => void
	onMigrateUnresolvedEscalation: (selectedChildOutcome: ReportingOutcomeKey) => void
	onMigrateRepToZoltar: (outcomes?: ReportingOutcomeKey[]) => void
	onMigrateVault: () => void
	onRefundLosingBids: (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[], universeIdOverride?: bigint) => void
	onStartTruthAuction: (securityPoolAddressOverride?: Address, universeIdOverride?: bigint) => void
	onSubmitBid: (securityPoolAddressOverride?: Address, universeIdOverride?: bigint) => void
	onWithdrawForkedEscalation: (outcome: ReportingOutcomeKey, parentDepositIndexes: bigint[]) => void
}

export type ForkAuctionSectionProps = ForkAuctionRouteContentProps & {
	auctionDetailsOverride?: ForkAuctionDetails | undefined
	currentTimestamp?: bigint | undefined
	disabled?: boolean
	disabledMessage?: string | undefined
	embedInCard?: boolean
	forkMigrationReadClient?: Pick<ReadClient, 'readContract'> | ReadClient | undefined
	lifecycleStateOverride?: SecurityPoolLifecycleState | undefined
	loadingReportingDetails?: boolean
	onLoadReporting?: (() => void) | undefined
	onReportingFormChange?: ((update: Partial<ReportingFormState>) => void) | undefined
	previewPool?: ListedSecurityPool | undefined
	reportingDetails?: ReportingDetails | undefined
	reportingError?: string | undefined
	reportingForm?: ReportingFormState | undefined
	securityPools?: ListedSecurityPool[] | undefined
	selectedPoolRefreshNonce?: number | undefined
	universeForkTime?: bigint | undefined
	currentStageView?: ForkAuctionStageView | undefined
	selectedStageView?: ForkWorkflowSelectionStage | undefined
	stageView?: ForkAuctionStageView | undefined
	onSelectedStageViewChange?: ((stage: ForkWorkflowSelectionStage) => void) | undefined
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
	truthAuctionReadClient?: Pick<ReadClient, 'readContract'> | ReadClient | undefined
}
