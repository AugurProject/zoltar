import type { DeploymentStatusSnapshot, DeploymentStepId, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getDeploymentSteps as getStatoblastDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { assertDeploymentStepRuntimeCode } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

const requiredStepIds = new Set<DeploymentStepId>(['proxyDeployer', 'multicall3', 'openOracle'])

export function getOpenOracleDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	return getStatoblastDeploymentSteps(profile).filter(step => requiredStepIds.has(step.id))
}

export async function loadOpenOracleDeploymentStatus(client: Pick<ReadClient, 'getCode'>): Promise<DeploymentStatusSnapshot> {
	const deploymentStatuses = await Promise.all(getOpenOracleDeploymentSteps().map(async step => ({ ...step, deployed: assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address })) })))
	return { applicationDeploymentComplete: deploymentStatuses.every(step => step.deployed), deploymentStatuses }
}
