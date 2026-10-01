export interface ContractDeploymentRecord {
	deployment_block?: string | number | null
	deployment_checked_block?: string | number | null
	deployment_block_exact?: boolean | null
}

export const contractDeploymentStatus = (contract: ContractDeploymentRecord) => {
	if (contract.deployment_block !== null && contract.deployment_block !== undefined) return contract.deployment_block_exact === false ? { label: `Deployed at or before #${contract.deployment_block}`, tone: 'live' } : { label: 'Deployed', tone: 'live' }
	if (contract.deployment_checked_block !== null && contract.deployment_checked_block !== undefined) return { label: `No code at #${contract.deployment_checked_block}`, tone: 'error' }
	return { label: 'Checking deployment', tone: 'pending' }
}

export type ContractRegistrySection = 'Protocol contracts' | 'System dependencies' | 'Discovered contracts'

const dependencyContractKinds = new Set(['multicall3', 'proxyDeployer', 'reputationToken', 'uniswapV2Factory', 'uniswapV3Factory', 'uniswapV4PoolManager', 'usdc', 'weth'])

export const contractRegistrySection = (contract: { readonly kind: string; readonly provenance: string }): ContractRegistrySection => {
	if (contract.provenance !== 'manifest') return 'Discovered contracts'
	return dependencyContractKinds.has(contract.kind) ? 'System dependencies' : 'Protocol contracts'
}
