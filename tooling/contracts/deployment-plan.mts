import { type Hash } from '@zoltar/core-shared/evm/ethereum'
import { CANONICAL_TRADING_FEE_BPS, tradingDeploymentData } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { deployViaProxy, EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps as getZoltarDeploymentSteps } from '../../ui/zoltarShared/ts/protocol/deployment.ts'
import { EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps } from '../../ui/statoblastShared/ts/protocol/deployment.ts'
import type { NetworkProfile } from '../../ui/coreShared/ts/wallet/networkProfile.ts'
import type { UniswapDeployment } from './uniswap-deployment.mts'
import type { WriteClient } from '../../ui/coreShared/ts/wallet/chainBackend.ts'
import { getInfraContractAddresses } from '../../ui/statoblastShared/ts/protocol/deploymentHelpers.ts'
import { PROXY_DEPLOYER_ADDRESS } from '../../ui/zoltarShared/ts/protocol/zoltarDeploymentHelpers.ts'
import { trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryContract, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerContract } from '../../solidity/ts/types/contractArtifact.ts'

const EXPECTED_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	...EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	tradingFactory: '0x704324acb6a1225d216b2ce62e9d2f97c45d125133c6b6636511f954dabd730d',
	tradingRouter: '0x7c23e4880e5d273645acad7d434bb3199d29fb9eb6bb5494532c1cf5e9358910',
	arachnidCreate2Deployer: '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989',
}

// Contracts whose runtime code embeds WETH-derived addresses differ on testnets that use the deterministic WETH9.
const DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	openOraclePriceCoordinatorFactory: '0x006ef08f2c3c038e57a92d038dd9e69c5e0a2036f7f686df58e2ce3b8b29822a',
	securityPoolFactory: '0xa8fb2461bd75d58a3484d4d6e4f691773cf008d812f2fa47fab7e3b8e324749f',
	tradingFactory: '0x6dfcfabf847a3d8c0e6e3460fee5f4bd5b3165deb92f48867cd19ad3a60d8d2e',
	tradingRouter: '0x4770f3554397f50b063b2144e8567e82ea65d5313dd9206342a011df4743689e',
}

function getExpectedRuntimeCodeHash(id: string) {
	const hash = EXPECTED_RUNTIME_CODE_HASHES[id === 'zoltarDeploymentStatusOracle' ? 'deploymentStatusOracle' : id]
	if (hash === undefined) throw new Error(`Deployment step ${id} has no expected runtime code hash`)
	return hash
}

function getTradingDeploymentSteps(profile: NetworkProfile) {
	const { securityPoolFactory } = getInfraContractAddresses(profile)
	const { factoryAddress, factoryData, routerAddress, routerData } = tradingDeploymentData(
		PROXY_DEPLOYER_ADDRESS,
		securityPoolFactory,
		CANONICAL_TRADING_FEE_BPS,
		{ abi: factoryContract.abi, bytecode: `0x${factoryContract.evm.bytecode.object}` },
		{ abi: routerContract.abi, bytecode: `0x${routerContract.evm.bytecode.object}` },
	)
	return [
		{
			address: factoryAddress,
			dependencies: ['proxyDeployer', 'securityPoolFactory'],
			deploy: async (client: WriteClient) => await deployViaProxy(client, factoryData),
			id: 'tradingFactory',
			label: 'Trading factory',
		},
		{
			address: routerAddress,
			dependencies: ['proxyDeployer', 'tradingFactory'],
			deploy: async (client: WriteClient) => await deployViaProxy(client, routerData),
			id: 'tradingRouter',
			label: 'Trading router',
		},
	]
}

export function createCompleteDeploymentPlan(profile: NetworkProfile, uniswap: UniswapDeployment) {
	const [create2DeployerStep, permit2Step, ...uniswapQuoteSteps] = uniswap.steps
	if (create2DeployerStep === undefined || create2DeployerStep.id !== 'arachnidCreate2Deployer') throw new Error('Uniswap deployment plan must begin with the canonical CREATE2 deployer')
	if (permit2Step === undefined || permit2Step.id !== 'permit2') throw new Error('Uniswap deployment plan must deploy Permit2 after the canonical CREATE2 deployer')
	const [proxyDeployerStep, ...protocolSteps] = getDeploymentSteps(profile)
	if (proxyDeployerStep === undefined || proxyDeployerStep.id !== 'proxyDeployer') throw new Error('Protocol deployment plan must begin with the canonical proxy deployer')
	const zoltarOracle = getZoltarDeploymentSteps(profile).find(step => step.id === 'deploymentStatusOracle')
	if (zoltarOracle === undefined) throw new Error('Zoltar deployment plan is missing its deployment status oracle')
	const zoltarOracleStep = { ...zoltarOracle, id: 'zoltarDeploymentStatusOracle', label: 'Zoltar Deployment Status Oracle' }
	const protocolStepsWithExternalDependencies = protocolSteps.map(step => (step.id === 'openOracle' ? { ...step, dependencies: [...step.dependencies, 'permit2'] } : step))
	return [create2DeployerStep, permit2Step, proxyDeployerStep, ...uniswapQuoteSteps, zoltarOracleStep, ...protocolStepsWithExternalDependencies, ...getTradingDeploymentSteps(profile)].map(step => {
		const deterministicHash = uniswap.kind === 'deterministic' ? DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES[step.id] : undefined
		if (deterministicHash !== undefined) return { ...step, expectedRuntimeCodeHash: deterministicHash }
		if ('verifyRuntimeCode' in step && step.verifyRuntimeCode !== undefined) return step
		if ('expectedRuntimeCodeHash' in step && step.expectedRuntimeCodeHash !== undefined) return step
		return { ...step, expectedRuntimeCodeHash: getExpectedRuntimeCodeHash(step.id) }
	})
}
