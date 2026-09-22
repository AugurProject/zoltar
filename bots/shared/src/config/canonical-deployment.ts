import { getAddress } from '../ethereum.ts'

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

// Mainnet uses Uniswap's mainnet deployment; every other chain uses Uniswap's published
// Sepolia deployment, which deploy:testnet installs on Anvil development nodes:
// https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
// https://developers.uniswap.org/docs/protocols/v4/deployments
// Uniswap publishes no SwapRouter (v1) on Sepolia, so the testnet router is the
// deterministic SwapRouter installed by deploy:testnet and bound to the published factory.
// tooling/contracts/uniswap-deployment.test.ts checks these against the deployment plan.
export function canonicalUniswapDeployment(chainId: number) {
	const mainnet = chainId === 1
	return {
		factory: getAddress(mainnet ? '0x1F98431c8aD98523631AE4a59f267346ea31F984' : '0x0227628f3F023bb0B980b67D528571c95c6DaC1c'),
		quoter: getAddress(mainnet ? '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' : '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'),
		router: getAddress(mainnet ? '0xE592427A0AEce92De3Edee1F18E0157C05861564' : '0xa277024D80f829d58471239f4359933Dd6f18155'),
		v2Router: mainnet ? getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D') : undefined,
		v4PoolManager: getAddress(mainnet ? '0x000000000004444c5dc75cB358380D2e3dE08A90' : '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'),
		v4Quoter: getAddress(mainnet ? '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203' : '0x61b3f2011a92d183c7dbadbda940a7555ccf9227'),
	}
}
