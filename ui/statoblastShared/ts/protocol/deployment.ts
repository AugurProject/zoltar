import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { bytesToHex, encodeDeployData, hexToBytes, toHex, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
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
	getEscalationGameFactoryByteCode,
	getInfraStepConstructorArguments,
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolOperationsDelegateRuntimeCode,
	getShareTokenFactoryByteCode,
} from './deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate, statoblast_SecurityPoolUtils_SecurityPoolUtils, statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './deploymentHelpers.js'

export { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0xaab738fe516485dd6597aa145d2ed7fa0e2e5149489df77d2b9b68929217fdb0',
	escalationGameFactory: '0xe1bfc8a94d4aa00074d25e51331944bfd3a7b24c576c736f2c58801901a62e5e',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0xfcca1f411f2050766168246353ded1afbf82c606f2bad490b05fb91e5586bc30',
	priceCoordinatorDeploymentWorker: '0x9fb1769a8606207986959139621d1b81b2e59dc4f701f2fd9045f387452c3931',
	securityPoolFactory: '0xf73e3994e92b80b6714b33614a6c9f439ae298ec1db245b495f346c4ce3b97c0',
	securityPoolForker: '0x334bfd80a4c74727dc778aa081a98c12a46c020e9059115e5ba3402eaaf27db6',
	securityPoolOperationsDelegate: '0x9e25144655b6513b00c0ec4a499cac4f76743c1359bd53f271cdec69163ea0d9',
	securityPoolUtils: '0xe16f02b9482acbfbbe0000d61e30fcf511cf5e3b297c827c41dc628e81d9d5c4',
	shareTokenFactory: '0xd166e808a1860481541ec6f53d80cd284bdc172bfbe286c8b5b65da8978c8c93',
	sharedPoolPriceFeedDeploymentWorker: '0x07ac6b0c397b09cc0870480ee3fc5f756f59c81f359ce47ca039c76c1d3454ad',
	uniformPriceDualCapBatchAuctionFactory: '0xef7782aeeb22a6d00cbd223d4a11cc90c8d54391ea277f41c030405370d8825d',
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

const STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	escalationGameClaimDelegate: `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.deployedBytecode.object}`,
	openOracle: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	securityPoolOperationsDelegate: getSecurityPoolOperationsDelegateRuntimeCode(),
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
	escalationGameClaimDelegate: '0xaab738fe516485dd6597aa145d2ed7fa0e2e5149489df77d2b9b68929217fdb0',
	escalationGameFactory: '0xe1bfc8a94d4aa00074d25e51331944bfd3a7b24c576c736f2c58801901a62e5e',
	openOracle: '0x994db45e5c25cab071f7f8cfecbe28badd177f9015fd8efe58f17dbf18aab408',
	openOraclePriceCoordinatorFactory: '0x3954eeffef226816d45ec4947071ce4222c5f69f530c59a77b2fa308bb678c5a',
	priceCoordinatorDeploymentWorker: '0x9fb1769a8606207986959139621d1b81b2e59dc4f701f2fd9045f387452c3931',
	securityPoolFactory: '0xa3bfb656ddcf461c9d61034218b64970bba427e1a443227f9c964c6aae83760b',
	securityPoolForker: '0x847a95eaac2819fad7ffda5e67e145dbedd3c5df004a27025cb8b7e525748ea8',
	securityPoolOperationsDelegate: '0x9e25144655b6513b00c0ec4a499cac4f76743c1359bd53f271cdec69163ea0d9',
	securityPoolUtils: '0xe16f02b9482acbfbbe0000d61e30fcf511cf5e3b297c827c41dc628e81d9d5c4',
	shareTokenFactory: '0x1bf688e11b6f3558844dcb52898e879f878b2035f6c73b92628460dabd6d6b1e',
	sharedPoolPriceFeedDeploymentWorker: '0x07ac6b0c397b09cc0870480ee3fc5f756f59c81f359ce47ca039c76c1d3454ad',
	uniformPriceDualCapBatchAuctionFactory: '0xef7782aeeb22a6d00cbd223d4a11cc90c8d54391ea277f41c030405370d8825d',
}

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
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
			id: 'securityPoolForker',
			label: 'SecurityPoolForker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'securityPoolUtils', 'zoltar'],
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
			id: 'escalationGameFactory',
			label: 'EscalationGameFactory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer', 'escalationGameClaimDelegate'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate)),
		},
		{
			id: 'securityPoolFactory',
			label: 'SecurityPoolFactory',
			address: addresses.securityPoolFactory,
			dependencies: ['proxyDeployer', 'securityPoolForker', 'securityPoolOperationsDelegate', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'uniformPriceDualCapBatchAuctionFactory', 'openOraclePriceCoordinatorFactory', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses)),
		},
	]
	return withExpectedDeploymentRuntimeCodeHashes(steps, profile).map(step => ({
		...step,
		...(profile.id === 'sepolia' && EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES[step.id] !== undefined ? { expectedRuntimeCodeHash: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES[step.id] } : {}),
		...(profile.id === 'mainnet' && EXPECTED_MAINNET_RUNTIME_CODE_HASHES[step.id] !== undefined ? { expectedRuntimeCodeHash: EXPECTED_MAINNET_RUNTIME_CODE_HASHES[step.id] } : {}),
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
		addresses.openOracle,
		addresses.shareTokenFactory,
		addresses.priceCoordinatorDeploymentWorker,
		addresses.sharedPoolPriceFeedDeploymentWorker,
		addresses.openOraclePriceCoordinatorFactory,
		addresses.securityPoolForker,
		addresses.escalationGameClaimDelegate,
		addresses.escalationGameFactory,
		addresses.securityPoolFactory,
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
