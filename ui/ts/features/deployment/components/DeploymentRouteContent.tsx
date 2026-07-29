import * as commonCopy from '../../../copy/common.js'
import * as deploymentCopy from '../../../copy/deployment.js'
import type { ComponentChildren } from 'preact'
import { LoadableValue } from '../../../components/LoadableValue.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { DeploymentSection } from './DeploymentSection.js'
import { RouteHeader } from '../../../components/RouteHeader.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { buildRouteHref, getTopLevelRouteSearch, ZOLTAR_ROUTE } from '../../../lib/routing.js'
import { writeZoltarViewQueryParam } from '../../../lib/urlParams.js'
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../../types.js'

export function DeploymentRouteContent({ accountAddress, busyStepId, deployNextMissingPending, deploymentSections, deploymentStatuses, isLoadingDeploymentStatuses, isMainnet, onDeploy, onDeployNextMissing }: DeploymentRouteContentProps) {
	const nextMissingStep = findNextDeployableStep(deploymentStatuses)
	const deployedContractCount = deploymentStatuses.filter(step => step.deployed).length
	const totalContractCount = deploymentStatuses.length
	const deploymentComplete = !isLoadingDeploymentStatuses && totalContractCount > 0 && deployedContractCount === totalContractCount
	const questionsHref = buildRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(getTopLevelRouteSearch('zoltar'), 'questions'))
	const deployNextAvailability = getDeployNextMissingAvailability({
		accountAddress,
		busyStepId,
		deployNextMissingPending,
		isMainnet,
		nextMissingStep,
	})
	let buttonContent: ComponentChildren = deploymentCopy.deployNextMissing
	if (deployNextMissingPending) {
		buttonContent = deploymentCopy.deploying
	} else if (busyStepId !== undefined) buttonContent = deploymentCopy.deploymentRunningStatusLabel

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
						<TransactionActionButton idleLabel={buttonContent} pendingLabel={deploymentCopy.deploying} onClick={onDeployNextMissing} pending={deployNextMissingPending} availability={deployNextAvailability} />
					)
				}
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>{deploymentCopy.contractsDeployed}</p>
							<strong>
								<LoadableValue loading={isLoadingDeploymentStatuses} placeholder={deploymentCopy.loadingDeploymentStatus}>
									{deployedContractCount} / {totalContractCount}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<p className='detail'>{deploymentCopy.nextDeployable}</p>
							<strong>{isLoadingDeploymentStatuses ? <LoadingText /> : (nextMissingStep?.label ?? deploymentCopy.allDeployed)}</strong>
						</div>
					</DataGrid>
				}
			/>
			<details className='deployment-contract-details'>
				<summary>
					<span>{deploymentCopy.allContracts}</span>
				</summary>
				<div className='workflow-stack deployment-contract-groups'>
					{deploymentSections.map(section => {
						const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed)
						const sectionContent = <DeploymentSection title={section.title} completedGroup={allDeployed} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />
						return <div key={section.title}>{sectionContent}</div>
					})}
				</div>
			</details>
		</>
	)
}
