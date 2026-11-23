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
			tradingFactory: '0xb220e58029dbe5904d78548c1af64a70a5a15dc717cd8c7167c482a3697dc850',
			tradingRouter: '0x344636f59aee266c1fbc05de20101661bd1d99a7b2619728ba950aafe0f44636',
		},
		no: {
			tradingFactory: '0x757d78a72079ffcebfb00ffba01db2fc5ec5dc79234fe053577060dc6a0dadad',
			tradingRouter: '0xa9badf0e88b53ae254186200ceeac7069bedd93c99fce9c6f7634eb9633313a9',
		},
	},
	deterministic: {
		yes: {
			tradingFactory: '0x2248ed8e974c1d5506f6ddbe562fa96f6c736079324213068bc8cda5f1a92c6f',
			tradingRouter: '0x39dff79e80f42c9fc4353b452b33cbde3fae9e7464ee8cf7cc120614dc11bd6f',
		},
		no: {
			tradingFactory: '0xeba78b213625a1fe77f2efd2ef6b02414fb219f52f17defdd3ac3058fe5a9df5',
			tradingRouter: '0x69376f8fc1d126ed76d68de74235550b9c40a2d12f4ceda14fc1485cff823fdd',
		},
	},
	mainnet: {
		yes: {
			tradingFactory: '0xf91affe552009a0a6c1d428cbf6b08821bb6cef827c2030715720a61bbed80c8',
			tradingRouter: '0x67677c1b62eb4a3048740bc5a6d53a1aa1692bfdd9dd6fddea9995e290dfbd77',
		},
		no: {
			tradingFactory: '0xdabc3f40ad6771f2b1e31f0846cc8e8bee0dbb1111eb9c8ead3834652f180624',
			tradingRouter: '0x52df746a6e80d2c98aec60d313bc61c03de21859d07f246eb451ccd6bb0b0bab',
		},
	},
}

// WETH-dependent immutables differ on chains with deterministic WETH9.
const DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES: Readonly<Record<GenesisOutcome, Readonly<Record<string, Hash>>>> = {
	yes: {
		openOraclePriceCoordinatorFactory: '0x243340ab6528ea5bd78a99958d507d4f984798afc53a273818b30ff9da6bfb14',
		securityPoolFactory: '0x937e054a3008bf56cade31d5e7dbc9831c96134b4e1b0503407a4fcd8e7e6b3c',
	},
	no: {
		openOraclePriceCoordinatorFactory: '0x243340ab6528ea5bd78a99958d507d4f984798afc53a273818b30ff9da6bfb14',
		securityPoolFactory: '0x8ae60411e980e63547fdded86542ca8ea90e013c83299c05ab49b92415642cb3',
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
