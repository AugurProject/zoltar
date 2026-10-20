import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
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
	statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
} from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x173356fedb7f28b10ef64501c8272c3eb533ed2919b6a0296438bc170f7aab1d',
	escalationGameDepositDelegate: '0x0d328f35cd12f956b2e0d4b3ab1f7212d6f96c8c86d39051f94272ef6d15e8aa',
	escalationGameFactory: '0x99b17f0508c643dab307c1463e5f7324aa6ac367aee1a1d6aab30672a2ec8fd7',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0xf23addc350431c21c34f414f35adad501d9e08da37b76f32fb463f6664312856',
	priceCoordinatorDeploymentWorker: '0xc3ce6643bd2576f5e249a7f168ffb65c8a284f5a1c0e0b2974ffd4c5a296e59e',
	securityPoolEventEmitter: '0xdd3fe17ffbac4c9beecfc14a770cfd515a6357da28c66ee25a71c170d10ce935',
	securityPoolFactory: '0xc16839d205b5b2e10a75b1561cce90ace73360ae963bc25fb3cfd2c523d0738e',
	securityPoolForker: '0xc72f6f30fef2b0fa70cea18d30c1526937e69918dcef4722cc2f292947d0d3e8',
	securityPoolOperationsDelegate: '0x6faf83b14b4ebb5cf3563621f168998ca892e406db144528fbfc8e721aa3d4e0',
	securityPoolUtils: '0xe16f02b9482acbfbbe0000d61e30fcf511cf5e3b297c827c41dc628e81d9d5c4',
	shareTokenFactory: '0xa96cb58c3537a88bf869002ed5a95614ac5e216f1e96646740113a3e71fff4fd',
	sharedPoolPriceFeedDeploymentWorker: '0xf7d8f8e390c0e0ceb54ee7cfb8143b8e6a4397999a23083938cdf7846b5ec13a',
	uniformPriceDualCapBatchAuctionFactory: '0xef7782aeeb22a6d00cbd223d4a11cc90c8d54391ea277f41c030405370d8825d',
}

const EXPECTED_NO_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0x661d982ede41fe631d091202f8c2ce9aa14ff641079d2daef41c170b1af48d97',
	securityPoolForker: '0xabf2a0090d9bb9e98056ba959ba8f93675fb0636c867628813ecc4638f7a4f19',
	shareTokenFactory: '0x5209c3dd964b220b768c1bd909265132a44bca902ed5fbf35e62c3e635115939',
}

function getSecurityPoolUtilsRuntimeCode() {
	const artifactRuntimeCode = `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.deployedBytecode.object}` satisfies Hex
	const immutableAddressStart = 7
	const immutableAddressEnd = immutableAddressStart + 32
	const runtimeBytes = hexToBytes(artifactRuntimeCode)
	if (runtimeBytes.slice(immutableAddressStart, immutableAddressEnd).some(byte => byte !== 0)) throw new Error('SecurityPoolUtils artifact no longer has the expected library-address immutable')
	const paddedAddress = hexToBytes(toHex(hexToBytes(getInfraContractAddresses(SEPOLIA_NETWORK_PROFILE).securityPoolUtils), { size: 32 }))
	runtimeBytes.set(paddedAddress, immutableAddressStart)
	return bytesToHex(runtimeBytes)
}

function runtimeWithAddresses(artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } }, addresses: readonly Address[]) {
	const groups = Object.values(artifact.evm.deployedBytecode.immutableReferences)
	if (groups.length !== addresses.length) throw new Error('Unexpected deployment immutable layout')
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
function moduleRuntimeCode(module: (typeof portfolioModuleDeployments)[number], profile: NetworkProfile) {
	const addresses = getInfraContractAddresses(profile)
	if (module.id === 'securityPoolCapitalLedgerDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n })])
	if (module.id === 'securityPoolPortfolioForkCoordinatorDeployer') return runtimeWithAddresses(module.artifact, [getCreateAddress({ from: addresses[module.id], nonce: 1n }), getCreateAddress({ from: addresses[module.id], nonce: 2n }), addresses.securityPoolPortfolioRecapAuctionDeployer])
	return runtimeWithAddresses(module.artifact, [])
}

const STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	escalationGameClaimDelegate: `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.deployedBytecode.object}`,
	escalationGameDepositDelegate: `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.deployedBytecode.object}`,
	openOracle: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	securityPoolOperationsDelegate: getSecurityPoolOperationsDelegateRuntimeCode(),
	securityPoolEventEmitter: getSecurityPoolEventEmitterRuntimeCode(),
	securityPoolUtils: getSecurityPoolUtilsRuntimeCode(),
	uniformPriceDualCapBatchAuctionFactory: `0x${statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.deployedBytecode.object}`,
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
	escalationGameClaimDelegate: '0x173356fedb7f28b10ef64501c8272c3eb533ed2919b6a0296438bc170f7aab1d',
	escalationGameDepositDelegate: '0x0d328f35cd12f956b2e0d4b3ab1f7212d6f96c8c86d39051f94272ef6d15e8aa',
	escalationGameFactory: '0x99b17f0508c643dab307c1463e5f7324aa6ac367aee1a1d6aab30672a2ec8fd7',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0x0cc500222901b61b2987a296cae57832e0a76cb94b38669297b63ff3b0b3c0b0',
	priceCoordinatorDeploymentWorker: '0xc3ce6643bd2576f5e249a7f168ffb65c8a284f5a1c0e0b2974ffd4c5a296e59e',
	securityPoolEventEmitter: '0xdd3fe17ffbac4c9beecfc14a770cfd515a6357da28c66ee25a71c170d10ce935',
	securityPoolFactory: '0xfc0c618699bd063e6a5e847a8207211acb586054fe0896d98b29e121a2eab08a',
	securityPoolForker: '0x621055715b1503b289aea1b54b044a6361c9c2079c8a760c5ed9827d3e9a986d',
	securityPoolOperationsDelegate: '0x6faf83b14b4ebb5cf3563621f168998ca892e406db144528fbfc8e721aa3d4e0',
	securityPoolUtils: '0xe16f02b9482acbfbbe0000d61e30fcf511cf5e3b297c827c41dc628e81d9d5c4',
	shareTokenFactory: '0xa2f0d3cde12d00ec01421e63eeab7fe9fca382374ae03efe71bdbf7f116dc25a',
	sharedPoolPriceFeedDeploymentWorker: '0xf7d8f8e390c0e0ceb54ee7cfb8143b8e6a4397999a23083938cdf7846b5ec13a',
	uniformPriceDualCapBatchAuctionFactory: '0xef7782aeeb22a6d00cbd223d4a11cc90c8d54391ea277f41c030405370d8825d',
}

const EXPECTED_NO_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_RUNTIME_CODE_HASHES,
	securityPoolFactory: '0xafef1df08f6c6f0b4c6d11d567c07bbbc792b313b3babe374a29cdf438d400cd',
	securityPoolForker: '0x1254d214117089e910af310c71b30e794a254d04703d97908128365f7b62781d',
	shareTokenFactory: '0xfce7e0ba7f58a1982dc1ee3c5a60b3d599fedcbb786ea8416bfc2b80d222ff65',
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
			id: 'uniformPriceDualCapBatchAuctionFactory',
			label: 'UniformPriceDualCapBatchAuctionFactory',
			address: addresses.uniformPriceDualCapBatchAuctionFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`),
		},
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
			dependencies: ['proxyDeployer', 'securityPoolForker', 'securityPoolOperationsDelegate', 'securityPoolEventEmitter', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'uniformPriceDualCapBatchAuctionFactory', 'openOraclePriceCoordinatorFactory', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses)),
		},
		...portfolioModuleDeployments.map(
			module =>
				({
					id: module.id,
					label: module.label,
					address: addresses[module.id],
					dependencies: module.id === 'securityPoolPortfolioForkCoordinatorDeployer' ? ['proxyDeployer', 'securityPoolPortfolioRecapAuctionDeployer'] : ['proxyDeployer'],
					deploy: async (client: WriteClient) => await deployViaProxy(client, module.bytecode()),
					expectedRuntimeCodeHash: keccak256(moduleRuntimeCode(module, profile)),
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
		addresses.uniformPriceDualCapBatchAuctionFactory,
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
	const proxyStep = steps.find(step => step.id === 'proxyDeployer')
	if (oracleStep === undefined || proxyStep === undefined) throw new Error('Deployment plan is missing required verification steps')
	if (!assertDeploymentStepRuntimeCode(oracleStep, oracleCode)) {
		const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
		const proxyDeployerDeployed = assertDeploymentStepRuntimeCode(proxyStep, proxyDeployerCode)
		return buildDeploymentStatusSnapshot(steps, proxyDeployerDeployed ? 1n : 0n, false)
	}
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
