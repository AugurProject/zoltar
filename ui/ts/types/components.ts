import type { Address } from 'viem'
import type { AccountState, MarketFormState, Route } from './app.js'
import type { DeploymentStatus, DeploymentStepId, MarketCreationResult } from './contracts.js'

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
	onRouteChange: (route: Route) => void
}
