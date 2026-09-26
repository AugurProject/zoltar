import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentStatus, DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'

export type * from '@zoltar/ui-core-shared/types/components.js'

export type DeploymentSectionProps = {
	title: string
	completedGroup?: boolean
	steps: DeploymentStatus[]
	allSteps: DeploymentStatus[]
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	busyStepId: DeploymentStepId | undefined
	deploymentStateReady: boolean
	deploymentStatusReasonElementId?: string | undefined
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
}

export type ZoltarView = 'overview' | 'questions' | 'create' | 'universes' | 'fork' | 'migrate'

export type DeploymentRouteContentProps = {
	accountAddress: Address | undefined
	busyStepId: DeploymentStepId | undefined
	deploymentStateReady: boolean
	deploymentStatusError: string | undefined
	deploymentSections: { title: string; steps: DeploymentStatus[] }[]
	deploymentStatuses: DeploymentStatus[]
	isLoadingDeploymentStatuses: boolean
	isOnActiveAppChain: boolean
	deployNextMissingPending: boolean
	deploymentCompleteHref?: string
	onDeploy: (stepId: DeploymentStepId) => Promise<void>
	onDeployNextMissing: () => void
	onRetryDeploymentStatus: () => void
}
