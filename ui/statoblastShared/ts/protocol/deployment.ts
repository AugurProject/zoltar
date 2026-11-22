import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { bytesToHex, encodeDeployData, getCreateAddress, hexToBytes, keccak256, toHex, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import {
	assertDeploymentStepRuntimeCode,
	assertStaticDeploymentArtifactRuntimeCodeHashes,
	buildDeploymentStatusSnapshot,
	deployViaProxy,
	getDeploymentSteps as getZoltarDeploymentSteps,
	getZoltarDeploymentStatusOracleStepAddresses,
	getZoltarDeploymentStepConstructorArguments,
	loadDeploymentStatusOracleMaskAtAddress,
	loadDeploymentStatusSnapshotFromCode,
	withExpectedDeploymentRuntimeCodeHashes,
} from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import {
	getInfraContractAddresses,
	applyStatoblastLibraries,
	getEscalationGameFactoryByteCode,
	getInfraStepConstructorArguments,
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolForkerPortfolioDelegateByteCode,
	portfolioModuleDeployments,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolOperationsDelegateRuntimeCode,
	getSecurityPoolEventEmitterByteCode,
	getSecurityPoolEventEmitterRuntimeCode,
	getShareTokenFactoryByteCode,
} from './deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import {
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_SecurityPoolUtils_SecurityPoolUtils,
	statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate as nativePortfolioForkArtifact,
	statoblast_openOracle_OpenOracle_OpenOracle,
} from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x3b0db37eba61cd5a5108d39c52766b7932e279c4740801ceb4b50b1c1f936c05',
	escalationGameDepositDelegate: '0x742d36f04e15d871eb347c94ed08321adfc262a10ebcae34ba4aa280cb6f84c3',
	escalationGameFactory: '0xfba99e5a7f83ed4d1a7d9a3dbbae53c776e85558b59e6361e501f4681fca7259',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0xf677d56b45c874206fc46d0902af62aa0d031b0d837353ee8dfce3377ef3fadd',
	priceCoordinatorDeploymentWorker: '0x098071f12c722141ed4ae18b7cfdc94c0b912ac4706cce8c129873809c8abe99',
	securityPoolEventEmitter: '0xd6334e44947bed787f35654d650504061ec1f632f1bf6f7e7370b0e108609e73',
	securityPoolFactory: '0xf0e0250bdc598f1674aee5a7956e55d9ecdaacadfa78ab54407bd01da69482ca',
	securityPoolForker: '0xc9a3d08eafdb3287bde16783495107739f74ec61cee42d0558c502a49d11959e',
	securityPoolOperationsDelegate: '0xf36906d0baf47720831d3de59569a335c42978ab78ed3c3c5d534b76f2da157a',
	securityPoolUtils: '0xec490f322a84001a84be8855592c50e6edf239cd67a4a1210d8792ab1fef6ff5',
	shareTokenFactory: '0xb4e59e0a622ddd77664750e3273128809f9f9744ccaa882963b8316f9fce2a1a',
	sharedPoolPriceFeedDeploymentWorker: '0x914f25b1b3d11e8ef8117b0b880d655b9c055bfb5c79f2c9f9e6170bc8839294',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x4bc0604a623a2911f96e049a2a6a9a368f0813963b1cd3ed0ace8e6149ed0238',
	securityPoolForker: '0x133643f88a41e79c0a51c9a88a33ca4acb84879a0b51ab92e0b6b5bce9040282',
	shareTokenFactory: '0xb1467ad71de639e786528fe27938faa8293202cdf1dc1bd904f000c73b9da0d7',
}

function runtimeWithAddresses(artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }, addresses: readonly Address[]) {
	const groups = Object.values(artifact.evm.deployedBytecode.immutableReferences)
	if (groups.length !== addresses.length) throw new Error(`Unexpected deployment immutable layout: ${groups.length.toString()} immutables, ${addresses.length.toString()} addresses, runtime ${artifact.evm.deployedBytecode.object.length.toString()} characters`)
	const code = hexToBytes(applyStatoblastLibraries(artifact.evm.deployedBytecode.object))
	for (const [index, group] of groups.entries()) {
		const address = addresses[index]
		if (address === undefined) throw new Error('Missing deployment immutable')
		const padded = hexToBytes(toHex(hexToBytes(address), { size: 32 }))
		for (const reference of group) {
			if (reference.length !== 32 || code.slice(reference.start, reference.start + reference.length).some(byte => byte !== 0)) throw new Error('Unexpected deployment immutable bytes')
			code.set(padded, reference.start)
		}
	}
	return bytesToHex(code)
}
function moduleRuntimeCode(module: (typeof portfolioModuleDeployments)[number], addresses: ReturnType<typeof getInfraContractAddresses>) {
	if (module.id === 'securityPoolCommitmentIndexDeployer' || module.id === 'securityPoolCapitalFeeStreamsDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n })])
	if (module.id === 'securityPoolCapitalLedgerDeployer' || module.id === 'securityPoolPortfolioServicesDeployer' || module.id === 'securityPoolSettlementBookDeployer')
		return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	if (module.id === 'securityPoolPortfolioForkCoordinatorDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	// The auction deployer also publishes the shared vault implementation after its two creation-code chunks.
	if (module.id === 'securityPoolPortfolioAuctionDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n }), getCreateAddress({ from: addresses[module.id], nonce: 3n })])
	return runtimeWithAddresses(module.artifact, [])
}

const STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	escalationGameClaimDelegate: `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.deployedBytecode.object}`,
	escalationGameDepositDelegate: `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.deployedBytecode.object}`,
	openOracle: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	securityPoolOperationsDelegate: getSecurityPoolOperationsDelegateRuntimeCode(),
	securityPoolEventEmitter: getSecurityPoolEventEmitterRuntimeCode(),
	securityPoolUtils: `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.deployedBytecode.object}`,
} satisfies Readonly<Partial<Record<DeploymentStepId, Hex>>>

export function assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes(
	parameters: Parameters<typeof assertStaticDeploymentArtifactRuntimeCodeHashes>[0] = {
		expectedRuntimeCodeHashes: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
		runtimeCodeByStepId: STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID,
	},
) {
	return assertStaticDeploymentArtifactRuntimeCodeHashes(parameters)
}

const EXPECTED_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x3b0db37eba61cd5a5108d39c52766b7932e279c4740801ceb4b50b1c1f936c05',
	escalationGameDepositDelegate: '0x742d36f04e15d871eb347c94ed08321adfc262a10ebcae34ba4aa280cb6f84c3',
	escalationGameFactory: '0xfba99e5a7f83ed4d1a7d9a3dbbae53c776e85558b59e6361e501f4681fca7259',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0x74c584fe8c06d443578d4ff446eb8edc4ada7dd7addd8f0327b97a30553a5617',
	priceCoordinatorDeploymentWorker: '0x098071f12c722141ed4ae18b7cfdc94c0b912ac4706cce8c129873809c8abe99',
	securityPoolEventEmitter: '0xd6334e44947bed787f35654d650504061ec1f632f1bf6f7e7370b0e108609e73',
	securityPoolFactory: '0x9572ba9a3aff95800e59ee199e7e36648430d20057524714729f4ef016ca8d02',
	securityPoolForker: '0x2d1f528aaaef475117061be7acc10e2bb9e1e6524c47abed973d2beb115e3f0a',
	securityPoolOperationsDelegate: '0xf36906d0baf47720831d3de59569a335c42978ab78ed3c3c5d534b76f2da157a',
	securityPoolUtils: '0xec490f322a84001a84be8855592c50e6edf239cd67a4a1210d8792ab1fef6ff5',
	shareTokenFactory: '0xc5990d66cb44508fae0e32847d4e2281caec62ca54e073ba160f2a4f03589593',
	sharedPoolPriceFeedDeploymentWorker: '0x914f25b1b3d11e8ef8117b0b880d655b9c055bfb5c79f2c9f9e6170bc8839294',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x6baa4abd6ffa7ea99f8b851473fe90bbbd0103e6619ad596550d57e9a0aeb57f',
	securityPoolForker: '0x11e7c893af7dea8da798ea9d2de1a23fd200edd277164cef3106faddf1de19cb',
	shareTokenFactory: '0x669c4fba6ff67c823e64d3de80c6661fac64222e50213a5aaef947a592b0ae44',
}
const EXPECTED_PUBLIC_RUNTIME_CODE_HASHES = {
	mainnet: { yes: EXPECTED_MAINNET_RUNTIME_CODE_HASHES, no: EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES },
	sepolia: { yes: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES, no: EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES },
}

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
	const expectedRuntimeCodeHashes = profile.id === 'simulation' ? undefined : EXPECTED_PUBLIC_RUNTIME_CODE_HASHES[profile.id][profile.genesisOutcome]
	const steps: DeploymentStep[] = [
		// Statoblast replaces the deployment status oracle step: the statoblast oracle
		// must monitor additional Statoblast contracts, so it is deployed with
		// a different constructor argument list (and therefore a different address).
		...getZoltarDeploymentSteps(profile, wait).map(step =>
			step.id === 'deploymentStatusOracle'
				? {
						...step,
						address: getDeploymentStatusOracleAddress(profile),
						deploy: async (client: WriteClient) => await deployViaProxy(client, getDeploymentStatusOracleByteCode(profile)),
					}
				: step,
		),
		{
			id: 'securityPoolUtils',
			label: 'SecurityPoolUtils',
			address: addresses.securityPoolUtils,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`),
		},
		{
			id: 'securityPoolOperationsDelegate',
			label: 'SecurityPoolOperationsDelegate',
			address: addresses.securityPoolOperationsDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolOperationsDelegateByteCode()),
		},
		{
			id: 'securityPoolEventEmitter',
			label: 'SecurityPoolEventEmitter',
			address: addresses.securityPoolEventEmitter,
			dependencies: ['proxyDeployer', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolEventEmitterByteCode()),
		},
		{
			id: 'openOracle',
			label: 'OpenOracle',
			address: addresses.openOracle,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`),
		},
		{
			id: 'shareTokenFactory',
			label: 'ShareTokenFactory',
			address: addresses.shareTokenFactory,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getShareTokenFactoryByteCode(addresses.zoltar)),
		},
		{
			id: 'priceCoordinatorDeploymentWorker',
			label: 'PriceCoordinatorDeploymentWorker',
			address: addresses.priceCoordinatorDeploymentWorker,
			dependencies: ['proxyDeployer', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getPriceCoordinatorDeploymentWorkerByteCode()),
		},
		{
			id: 'sharedPoolPriceFeedDeploymentWorker',
			label: 'SharedPoolPriceFeedDeploymentWorker',
			address: addresses.sharedPoolPriceFeedDeploymentWorker,
			dependencies: ['proxyDeployer', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSharedPoolPriceFeedDeploymentWorkerByteCode()),
		},
		{
			id: 'openOraclePriceCoordinatorFactory',
			label: 'OpenOraclePriceCoordinatorFactory',
			address: addresses.openOraclePriceCoordinatorFactory,
			dependencies: ['proxyDeployer', 'priceCoordinatorDeploymentWorker', 'sharedPoolPriceFeedDeploymentWorker'],
			deploy: async client => await deployViaProxy(client, getOpenOraclePriceCoordinatorFactoryByteCode(profile.wethAddress)),
		},
		{
			id: 'securityPoolForkerPortfolioDelegate',
			label: 'SecurityPoolForkerPortfolioDelegate',
			address: addresses.securityPoolForkerPortfolioDelegate,
			dependencies: ['proxyDeployer', 'securityPoolUtils', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerPortfolioDelegateByteCode(addresses.zoltar)),
			expectedRuntimeCodeHash: keccak256(runtimeWithAddresses(nativePortfolioForkArtifact, [addresses.zoltar])),
		},
		{
			id: 'securityPoolForker',
			label: 'SecurityPoolForker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'securityPoolUtils', 'zoltar', 'securityPoolForkerPortfolioDelegate'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameClaimDelegate',
			label: 'EscalationGameClaimDelegate',
			address: addresses.escalationGameClaimDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.bytecode.object}`),
		},
		{
			id: 'escalationGameDepositDelegate',
			label: 'EscalationGameDepositDelegate',
			address: addresses.escalationGameDepositDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.bytecode.object}`),
		},
		{
			id: 'escalationGameFactory',
			label: 'EscalationGameFactory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer', 'escalationGameClaimDelegate', 'escalationGameDepositDelegate'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate, addresses.escalationGameDepositDelegate)),
		},
		{
			id: 'securityPoolFactory',
			label: 'SecurityPoolFactory',
			address: addresses.securityPoolFactory,
			dependencies: ['proxyDeployer', 'securityPoolForker', 'securityPoolOperationsDelegate', 'securityPoolEventEmitter', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'openOraclePriceCoordinatorFactory', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses)),
		},
		...portfolioModuleDeployments.map(
			module =>
				({
					id: module.id,
					label: module.label,
					address: addresses[module.id],
					dependencies: ['proxyDeployer'],
					deploy: async (client: WriteClient) => await deployViaProxy(client, module.bytecode()),
					expectedRuntimeCodeHash: keccak256(moduleRuntimeCode(module, addresses)),
				}) satisfies DeploymentStep,
		),
	]
	return withExpectedDeploymentRuntimeCodeHashes(steps, profile).map(step => ({
		...step,
		...(expectedRuntimeCodeHashes?.[step.id] === undefined ? {} : { expectedRuntimeCodeHash: expectedRuntimeCodeHashes[step.id] }),
	}))
}

/**
 * Constructor arguments for every proxy-deployed step in the statoblast
 * deployment plan, keyed by step id. The statoblast deployment status oracle
 * monitors additional contracts, so its arguments replace the zoltar entry.
 * Consumed through a dynamic import by the deployment manifest generator
 * (tooling/contracts/check-mainnet-deployment.mts), which Knip cannot trace.
 * @public
 */
export function getDeploymentStepConstructorArguments(profile: NetworkProfile = getRuntimeNetworkProfile()): Partial<Record<DeploymentStepId, string>> {
	return {
		...getZoltarDeploymentStepConstructorArguments(profile),
		...getInfraStepConstructorArguments(profile),
		deploymentStatusOracle: constructorArgumentsFromInitCode(getDeploymentStatusOracleByteCode(profile), DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object),
	}
}

function getStatoblastDeploymentStatusOracleStepAddresses(profile = getRuntimeNetworkProfile()): Address[] {
	const addresses = getInfraContractAddresses(profile)
	return [
		...getZoltarDeploymentStatusOracleStepAddresses(profile),
		addresses.securityPoolUtils,
		addresses.securityPoolOperationsDelegate,
		addresses.securityPoolEventEmitter,
		addresses.openOracle,
		addresses.shareTokenFactory,
		addresses.priceCoordinatorDeploymentWorker,
		addresses.sharedPoolPriceFeedDeploymentWorker,
		addresses.openOraclePriceCoordinatorFactory,
		addresses.securityPoolForkerPortfolioDelegate,
		addresses.securityPoolForker,
		addresses.escalationGameClaimDelegate,
		addresses.escalationGameDepositDelegate,
		addresses.escalationGameFactory,
		addresses.securityPoolFactory,
		...portfolioModuleDeployments.map(module => addresses[module.id]),
	] satisfies Address[]
}

function getDeploymentStatusOracleByteCode(profile = getRuntimeNetworkProfile()): Hex {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [getStatoblastDeploymentStatusOracleStepAddresses(profile)],
	})
}

function getDeploymentStatusOracleAddress(profile = getRuntimeNetworkProfile()): Address {
	return createDeploymentStatusOracleAddressHelper({
		deploymentStatusOracleBytecode: () => getDeploymentStatusOracleByteCode(profile),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		zeroSalt: ZERO_SALT,
	}).getDeploymentStatusOracleAddress()
}

export async function loadDeploymentStatusOracleSnapshot(client: Pick<ReadClient, 'readContract' | 'getCode'>): Promise<DeploymentStatusSnapshot> {
	const profile = getRuntimeNetworkProfile()
	const steps = getDeploymentSteps(profile)
	const oracleAddress = getDeploymentStatusOracleAddress(profile)
	const oracleCode = await client.getCode({ address: oracleAddress })
	if (profile.id === 'simulation') {
		if (oracleCode === undefined || oracleCode === '0x') {
			const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
			return buildDeploymentStatusSnapshot(steps, proxyDeployerCode === undefined || proxyDeployerCode === '0x' ? 0n : 1n, false)
		}
		return buildDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMaskAtAddress(client, oracleAddress), true)
	}
	const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
	if (oracleStep === undefined) throw new Error('Deployment plan is missing its deployment status oracle step')
	if (!assertDeploymentStepRuntimeCode(oracleStep, oracleCode)) return await loadDeploymentStatusSnapshotFromCode(client, steps)
	const snapshot = buildDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMaskAtAddress(client, oracleAddress), true)
	// The oracle mask only says a step was recorded; a step whose address holds no code is reported as not deployed.
	const deploymentStatuses = await Promise.all(
		snapshot.deploymentStatuses.map(async step => {
			if (!step.deployed || step.id === 'deploymentStatusOracle') return step
			return assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address })) ? step : { ...step, deployed: false }
		}),
	)
	return { applicationDeploymentComplete: deploymentStatuses.every(step => step.deployed), deploymentStatuses }
}
