import type { Address } from 'viem'
import type { AccountState, ForkAuctionFormState, MarketFormState, OpenOracleCreateFormState, OpenOracleFormState, ReportingFormState, Route, SecurityPoolFormState, SecurityVaultFormState, TradingFormState, ZoltarMigrationFormState } from './app.js'
import type {
	DeploymentStatus,
	DeploymentStepId,
	ForkAuctionActionResult,
	ForkAuctionDetails,
	ListedSecurityPool,
	MarketCreationResult,
	MarketDetails,
	OpenOracleActionResult,
	OpenOracleReportDetails,
	OracleManagerDetails,
	ReportingActionResult,
	ReportingDetails,
	SecurityPoolCreationResult,
	SecurityPoolOverviewActionResult,
	SecurityPoolVaultSummary,
	SecurityVaultActionResult,
	SecurityVaultDetails,
	TradingActionResult,
	ZoltarMigrationActionResult,
	ZoltarUniverseSummary,
} from './contracts.js'
import type { OpenOracleInitialReportPriceSource } from '../lib/openOracle.js'
import type { LoadableValueState } from '../lib/loadState.js'
import type { TokenApprovalState } from '../lib/tokenApproval.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
import type { OpenOracleInitialReportQuoteFailureKind, OpenOracleInitialReportQuoteSource } from '../lib/openOracle.js'

export type DeploymentSectionProps = {
	title: string
	steps: DeploymentStatus[]
	allSteps: DeploymentStatus[]
	accountAddress: Address | undefined
	isMainnet: boolean
	busyStepId: DeploymentStepId | undefined
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
}

export type OverviewPanelsProps = {
	accountState: AccountState
	isConnectingWallet: boolean
	walletBootstrapComplete: boolean
	universeRepBalance: bigint | undefined
	isLoadingUniverseRepBalance: boolean
	universePresentation: UserMessagePresentation | undefined
	universeLabel: string
	isRefreshing: boolean
	repEthPrice: bigint | undefined
	repEthSource: 'v4' | 'v3' | undefined
	repEthSourceUrl: string | undefined
	repUsdcPrice: bigint | undefined
	repUsdcSource: 'v4' | 'v3' | undefined
	repUsdcSourceUrl: string | undefined
	isLoadingRepPrices: boolean
	onConnect: () => void
	onGoToGenesisUniverse: () => void
}

export type TabNavigationProps = {
	route: Route
	showDeployTab?: boolean
	augurPlaceHolderDeployed: boolean
	deployRoute: string
	marketRoute: string
	openOracleRoute: string
	securityPoolsRoute: string
	onRouteChange: (route: Exclude<Route, 'not-found'>) => void
}

export type MainnetGateSectionProps = {
	message: string
}

export type DeploymentRouteContentProps = {
	accountAddress: Address | undefined
	busyStepId: DeploymentStepId | undefined
	deploymentSections: { title: string; steps: DeploymentStatus[] }[]
	deploymentStatuses: DeploymentStatus[]
	isLoadingDeploymentStatuses: boolean
	isMainnet: boolean
	deployNextMissingPending: boolean
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
	onDeployNextMissing: () => void
}

export type MarketRouteContentProps = {
	accountState: AccountState
	onApproveZoltarForkRep: (amount?: bigint) => void
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	onCreateMarket: () => void
	onForkZoltar: () => void
	onMigrateInternalRep: () => void
	onPrepareRepForMigration: () => void
	marketCreating: boolean
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	onResetMarket: () => void
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	hasLoadedZoltarQuestions: boolean
	zoltarForkActiveAction: 'approve' | 'fork' | undefined
	loadingZoltarUniverse: boolean
	zoltarUniverseState: LoadableValueState
	onLoadZoltarQuestions: () => void
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void
	zoltarQuestionCount: bigint | undefined
	zoltarForkApproval: TokenApprovalState
	zoltarForkError: string | undefined
	loadingZoltarForkAccess: boolean
	zoltarChildUniverseError: string | undefined
	zoltarForkPending: boolean
	zoltarForkQuestionId: string
	zoltarForkRepBalance: bigint | undefined
	zoltarMigrationError: string | undefined
	zoltarMigrationForm: ZoltarMigrationFormState
	zoltarMigrationChildRepBalances: Record<string, bigint | undefined>
	zoltarMigrationPending: boolean
	zoltarMigrationPreparedRepBalance: bigint | undefined
	zoltarMigrationResult: ZoltarMigrationActionResult | undefined
	zoltarQuestions: MarketDetails[]
	zoltarMigrationActiveAction: 'prepare' | 'split' | undefined
	zoltarUniverse: ZoltarUniverseSummary | undefined
	onZoltarForkQuestionIdChange: (questionId: string) => void
}

export type SecurityPoolRouteContentProps = {
	accountState: AccountState
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	onCreateSecurityPool: () => void
	onLoadMarket: () => void
	onLoadMarketById: (marketId: string) => Promise<void>
	onOpenCreatedPool?: (securityPoolAddress: Address) => void
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
}

export type MarketSectionProps = MarketRouteContentProps
export type SecurityPoolSectionProps = SecurityPoolRouteContentProps & {
	showHeader?: boolean
}

type LiquidationControlsProps = {
	closeLiquidationModal: () => void
	liquidationAmount: string
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onOpenLiquidationModal: (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
}

export type SecurityPoolsOverviewRouteContentProps = {
	accountState: AccountState
	checkedSecurityPoolAddress: string | undefined
	hasLoadedSecurityPools: boolean
	loadingSecurityPools: boolean
	onSelectSecurityPool?: (securityPoolAddress: string) => void
	onLoadSecurityPools: () => void
	securityPoolOverviewError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityPools: ListedSecurityPool[]
} & LiquidationControlsProps

export type SecurityPoolsOverviewSectionProps = SecurityPoolsOverviewRouteContentProps

export type SecurityPoolWorkflowRouteContentProps = {
	accountState: AccountState
	activeUniverseId: bigint
	checkedSecurityPoolAddress: string | undefined
	closeLiquidationModal: () => void
	forkAuction: ForkAuctionRouteContentProps
	liquidationAmount: string
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTargetVault: string
	loadingPoolOracleManager: boolean
	loadingSecurityPools: boolean
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onOpenLiquidationModal: (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	onRefreshSelectedPoolData: () => void
	onRequestPoolPrice: (managerAddress: Address) => void
	onViewPendingReport: (reportId: bigint) => void
	poolOracleManagerDetails: OracleManagerDetails | undefined
	poolOracleManagerError: string | undefined
	poolPriceOracleResult: OpenOracleActionResult | undefined
	securityPoolAddress: string
	onSecurityPoolAddressChange: (value: string) => void
	reporting: ReportingRouteContentProps
	securityPools: ListedSecurityPool[]
	securityVault: SecurityVaultRouteContentProps
	trading: TradingRouteContentProps
}

export type SecurityPoolsSectionProps = {
	createPool: SecurityPoolRouteContentProps
	overview: SecurityPoolsOverviewRouteContentProps
	workflow: SecurityPoolWorkflowRouteContentProps
}

export type SecurityVaultRouteContentProps = {
	accountState: AccountState
	loadingSecurityVault: boolean
	onApproveRep: (amount?: bigint) => void
	onDepositRep: () => void
	onLoadSecurityVault: (vaultAddress?: string) => void
	onRedeemFees: () => void
	onSetSecurityBondAllowance: () => void
	onSecurityVaultFormChange: (update: Partial<SecurityVaultFormState>) => void
	onWithdrawRep: () => void
	securityVaultActiveAction: SecurityVaultActionResult['action'] | undefined
	securityVaultDetails: SecurityVaultDetails | undefined
	securityVaultError: string | undefined
	securityVaultForm: SecurityVaultFormState
	securityVaultMissing: boolean
	securityVaultRepApproval: TokenApprovalState
	securityVaultRepBalance: bigint | undefined
	securityVaultResult: SecurityVaultActionResult | undefined
	securityPoolVaults?: SecurityPoolVaultSummary[] | undefined
}

export type SecurityVaultSectionProps = SecurityVaultRouteContentProps & {
	compactLayout?: boolean
	oracleManagerDetails?: OracleManagerDetails | undefined
	autoLoadVault?: boolean
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

export type OpenOracleRouteContentProps = {
	accountState: AccountState
	loadingOracleReport: boolean
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onCreateOpenOracleGame: () => void
	onDisputeReport: () => void
	onLoadOracleReport: (reportId?: string) => void
	onRefreshPrice: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onOpenOracleCreateFormChange: (update: Partial<OpenOracleCreateFormState>) => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	onWrapWethForInitialReport: () => void
	loadingOpenOracleCreate: boolean
	openOracleActiveAction: OpenOracleActionResult['action'] | undefined
	openOracleError: string | undefined
	openOracleInitialReportState: {
		defaultPrice: string | undefined
		defaultPriceError: string | undefined
		defaultPriceSource: OpenOracleInitialReportPriceSource | undefined
		defaultPriceSourceUrl: string | undefined
		ethBalance: bigint | undefined
		ethBalanceError: string | undefined
		loading: boolean
		quoteAttemptedSources: OpenOracleInitialReportQuoteSource[] | undefined
		quoteFailureKind: OpenOracleInitialReportQuoteFailureKind | undefined
		quoteFailureReason: string | undefined
		token1Approval: TokenApprovalState
		token1Balance: bigint | undefined
		token1BalanceError: string | undefined
		token1Decimals: number | undefined
		token2Approval: TokenApprovalState
		token2Balance: bigint | undefined
		token2BalanceError: string | undefined
		token2Decimals: number | undefined
	}
	openOracleCreateForm: OpenOracleCreateFormState
	openOracleForm: OpenOracleFormState
	openOracleReportDetails: OpenOracleReportDetails | undefined
	openOracleResult: OpenOracleActionResult | undefined
}

export type OpenOracleView = 'browse' | 'create' | 'selected-report'

export type OpenOracleSectionProps = OpenOracleRouteContentProps & { initialView: OpenOracleView | undefined }

export type ReportingRouteContentProps = {
	accountState: AccountState
	loadingReportingDetails: boolean
	onLoadReporting: () => void
	onReportOutcome: () => void
	onReportingFormChange: (update: Partial<ReportingFormState>) => void
	onWithdrawEscalation: () => void
	reportingDetails: ReportingDetails | undefined
	reportingError: string | undefined
	reportingForm: ReportingFormState
	reportingResult: ReportingActionResult | undefined
}

export type ReportingSectionProps = ReportingRouteContentProps & {
	embedInCard?: boolean
	showHeader?: boolean
	showSecurityPoolAddressInput?: boolean
}

export type TradingRouteContentProps = {
	accountState: AccountState
	onCreateCompleteSet: () => void
	onMigrateShares: () => void
	onRedeemCompleteSet: () => void
	onRedeemShares: () => void
	onTradingFormChange: (update: Partial<TradingFormState>) => void
	selectedPool: ListedSecurityPool | undefined
	tradingError: string | undefined
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | undefined
}

export type TradingSectionProps = TradingRouteContentProps & {
	embedInCard?: boolean
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

export type ForkAuctionRouteContentProps = {
	accountState: AccountState
	forkAuctionDetails: ForkAuctionDetails | undefined
	forkAuctionError: string | undefined
	forkAuctionForm: ForkAuctionFormState
	forkAuctionResult: ForkAuctionActionResult | undefined
	loadingForkAuctionDetails: boolean
	onClaimAuctionProceeds: () => void
	onCreateChildUniverse: () => void
	onFinalizeTruthAuction: () => void
	onForkAuctionFormChange: (update: Partial<ForkAuctionFormState>) => void
	onForkUniverse: () => void
	onForkWithOwnEscalation: () => void
	onInitiateFork: () => void
	onLoadForkAuction: () => void
	onMigrateEscalationDeposits: () => void
	onMigrateRepToZoltar: () => void
	onMigrateVault: () => void
	onRefundLosingBids: () => void
	onStartTruthAuction: () => void
	onSubmitBid: () => void
	onWithdrawBids: () => void
}

export type ForkAuctionSectionProps = ForkAuctionRouteContentProps & {
	disabled?: boolean
	disabledMessage?: string | undefined
	previewPool?: ListedSecurityPool | undefined
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}
