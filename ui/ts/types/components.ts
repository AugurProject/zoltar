import type { Address } from 'viem'
import type { AccountState, MarketFormState, OpenOracleFormState, Route, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from './app.js'
import type { DeploymentStatus, DeploymentStepId, ListedSecurityPool, MarketCreationResult, MarketDetails, OpenOracleActionResult, OracleManagerDetails, SecurityPoolCreationResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, SecurityVaultDetails, TradingActionResult } from './contracts.js'

export type DeploymentSectionProps = {
	title: string
	steps: DeploymentStatus[]
	allSteps: DeploymentStatus[]
	accountAddress: Address | null
	busyStepId: DeploymentStepId | null
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
}

export type HeroSectionProps = {
	accountAddress: Address | null
	isRefreshing: boolean
	onRefresh: () => void
	onConnect: () => void
}

export type MarketSectionProps = {
	accountState: AccountState
	deploymentStatuses: DeploymentStatus[]
	marketForm: MarketFormState
	marketCreating: boolean
	marketResult: MarketCreationResult | null
	marketError: string | null
	onMarketFormChange: (update: Partial<MarketFormState>) => void
	onCreateMarket: () => void
	onResetMarket: () => void
}

export type OverviewPanelsProps = {
	accountState: AccountState
	deploymentStatuses: DeploymentStatus[]
	busyStepId: DeploymentStepId | null
	onDeployNextMissing: () => void
}

export type TabNavigationProps = {
	route: Route
	deployRoute: string
	marketRoute: string
	openOracleRoute: string
	securityPoolRoute: string
	securityPoolsOverviewRoute: string
	securityVaultRoute: string
	tradingRoute: string
	onRouteChange: (route: Route) => void
}

export type SecurityPoolSectionProps = {
	accountState: AccountState
	deploymentStatuses: DeploymentStatus[]
	lastCreatedQuestionId: string | null
	marketDetails: MarketDetails | null
	loadingMarketDetails: boolean
	securityPoolCreating: boolean
	securityPoolError: string | null
	securityPoolForm: SecurityPoolFormState
	securityPoolResult: SecurityPoolCreationResult | null
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
	securityVaultDetails: SecurityVaultDetails | null
	securityVaultError: string | null
	securityVaultForm: SecurityVaultFormState
	securityVaultResult: SecurityVaultActionResult | null
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
	openOracleError: string | null
	openOracleForm: OpenOracleFormState
	openOracleResult: OpenOracleActionResult | null
	oracleManagerDetails: OracleManagerDetails | null
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
	securityPoolOverviewError: string | null
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | null
	securityPools: ListedSecurityPool[]
}

export type TradingSectionProps = {
	accountState: AccountState
	onCreateCompleteSet: () => void
	onRedeemCompleteSet: () => void
	onTradingFormChange: (update: Partial<TradingFormState>) => void
	tradingError: string | null
	tradingForm: TradingFormState
	tradingResult: TradingActionResult | null
}
