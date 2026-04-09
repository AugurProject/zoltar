import type { Address } from 'viem'
import type { AccountState, ForkAuctionFormState, MarketFormState, OpenOracleCreateFormState, OpenOracleReportFormState, ReportingFormState, Route, SecurityPoolFormState, SecurityVaultFormState, TradingFormState, ZoltarMigrationFormState } from './app.js'
import type {
	DeploymentStatus,
	DeploymentStepId,
	ForkAuctionActionResult,
	ForkAuctionDetails,
	ListedSecurityPool,
	MarketCreationResult,
	MarketDetails,
	OracleManagerDetails,
	OpenOracleGameSummary,
	OpenOracleActionResult,
	PriceOracleActionResult,
	ReportingActionResult,
	ReportingDetails,
	SecurityPoolCreationResult,
	SecurityPoolOverviewActionResult,
	SecurityVaultActionResult,
	SecurityVaultDetails,
	TradingActionResult,
	ZoltarMigrationActionResult,
	ZoltarUniverseSummary,
} from './contracts.js'

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
	universeErrorMessage: string | undefined
	universeLabel: string
	isRefreshing: boolean
	onConnect: () => void
	onGoToGenesisUniverse: () => void
	onRefresh: () => void
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
	onApproveZoltarForkRep: () => void
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
	zoltarUniverseMissing: boolean
	onLoadZoltarQuestions: () => void
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void
	zoltarQuestionCount: bigint | undefined
	zoltarForkAllowance: bigint | undefined
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
	lastCreatedQuestionId: string | undefined
	onLoadLatestMarket?: () => void
	onLoadMarket: () => void
	onLoadMarketById: (marketId: string) => Promise<void>
	loadingMarketDetails: boolean
	marketDetails: MarketDetails | undefined
	poolCreationMarketDetails: MarketDetails | undefined
	onSecurityPoolFormChange: (update: Partial<SecurityPoolFormState>) => void
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
	loadingSecurityPools: boolean
	onSelectSecurityPool?: (securityPoolAddress: string) => void
	onLoadSecurityPools: () => void
	securityPoolOverviewError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityPools: ListedSecurityPool[]
} & LiquidationControlsProps

export type SecurityPoolsOverviewSectionProps = SecurityPoolsOverviewRouteContentProps & {
	showHeader?: boolean
}

export type SecurityPoolWorkflowRouteContentProps = {
	accountState: AccountState
	closeLiquidationModal: () => void
	forkAuction: ForkAuctionRouteContentProps
	liquidationAmount: string
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTargetVault: string
	loadingOracleManager: boolean
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onLoadOracleManager: (managerAddress: Address) => void
	onOpenLiquidationModal: (managerAddress: Address, securityPoolAddress: Address, vaultAddress: Address) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	onRequestPrice: (managerAddress: Address) => void
	oracleManagerDetails: OracleManagerDetails | undefined
	oracleManagerError: string | undefined
	priceOracleResult: PriceOracleActionResult | undefined
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
	onApproveRep: () => void
	onDepositRep: () => void
	onLoadSecurityVault: () => void
	onRedeemFees: () => void
	onRedeemRep: () => void
	onSecurityVaultFormChange: (update: Partial<SecurityVaultFormState>) => void
	onUpdateVaultFees: () => void
	securityVaultDetails: SecurityVaultDetails | undefined
	securityVaultError: string | undefined
	securityVaultForm: SecurityVaultFormState
	securityVaultResult: SecurityVaultActionResult | undefined
}

export type SecurityVaultSectionProps = SecurityVaultRouteContentProps & {
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}

export type OpenOracleRouteContentProps = {
	accountState: AccountState
	loadingOpenOracleGames: boolean
	nextReportId: bigint | undefined
	onCreateOpenOracleGame: () => void
	onApproveToken1: () => void
	onApproveToken2: () => void
	onLoadOpenOracleGames: () => void
	onLoadReportGame: (reportId: bigint) => void
	onOpenOracleCreateFormChange: (update: Partial<OpenOracleCreateFormState>) => void
	onOpenOracleReportFormChange: (update: Partial<OpenOracleReportFormState>) => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	openOracleError: string | undefined
	openOracleAddress: Address
	openOracleCreateForm: OpenOracleCreateFormState
	openOracleGames: OpenOracleGameSummary[]
	openOracleResult: OpenOracleActionResult | undefined
	openOracleReportForm: OpenOracleReportFormState
}

export type OpenOracleSectionProps = OpenOracleRouteContentProps

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
	tradingError: string | undefined
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | undefined
}

export type TradingSectionProps = TradingRouteContentProps & {
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
	showSecurityPoolAddressInput?: boolean
	showHeader?: boolean
}
