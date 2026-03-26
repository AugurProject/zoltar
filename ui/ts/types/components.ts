import type { Address } from 'viem'
import type { AccountState, ForkAuctionFormState, MarketFormState, OpenOracleFormState, ReportingFormState, Route, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from './app.js'
import type { DeploymentStatus, DeploymentStepId, ForkAuctionActionResult, ForkAuctionDetails, ListedSecurityPool, MarketCreationResult, MarketDetails, OpenOracleActionResult, OracleManagerDetails, ReportingActionResult, ReportingDetails, SecurityPoolCreationResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, SecurityVaultDetails, TradingActionResult } from './contracts.js'

export type DeploymentSectionProps = {
	title: string
	steps: DeploymentStatus[]
	allSteps: DeploymentStatus[]
	accountAddress: Address | undefined
	isMainnet: boolean
	busyStepId: DeploymentStepId | undefined
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
}

export type HeroSectionProps = {
	accountAddress: Address | undefined
	isRefreshing: boolean
	onRefresh: () => void
	onConnect: () => void
}

export type MarketSectionProps = {
	accountState: AccountState
	deploymentStatuses: DeploymentStatus[]
	marketForm: MarketFormState
	marketCreating: boolean
	marketResult: MarketCreationResult | undefined
	marketError: string | undefined
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onCreateMarket: () => void
	onResetMarket: () => void
}

export type OverviewPanelsProps = {
	accountState: AccountState
	deploymentStatuses: DeploymentStatus[]
	busyStepId: DeploymentStepId | undefined
	onDeployNextMissing: () => void
	universeLabel: string
}

export type TabNavigationProps = {
	route: Route
	deployRoute: string
	forkAuctionRoute: string
	marketRoute: string
	openOracleRoute: string
	reportingRoute: string
	securityPoolRoute: string
	securityPoolsOverviewRoute: string
	securityVaultRoute: string
	tradingRoute: string
	onRouteChange: (route: Route) => void
}

export type SecurityPoolSectionProps = {
	accountState: AccountState
	deploymentStatuses: DeploymentStatus[]
	lastCreatedQuestionId: string | undefined
	marketDetails: MarketDetails | undefined
	loadingMarketDetails: boolean
	securityPoolCreating: boolean
	securityPoolError: string | undefined
	securityPoolForm: SecurityPoolFormState
	securityPoolResult: SecurityPoolCreationResult | undefined
	onLoadLatestMarket: () => void
	onLoadMarket: () => void
	onSecurityPoolFormChange: (update: Partial<SecurityPoolFormState>) => void
	onCreateSecurityPool: () => void
}

export type SecurityVaultSectionProps = {
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

export type OpenOracleSectionProps = {
	accountState: AccountState
	loadingOracleManager: boolean
	onApproveToken1: () => void
	onApproveToken2: () => void
	onLoadOracleManager: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onQueueOperation: () => void
	onRequestPrice: () => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	openOracleError: string | undefined
	openOracleForm: OpenOracleFormState
	openOracleResult: OpenOracleActionResult | undefined
	oracleManagerDetails: OracleManagerDetails | undefined
}

export type SecurityPoolsOverviewSectionProps = {
	accountState: AccountState
	liquidationAmount: string
	liquidationTargetVault: string
	loadingSecurityPools: boolean
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onLoadSecurityPools: () => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	securityPoolOverviewError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityPools: ListedSecurityPool[]
}

export type TradingSectionProps = {
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

export type ReportingSectionProps = {
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

export type ForkAuctionSectionProps = {
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

export type MainnetGateSectionProps = {
	message: string
}

export type DeploymentRouteContentProps = {
	accountAddress: Address | undefined
	busyStepId: DeploymentStepId | undefined
	deploymentSections: { title: string; steps: DeploymentStatus[] }[]
	deploymentStatuses: DeploymentStatus[]
	isMainnet: boolean
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
	onDeployNextMissing: () => void
}

export type MarketRouteContentProps = {
	accountState: AccountState
	createMarket: () => void
	deploymentStatuses: DeploymentStatus[]
	marketCreating: boolean
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onResetMarket: () => void
}

export type SecurityPoolRouteContentProps = {
	accountState: AccountState
	createPool: () => void
	deploymentStatuses: DeploymentStatus[]
	lastCreatedQuestionId: string | undefined
	loadMarket: () => void
	loadMarketById: (marketId: string) => Promise<void>
	loadingMarketDetails: boolean
	marketDetails: MarketDetails | undefined
	onSecurityPoolFormChange: (update: Partial<SecurityPoolFormState>) => void
	securityPoolCreating: boolean
	securityPoolError: string | undefined
	securityPoolForm: SecurityPoolFormState
	securityPoolResult: SecurityPoolCreationResult | undefined
}

export type SecurityPoolsOverviewRouteContentProps = {
	accountState: AccountState
	liquidationAmount: string
	liquidationTargetVault: string
	loadingSecurityPools: boolean
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onLoadSecurityPools: () => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	securityPoolOverviewError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityPools: ListedSecurityPool[]
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

export type OpenOracleRouteContentProps = {
	accountState: AccountState
	loadingOracleManager: boolean
	onApproveToken1: () => void
	onApproveToken2: () => void
	onLoadOracleManager: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onQueueOperation: () => void
	onRequestPrice: () => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	openOracleError: string | undefined
	openOracleForm: OpenOracleFormState
	openOracleResult: OpenOracleActionResult | undefined
	oracleManagerDetails: OracleManagerDetails | undefined
}

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

export type AppRouteContentProps = {
	deployment: DeploymentRouteContentProps
	forkAuction: ForkAuctionRouteContentProps
	market: MarketRouteContentProps
	openOracle: OpenOracleRouteContentProps
	reporting: ReportingRouteContentProps
	route: Route
	securityPool: SecurityPoolRouteContentProps
	securityPoolsOverview: SecurityPoolsOverviewRouteContentProps
	securityVault: SecurityVaultRouteContentProps
	trading: TradingRouteContentProps
	wrongNetworkMessage: string | undefined
}
