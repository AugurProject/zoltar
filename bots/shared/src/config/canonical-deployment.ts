import { getAddress } from '../ethereum.ts'
import { getUniswapNetworkDeployment, MAINNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from '@zoltar/core-shared/deployment/uniswapDeployments'

type DeploymentManifest = {
	deploymentSteps: readonly { id: string; address: string }[]
	derivedContracts: readonly { id: string; address: string }[]
	network: { wethAddress: string }
}

export function canonicalCoreDeployment(manifest: DeploymentManifest) {
	const address = (id: string) => {
		const step = [...manifest.deploymentSteps, ...manifest.derivedContracts].find(step => step.id === id)
		if (step === undefined) throw new Error(`Canonical CREATE2 manifest is missing ${id}`)
		return getAddress(step.address)
	}
	return {
		zoltar: address('zoltar'),
		multicall3: address('multicall3'),
		questionData: address('zoltarQuestionData'),
		openOracle: address('openOracle'),
		securityPoolFactory: address('securityPoolFactory'),
		securityPoolForker: address('securityPoolForker'),
		weth: getAddress(manifest.network.wethAddress),
	}
}

export function canonicalNetworkDeployment(manifest: { network: { chainId: number; genesisRepTokenAddress: string; wethAddress: string } }) {
	return {
		chainId: manifest.network.chainId,
		rep: getAddress(manifest.network.genesisRepTokenAddress),
		weth: getAddress(manifest.network.wethAddress),
	}
}

// Uniswap addresses come from the shared registry. Every non-mainnet bot network reads its
// core addresses from the Sepolia manifest, so a custom chain is a Sepolia replay (an Anvil
// node with the published contracts installed by deploy:testnet) and resolves the Sepolia
// entry; deterministic testnets need a generated manifest before the bots can target them.
export function canonicalUniswapDeployment(chainId: number) {
	const deployment = getUniswapNetworkDeployment(chainId === MAINNET_CHAIN_ID ? MAINNET_CHAIN_ID : SEPOLIA_CHAIN_ID)
	return {
		factory: deployment.uniswapV3FactoryAddress,
		quoter: deployment.uniswapV3QuoterAddress,
		router: deployment.uniswapV3SwapRouterAddress,
		v2Router: deployment.uniswapV2RouterAddress,
		v4PoolManager: deployment.uniswapV4PoolManagerAddress,
		v4Quoter: deployment.uniswapV4QuoterAddress,
	}
}
