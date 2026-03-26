import type { Address } from 'viem'
import type { AccountState, MarketFormState, OpenOracleFormState, ReportingFormState, Route, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from './app.js'
import type { DeploymentStatus, DeploymentStepId, ListedSecurityPool, MarketCreationResult, MarketDetails, OpenOracleActionResult, OracleManagerDetails, ReportingActionResult, ReportingDetails, SecurityPoolCreationResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, SecurityVaultDetails, TradingActionResult } from './contracts.js'

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
	onRedeemCompleteSet: () => void
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

export type MainnetGateSectionProps = {
	message: string
}

export type AppRouteContentProps = {
	accountState: AccountState
	createMarket: () => void
	createPool: () => void
	deployNextMissing: () => void
	deployStep: (stepId: DeploymentStepId) => Promise<void>
	deploymentSections: { title: string; steps: DeploymentStatus[] }[]
	deploymentStatuses: DeploymentStatus[]
	lastCreatedQuestionId: string | undefined
	liquidationAmount: string
	liquidationTargetVault: string
	loadMarket: () => void
	loadMarketById: (marketId: string) => Promise<void>
	loadOracleManager: () => void
	loadReporting: () => void
	loadSecurityPools: () => void
	loadSecurityVault: () => void
	loadingMarketDetails: boolean
	loadingOracleManager: boolean
	loadingReportingDetails: boolean
	loadingSecurityPools: boolean
	loadingSecurityVault: boolean
	marketCreating: boolean
	marketDetails: MarketDetails | undefined
	marketError: string | undefined
	marketForm: MarketFormState
	marketResult: MarketCreationResult | undefined
	onApproveRep: () => void
	onApproveToken1: () => void
	onApproveToken2: () => void
	onCreateCompleteSet: () => void
	onDeployNextMissing: () => void
	onDepositRep: () => void
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTargetVaultChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	onRedeemCompleteSet: () => void
	onRedeemFees: () => void
	onRedeemRep: () => void
	onReportOutcome: () => void
	onRequestPrice: () => void
	onResetMarket: () => void
	onRouteChange: (route: Route) => void
	onSecurityPoolFormChange: (update: Partial<SecurityPoolFormState>) => void
	onSecurityVaultFormChange: (update: Partial<SecurityVaultFormState>) => void
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onReportingFormChange: (update: Partial<ReportingFormState>) => void
	onTradingFormChange: (update: Partial<TradingFormState>) => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	onUpdateVaultFees: () => void
	onWithdrawEscalation: () => void
	openOracleError: string | undefined
	openOracleForm: OpenOracleFormState
	openOracleResult: OpenOracleActionResult | undefined
	oracleManagerDetails: OracleManagerDetails | undefined
	reportingDetails: ReportingDetails | undefined
	reportingError: string | undefined
	reportingForm: ReportingFormState
	reportingResult: ReportingActionResult | undefined
	route: Route
	securityPoolCreating: boolean
	securityPoolError: string | undefined
	securityPoolForm: SecurityPoolFormState
	securityPoolOverviewError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityPoolResult: SecurityPoolCreationResult | undefined
	securityPools: ListedSecurityPool[]
	securityVaultDetails: SecurityVaultDetails | undefined
	securityVaultError: string | undefined
	securityVaultForm: SecurityVaultFormState
	securityVaultResult: SecurityVaultActionResult | undefined
	tradingError: string | undefined
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | undefined
	busyStepId: DeploymentStepId | undefined
	wrongNetworkMessage: string | undefined
}
