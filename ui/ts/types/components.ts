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
