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
			tradingFactory: '0x1332073249aac2eb3472e949c2cd4eca9d39f0cdfe18b8c77fa38e3a0f551420',
			tradingRouter: '0x05bb3a35a8ec044d52ff0c5911f213dd5719b6fb921fc793af52c4059d9d0fb3',
		},
		no: {
			tradingFactory: '0x7ee9d00bf6d10120ab76960d0e4bf0e05fcee0f7279c7a9571bd59c65f8c678c',
			tradingRouter: '0x602b44e30c5f91bb79b78a9bd75b9141d618a0a3cca5242c1de78b238f8c0eac',
		},
	},
	deterministic: {
		yes: {
			tradingFactory: '0xb8ebd992557a92dc58c4a81ebf988ee2d8ca67edecefd48037f9e3f981c3b836',
			tradingRouter: '0xb1fe971b9bf366332bb203805179f6ae3e96605aa88f516cc05b47ec54077772',
		},
		no: {
			tradingFactory: '0xc5bc27c5cc16db78344a662f8e547f88dcff73f6b68669c116c0f671caa635a2',
			tradingRouter: '0x46032fb87b868e27bb481ebf40babe4fdf0a026aadce1509e5ada27e61558105',
		},
	},
	mainnet: {
		yes: {
			tradingFactory: '0x4c745fda1aa4227ec1e3f430402ac1b139dc2c171d70d19294e02d406663981e',
			tradingRouter: '0x7b951ef2568201d87903f2430766a8871d0a75d55fbab79c76a5a327bbc8246c',
		},
		no: {
			tradingFactory: '0x17d0e9aab8893790638523a210871669f89d6929d2fd6084b5382b020134bec4',
			tradingRouter: '0x332974c38535cc86343700d2e01c56e47e50d8f1ad99b8bef9167efc5ac4ab0a',
		},
	},
}

// WETH-dependent immutables differ on chains with deterministic WETH9.
const DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES: Readonly<Record<GenesisOutcome, Readonly<Record<string, Hash>>>> = {
	yes: {
		sharedPoolPriceFeedFactory: '0x33541ae00ff72ad6d017df17ac52ee62806195fed62c14776d04e15ed5187f64',
		securityPoolFactory: '0x89a6402bfcc9b2b1c903cb48bc20417d677f68101288a242604c86684cf7b2a5',
	},
	no: {
		sharedPoolPriceFeedFactory: '0x33541ae00ff72ad6d017df17ac52ee62806195fed62c14776d04e15ed5187f64',
		securityPoolFactory: '0xf7248b2241e6fdb9b31988f0555c99309a6314e2ac6e3b4230d98c05f0d24d2e',
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
