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
			tradingFactory: '0xac7c867eb2558e468fed10bbf10732894bbd644cdffed0606487d9270d09a76b',
			tradingRouter: '0x67573d521ebb0b42611a38ce1bf4ea1aa35a615c887766767ad88bbcae9d34e7',
		},
		no: {
			tradingFactory: '0xb781704e2188190607a758aeb5816cf6aa0abf34eab399f2703806cff5bbfe7b',
			tradingRouter: '0x06c9b9e21cf7942b478a34269a1abc74a21d097f762843d6cfce6598498f58ed',
		},
	},
	deterministic: {
		yes: {
			tradingFactory: '0xcdc1725351792e6fddecaf3ef2f9fb309bfe9a8c2e3b571e907a652fecbe2688',
			tradingRouter: '0x6d9870b987a86ba4f73fc74d9d10b762534c271843574522815f3541d87103f7',
		},
		no: {
			tradingFactory: '0x1466affddda2b85257fb67afa05bea767cf11cbe97c44c0729154b4e4261e34f',
			tradingRouter: '0xa8a38f29aa910df002fd07df26411e9263ca9d3a7bac82fe6c7d9308474e4c61',
		},
	},
	mainnet: {
		yes: {
			tradingFactory: '0x2f2af3776adfcbcbb2e78da6823e7c00bd4a9ecef51799a7a417b731c2466b62',
			tradingRouter: '0x749636c2d6f59a19b25ce4d8fc876ee57d87ae8c4db9398b756df262fc4ecd18',
		},
		no: {
			tradingFactory: '0x65fe8ff2a23cedb117eac776dd4004ed11735909ade32bd444a376a530bf82c1',
			tradingRouter: '0xd58eb4ac6985d25cddaa68f6bfb16fb7c82e5a983d8bdc0733b4c21b05cb8afc',
		},
	},
}

// WETH-dependent immutables differ on chains with deterministic WETH9.
const DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES: Readonly<Record<GenesisOutcome, Readonly<Record<string, Hash>>>> = {
	yes: {
		openOraclePriceCoordinatorFactory: '0xb0a625ba759fc66b063f73bcd2312906940fcfb6c9a146673dadad27b2055399',
		securityPoolFactory: '0x626df1474df239894fd76d01d6dcdc57d067196f66ef5aba0e8af07ed06a0d49',
	},
	no: {
		openOraclePriceCoordinatorFactory: '0xb0a625ba759fc66b063f73bcd2312906940fcfb6c9a146673dadad27b2055399',
		securityPoolFactory: '0xa6004e39d93557fe370d8c9e03e4ef109574716cf1d30366c5af6481a5317989',
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
