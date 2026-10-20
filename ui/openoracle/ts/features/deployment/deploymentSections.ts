import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'

export function getOpenOracleDeploymentSections(steps: DeploymentStatus[]) {
	return [
		{ title: 'Utilities', steps: steps.filter(step => step.id === 'proxyDeployer' || step.id === 'multicall3') },
		{ title: 'OpenOracle', steps: steps.filter(step => step.id === 'openOracle') },
	].filter(section => section.steps.length > 0)
}
