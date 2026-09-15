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

// Sepolia uses the contracts installed by deploy:testnet; mainnet uses upstream Uniswap.
// tooling/contracts/uniswap-deployment.test.ts checks these against the deployment bytecode.
export function canonicalUniswapDeployment(chainId: number) {
	const mainnet = chainId === 1
	return {
		factory: getAddress(mainnet ? '0x1F98431c8aD98523631AE4a59f267346ea31F984' : '0xEf09Be426F8d6D2786cADEA7D3A8b0D09cEB79B4'),
		quoter: getAddress(mainnet ? '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' : '0x6Aa53e5023fFDa81f7EEE31bdA5D35437A5DD841'),
		router: getAddress(mainnet ? '0xE592427A0AEce92De3Edee1F18E0157C05861564' : '0xC0a0e58Ae39603398D474BFd49d2904dE1464C99'),
		v2Router: mainnet ? getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D') : undefined,
	}
}
