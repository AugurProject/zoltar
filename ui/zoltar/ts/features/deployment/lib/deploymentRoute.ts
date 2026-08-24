import type { Address } from '@zoltar/shared/ethereum'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import type { DeploymentRouteContentProps } from '../../types.js'
import type { useDeploymentFlow } from '../hooks/useDeploymentFlow.js'
import { getDeploymentSections } from './deployment.js'

type DeploymentFlow = Pick<ReturnType<typeof useDeploymentFlow>, 'busyStepId' | 'deployNextMissing' | 'deployNextMissingPending' | 'deployStep'>

type BuildDeploymentRouteContentPropsParameters = {
	accountAddress: Address | undefined
	deploymentCompleteHref?: string
	deploymentStateReady: boolean
	deploymentStatusError: string | undefined
	deploymentStatuses: DeploymentStatus[]
	flow: DeploymentFlow
	isLoadingDeploymentStatuses: boolean
	isOnActiveAppChain: boolean
	onRetryDeploymentStatus: () => void
}

export function buildDeploymentRouteContentProps({ accountAddress, deploymentCompleteHref, deploymentStateReady, deploymentStatusError, deploymentStatuses, flow, isLoadingDeploymentStatuses, isOnActiveAppChain, onRetryDeploymentStatus }: BuildDeploymentRouteContentPropsParameters): DeploymentRouteContentProps {
	return {
		accountAddress,
		busyStepId: flow.busyStepId,
		...(deploymentCompleteHref === undefined ? {} : { deploymentCompleteHref }),
		deploymentSections: getDeploymentSections(deploymentStatuses),
		deploymentStateReady,
		deploymentStatusError,
		deploymentStatuses,
		deployNextMissingPending: flow.deployNextMissingPending,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		onDeploy: flow.deployStep,
		onDeployNextMissing: () => void flow.deployNextMissing(),
		onRetryDeploymentStatus,
	}
}
