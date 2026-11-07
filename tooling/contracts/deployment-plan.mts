import { type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
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
			tradingFactory: '0x5b41b542e8a3eb8e7aafeb1da92e608f976b4dca952a5417c98425676fb8ec61',
			tradingRouter: '0x74b8aea295bcafd424eeec7c89c49796d8069310ff0f9e478db725c252bb6786',
		},
		no: {
			tradingFactory: '0x5010586f4fa8eaefda7e82c9c93ff72bd7dd9b2068c6cdf633de0ff3bf1d348e',
			tradingRouter: '0x6122512b50eceb2fdf3738bc0b111ac1b5fbaef0f6ff4930a000c50f7cd2f687',
		},
	},
	deterministic: {
		yes: {
			tradingFactory: '0x0173ac20f88898639cfb3ac977a1b6337957df1744ebd5a525f810b6ae38d5cf',
			tradingRouter: '0x206066eabd4fb7107472a9529a1fd9db14b2ffc535766044591edffed302998d',
		},
		no: {
			tradingFactory: '0x9c71bccf2b9da475090a847c75a2d476c772dc5a068c9eacd9f2889623a35542',
			tradingRouter: '0x795fc36bea28298c87206cecd665eb2011e62badfee6a5780a7d0100d8d4e9e8',
		},
	},
	mainnet: {
		yes: {
			tradingFactory: '0x3e5a0c460a2caaa92b76b08634e0bb17a642d7de9b21ce5df3510d8ee8ad798c',
			tradingRouter: '0x02901a810cd82d91750b0b2a7a24005b549ba78e719690cfdb5174241c6abdfc',
		},
		no: {
			tradingFactory: '0xd6de98abb2db600a6bd8af69cd455841fa2c850b217fd4df1f9392616cdc954b',
			tradingRouter: '0x7f46cc98bcc2a45216c6bf9a4e02c07869d5835ab1c2d1abba79dec6dd936127',
		},
	},
}

// WETH-dependent immutables differ on chains with deterministic WETH9.
const DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES: Readonly<Record<GenesisOutcome, Readonly<Record<string, Hash>>>> = {
	yes: {
		openOraclePriceCoordinatorFactory: '0x356bcfeb7beb7f12be242de4f9c2f0d851026bbd96ab9e5fe5d63d1f913f5da5',
		securityPoolFactory: '0xbd4aebd81e424420a9343e2ff21119b1b07702592d6188bd44ac9dfbcc8617bd',
	},
	no: {
		openOraclePriceCoordinatorFactory: '0x356bcfeb7beb7f12be242de4f9c2f0d851026bbd96ab9e5fe5d63d1f913f5da5',
		securityPoolFactory: '0x3af6e7a5e1d3792e5a5d0f42eba68aeefd54896bfe4936f2e36cd062bbcf0f7c',
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
		const outcome = profile.genesisOutcome
		const networkHashProfile = profile.id === 'mainnet' ? 'mainnet' : 'sepolia'
		const hashProfile = uniswap.kind === 'deterministic' ? 'deterministic' : networkHashProfile
		const tradingHash = EXPECTED_TRADING_RUNTIME_CODE_HASHES[hashProfile][outcome][step.id]
		if (tradingHash !== undefined) return { ...step, expectedRuntimeCodeHash: tradingHash }
		const deterministicHash = uniswap.kind === 'deterministic' ? DETERMINISTIC_WETH_DEPENDENT_RUNTIME_CODE_HASHES[outcome][step.id] : undefined
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
