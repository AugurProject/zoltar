import type { DeploymentSettings } from '#config/deployment-settings'

function input(id: string) {
	const element = document.getElementById(id)
	if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) throw new Error(`Missing deployment input: ${id}`)
	return element
}

export function createDeploymentForm() {
	let defaults: NonNullable<DeploymentSettings['uniswapDefaults']> = []
	// Editing an address selects it explicitly, even if it matches the displayed default.
	for (const [id, field] of Object.entries({
		'deployment-v3-factory': 'uniswapFactory',
		'deployment-v3-quoter': 'uniswapQuoter',
		'deployment-v3-router': 'uniswapRouter',
		'deployment-v2-router': 'uniswapV2Router',
	})) {
		input(id).addEventListener('input', () => {
			defaults = defaults.filter(candidate => candidate !== field)
		})
	}

	function loadDeployment(deployment: Omit<DeploymentSettings, 'openOracle' | 'rep' | 'weth'>) {
		defaults = deployment.uniswapDefaults ?? []
		input('deployment-executor').value = deployment.executor ?? ''
		input('deployment-v3-factory').value = deployment.uniswapFactory
		input('deployment-v3-quoter').value = deployment.uniswapQuoter
		input('deployment-v3-router').value = deployment.uniswapRouter ?? ''
		input('deployment-v2-router').value = deployment.uniswapV2Router ?? ''
		input('deployment-v4-pool-manager').value = deployment.uniswapV4PoolManager ?? ''
		input('deployment-v4-quoter').value = deployment.uniswapV4Quoter ?? ''
		input('deployment-coordinators').value = deployment.coordinatorAddresses.join('\n')
		input('deployment-quorum-rpcs').value = deployment.quorumRpcUrls.join('\n')
		input('deployment-manifest').value = deployment.deploymentManifest === undefined ? '' : JSON.stringify(deployment.deploymentManifest, undefined, 2)
	}

	return { loadDeployment, getDefaults: () => defaults }
}
