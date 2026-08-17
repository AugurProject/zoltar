import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as deploymentCopy from '../../../copy/deployment.js'
import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { LoadableValue } from '@zoltar/ui-core-shared/components/LoadableValue.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { DeploymentSection } from './DeploymentSection.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { buildRouteHref, getRouteHash, getTopLevelRouteSearch } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../../types.js'

export function DeploymentRouteContent({ accountAddress, busyStepId, deploymentStateReady, deploymentStatusError, deployNextMissingPending, deploymentSections, deploymentStatuses, isLoadingDeploymentStatuses, isOnActiveAppChain, onDeploy, onDeployNextMissing, onRetryDeploymentStatus }: DeploymentRouteContentProps) {
	const deploymentStatusReasonId = useId()
	const nextMissingStep = findNextDeployableStep(deploymentStatuses)
	const deployedContractCount = deploymentStatuses.filter(step => step.deployed).length
	const totalContractCount = deploymentStatuses.length
	const deploymentComplete = deploymentStateReady && !isLoadingDeploymentStatuses && totalContractCount > 0 && deployedContractCount === totalContractCount
	const questionsHref = buildRouteHref(getRouteHash('zoltar'), writeZoltarViewQueryParam(getTopLevelRouteSearch('zoltar'), 'questions'))
	const deployNextAvailability = deploymentStateReady
		? getDeployNextMissingAvailability({
				accountAddress,
				busyStepId,
				deployNextMissingPending,
				isOnActiveAppChain,
				nextMissingStep,
			})
		: { disabled: true, reason: deploymentCopy.deploymentStatusUnavailableReason }
	let buttonContent: ComponentChildren = deploymentCopy.deployNextMissing
	if (deployNextMissingPending) {
		buttonContent = deploymentCopy.deploying
	} else if (busyStepId !== undefined) buttonContent = deploymentCopy.deploymentRunningStatusLabel
	let nextDeployableContent: ComponentChildren = commonCopy.unavailable
	if (isLoadingDeploymentStatuses) nextDeployableContent = <LoadingText />
	else if (deploymentStateReady) nextDeployableContent = nextMissingStep?.label ?? deploymentCopy.allDeployed
	let deploymentStatusNotice: ComponentChildren
	if (!deploymentStateReady && isLoadingDeploymentStatuses)
		deploymentStatusNotice = (
			<p id={deploymentStatusReasonId} className='detail'>
				<LoadingText>{deploymentCopy.loadingDeploymentStatus}</LoadingText>
			</p>
		)
	else if (!deploymentStateReady)
		deploymentStatusNotice = (
			<>
				<p id={deploymentStatusReasonId} className='detail'>
					{deploymentCopy.deploymentStatusUnavailableReason}
				</p>
				<ErrorNotice message={deploymentStatusError} />
				{deploymentStatusError === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={onRetryDeploymentStatus}>
							{commonCopy.retry}
						</button>
					</div>
				)}
			</>
		)

	return (
		<>
			<RouteHeader
				className='deployment-route-header'
				eyebrow={commonCopy.deploy}
				title={deploymentCopy.deterministicContractDeployment}
				description={deploymentCopy.deploymentOverviewDetail}
				actions={
					deploymentComplete ? (
						<a className='button-link' href={questionsHref}>
							{deploymentCopy.browseQuestions}
						</a>
					) : (
						<TransactionActionButton
							disabledReasonElementId={deploymentStateReady ? undefined : deploymentStatusReasonId}
							idleLabel={buttonContent}
							pendingLabel={deploymentCopy.deploying}
							onClick={onDeployNextMissing}
							pending={deployNextMissingPending}
							availability={deployNextAvailability}
							showDisabledReason={deploymentStateReady}
						/>
					)
				}
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>{deploymentCopy.contractsDeployed}</p>
							<strong>
								<LoadableValue loading={isLoadingDeploymentStatuses} placeholder={deploymentCopy.loadingDeploymentStatus}>
									{deploymentStateReady ? `${deployedContractCount.toString()} / ${totalContractCount.toString()}` : commonCopy.unavailable}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<p className='detail'>{deploymentCopy.nextDeployable}</p>
							<strong>{nextDeployableContent}</strong>
						</div>
					</DataGrid>
				}
			/>
			{deploymentStatusNotice}
			<details className='deployment-contract-details'>
				<summary>
					<span>{deploymentCopy.allContracts}</span>
				</summary>
				<div className='workflow-stack deployment-contract-groups'>
					{deploymentSections.map(section => {
						const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed)
						const sectionContent = (
							<DeploymentSection
								title={section.title}
								completedGroup={allDeployed}
								steps={section.steps}
								allSteps={deploymentStatuses}
								accountAddress={accountAddress}
								isOnActiveAppChain={isOnActiveAppChain}
								busyStepId={busyStepId}
								deploymentStateReady={deploymentStateReady}
								deploymentStatusReasonElementId={deploymentStateReady ? undefined : deploymentStatusReasonId}
								onDeploy={onDeploy}
							/>
						)
						return <div key={section.title}>{sectionContent}</div>
					})}
				</div>
			</details>
		</>
	)
}
