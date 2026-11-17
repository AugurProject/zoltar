import type { Address, Hash, Hex } from '@zoltar/core-shared/evm/ethereum'
import { CANONICAL_TRADING_FEE_BPS, tradingDeploymentData } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { deployViaProxy, EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps as getZoltarDeploymentSteps } from '../../ui/zoltarShared/ts/protocol/deployment.ts'
import { EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES, getDeploymentSteps } from '../../ui/statoblastShared/ts/protocol/deployment.ts'
import { getGenesisNetworkProfile, type NetworkProfile } from '../../ui/coreShared/ts/wallet/networkProfile.ts'
import type { GenesisOutcome } from '../../shared/zoltar/ts/deployment/genesisUniverses.ts'
import type { BootstrapDescendantHashProfile } from './bootstrap-descendant-hashes.mts'
import type { UniswapDeployment } from './uniswap-deployment.mts'
import type { WriteClient } from '../../ui/coreShared/ts/wallet/chainBackend.ts'
import { getInfraContractAddresses } from '../../ui/statoblastShared/ts/protocol/deploymentHelpers.ts'
import { PROXY_DEPLOYER_ADDRESS } from '../../ui/zoltarShared/ts/protocol/zoltarDeploymentHelpers.ts'
import { trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryContract, trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerContract } from '../../solidity/ts/types/contractArtifact.ts'

export type DeploymentPlanStep<TClient> = {
	address: Address
	dependencies: readonly string[]
	deploy: (client: TClient) => Promise<Hash>
	expectedRuntimeCodeHash?: Hash
	id: string
	gasAllowanceId?: string
	label: string
	verifyRuntimeCode?: (client: TClient, code: Hex) => Promise<void>
}

const EXPECTED_RUNTIME_CODE_HASHES: Readonly<Record<string, Hash>> = {
	...EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	arachnidCreate2Deployer: '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989',
}

const EXPECTED_TRADING_RUNTIME_CODE_HASHES: Readonly<Record<BootstrapDescendantHashProfile, Readonly<Record<GenesisOutcome, Readonly<Record<string, Hash>>>>>> = {
	sepolia: {
		yes: {
			tradingFactory: '0x761a19db6474b3a47899312ecb9484c1fb4ab3d988d64e32bbc9786b699ac231',
			tradingRouter: '0xc0a6f2bd622f81a9d1c886dbb347a83c7dabb9146b2be33ad4d0ab10a5fd3357',
		},
		no: {
			tradingFactory: '0x7815fc33087fed2efb6b9c8f752775a403de40c2c46f3548dc5e5182dc7611cd',
			tradingRouter: '0x38b582c729f24089fd95deed16a897ea64748e2cbaf2b4fdbcfe10fb5a7ab105',
		},
	},
	deterministic: {
		yes: {
			tradingFactory: '0x50cd15c2fbe3b733c9b7fa135a88e7308c0cd82b87da50746a738b31749de5ad',
			tradingRouter: '0x0e68fe4de2d8beb564891ea13d9be4583a347aa0ea8bea4f43c03ab0449ecd2a',
		},
		no: {
			tradingFactory: '0xd64260e134960109753057b5770c6efd4f67e77c4943b64c1278f34cdc88b8ac',
			tradingRouter: '0xcf01b55a8018d7903f25fb967cf8ae43833c7d9db4e9cd7282ece1133546fbfb',
		},
	},
	mainnet: {
		yes: {
			tradingFactory: '0xdb895825c0d7ca730e32fe4ca0a427ad7f6ce09daecd642a42c173c73928b8a1',
			tradingRouter: '0x542b37a55f3feddbd9be65691cba6a1e7fa1719a7a06884f068c0f6a2e5a6987',
		},
		no: {
			tradingFactory: '0xf33d08521738414058e98e60c183bca43571aabf6553bbfb55e0be4e8a404257',
			tradingRouter: '0x6499649e27936c6d539cf00a3457d70be690853f5d2cf471de942a660af41ba7',
		},
	},
}

// WETH-dependent immutables differ on chains with deterministic WETH9.
const DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES: Readonly<Record<GenesisOutcome, Readonly<Record<string, Hash>>>> = {
	yes: {
		openOraclePriceCoordinatorFactory: '0xa4e77043ab90f177bf47c4229b2b3e5aac875baaf8c1b2f8bc6c217b63be6cfc',
		securityPoolFactory: '0x7f1510bdfa49ab0255b2d7017ce656e696a5da458130c01ed2146c2e2c36d7d7',
	},
	no: {
		openOraclePriceCoordinatorFactory: '0xa4e77043ab90f177bf47c4229b2b3e5aac875baaf8c1b2f8bc6c217b63be6cfc',
		securityPoolFactory: '0x43bf886d9d2ed03d286a0e5b23f73ccad36f9d9e40ab0466a8250f3807a78b8a',
	},
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

/** Trading steps with the runtime code hashes pinned for this network and its kind of Uniswap deployment. */
export function getPinnedTradingDeploymentSteps(profile: NetworkProfile, hashProfile: BootstrapDescendantHashProfile) {
	return getTradingDeploymentSteps(profile).map(step => {
		const expectedRuntimeCodeHash = EXPECTED_TRADING_RUNTIME_CODE_HASHES[hashProfile][profile.genesisOutcome][step.id]
		if (expectedRuntimeCodeHash === undefined) throw new Error(`Trading step ${step.id} has no pinned ${hashProfile} runtime code hash`)
		return { ...step, expectedRuntimeCodeHash }
	})
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
	const networkHashProfile = profile.id === 'mainnet' ? 'mainnet' : 'sepolia'
	const hashProfile = uniswap.kind === 'deterministic' ? 'deterministic' : networkHashProfile
	return [create2DeployerStep, permit2Step, proxyDeployerStep, ...uniswapQuoteSteps, zoltarOracleStep, ...protocolStepsWithExternalDependencies, ...getPinnedTradingDeploymentSteps(profile, hashProfile)].map(step => {
		const deterministicHash = uniswap.kind === 'deterministic' ? DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES[profile.genesisOutcome][step.id] : undefined
		if (deterministicHash !== undefined) return { ...step, expectedRuntimeCodeHash: deterministicHash }
		if ('verifyRuntimeCode' in step && step.verifyRuntimeCode !== undefined) return step
		if ('expectedRuntimeCodeHash' in step && step.expectedRuntimeCodeHash !== undefined) return step
		return { ...step, expectedRuntimeCodeHash: getExpectedRuntimeCodeHash(step.id) }
	})
}

/** Deploy both canonical roots once, sharing contracts whose CREATE2 address is identical. */
export function createDualGenesisDeploymentPlan(profile: NetworkProfile, uniswap: UniswapDeployment) {
	const outcomes = ['yes', 'no'] as const
	const plans = outcomes.map(outcome => ({ outcome, steps: createCompleteDeploymentPlan(getGenesisNetworkProfile(profile, outcome), uniswap) }))
	const counts = new Map<string, number>()
	for (const { steps } of plans) {
		for (const step of steps) {
			const address = step.address.toLowerCase()
			counts.set(address, (counts.get(address) ?? 0) + 1)
		}
	}
	const idsByAddress = new Map<string, string>()
	for (const { outcome, steps } of plans) {
		for (const step of steps) {
			const address = step.address.toLowerCase()
			if (!idsByAddress.has(address)) idsByAddress.set(address, counts.get(address) === outcomes.length ? step.id : `${outcome}:${step.id}`)
		}
	}
	const includedAddresses = new Set<string>()
	return plans.flatMap(({ outcome, steps }) => {
		const idsByOriginalId = new Map(steps.map(step => [step.id, idsByAddress.get(step.address.toLowerCase())]))
		return steps.flatMap(step => {
			const address = step.address.toLowerCase()
			if (includedAddresses.has(address)) return []
			includedAddresses.add(address)
			const id = idsByAddress.get(address)
			if (id === undefined) throw new Error(`Deployment step ${step.id} is missing its combined identifier`)
			const dependencies = step.dependencies.map(dependency => {
				const resolved = idsByOriginalId.get(dependency)
				if (resolved === undefined) throw new Error(`Deployment step ${step.id} has unknown dependency ${dependency}`)
				return resolved
			})
			return [{ ...step, dependencies, gasAllowanceId: step.id, id, label: counts.get(address) === outcomes.length ? step.label : `${step.label} (${outcome === 'yes' ? 'Yes' : 'No'})` }]
		})
	})
}
