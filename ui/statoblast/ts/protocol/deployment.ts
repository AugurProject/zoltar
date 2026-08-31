import type { NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { bytesToHex, encodeDeployData, hexToBytes, keccak256, toHex, type Address, type Hash, type Hex } from '@zoltar/shared/ethereum'
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import {
	assertStaticDeploymentArtifactRuntimeCodeHashes,
	buildDeploymentStatusSnapshot,
	deployViaProxy,
	getDeploymentSteps as getZoltarDeploymentSteps,
	getZoltarDeploymentStatusOracleStepAddresses,
	loadDeploymentStatusOracleMaskAtAddress,
	withExpectedDeploymentRuntimeCodeHashes,
} from '@zoltar/ui-zoltar/protocol/deployment.js'
import { getInfraContractAddresses, getEscalationGameFactoryByteCode, getPriceOracleManagerAndOperatorQueuerFactoryByteCode, getSecurityPoolFactoryByteCode, getSecurityPoolForkerByteCode, getShareTokenFactoryByteCode } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	statoblast_SecurityPoolUtils_SecurityPoolUtils,
	statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
} from '@zoltar/ui-core-shared/contractArtifact.js'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/shared/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'

export { loadErc20Allowance, loadErc20Balance } from '@zoltar/ui-zoltar/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x08ab4e84d9d88edd1d398d2554b85e1f1b969bb6a815370cc8dbae60a93d4360',
	escalationGameFactory: '0x60d360f5056e6a9249e02ad271e870eadd8718253b383b4a70b13a1e246ad1b1',
	openOracle: '0x665aa24c6bb92eb4df9ddcd4823e7aa93c680f74acbcb2e1134207fbba8def77',
	priceOracleManagerAndOperatorQueuerFactory: '0x801e1a4cd4917c68fe649abd0f15423b6c2aa229e63886f528db500f7fb91015',
	securityPoolFactory: '0xd42553d7828bc260cc080e6459cf1767b8fee6afbefaf44a41b13276fd2c195f',
	securityPoolForker: '0x4b91605ac365e0e3783c6555d33cfd65481f91c4cb38dd5622cce3548a49b18b',
	securityPoolUtils: '0xb3ae710a9fafc6349441b36336634b1bfca30ad89516d4fd087463bbe37d1b5b',
	shareTokenFactory: '0xfcf1abdf1e5ced1f74f24c58c22cc745806007c4bae0a9586a42dd327feec73a',
	uniformPriceDualCapBatchAuctionFactory: '0xcec6c159400edfe35a548cf68cdebcf3a9b873bf1a97c7323b9bac02d0ba80fe',
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

export const STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	escalationGameClaimDelegate: `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.deployedBytecode.object}`,
	openOracle: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	securityPoolUtils: getSecurityPoolUtilsRuntimeCode(),
	uniformPriceDualCapBatchAuctionFactory: `0x${statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.deployedBytecode.object}`,
} satisfies Readonly<Partial<Record<DeploymentStepId, Hex>>>

export function assertStaticStatoblastDeploymentArtifactRuntimeCodeHashes(
	parameters: Parameters<typeof assertStaticDeploymentArtifactRuntimeCodeHashes>[0] = {
		expectedRuntimeCodeHashes: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES,
		runtimeCodeByStepId: STATIC_STATOBLAST_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID,
	},
) {
	assertStaticDeploymentArtifactRuntimeCodeHashes(parameters)
}

const EXPECTED_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x08ab4e84d9d88edd1d398d2554b85e1f1b969bb6a815370cc8dbae60a93d4360',
	escalationGameFactory: '0x60d360f5056e6a9249e02ad271e870eadd8718253b383b4a70b13a1e246ad1b1',
	openOracle: '0x665aa24c6bb92eb4df9ddcd4823e7aa93c680f74acbcb2e1134207fbba8def77',
	priceOracleManagerAndOperatorQueuerFactory: '0xfef520f4f2f638fc41c78823c64a8194fa5758017117f2a2436fa4697aef68dd',
	securityPoolFactory: '0x7798330e933d44f5172e61e20ba73c3c950d183b5358ad1fcb95d5af2d62d701',
	securityPoolForker: '0x0c36169a21ba67733bde308d4976bab811bbf09504fb27aebfd03f659eff110d',
	securityPoolUtils: '0xb3ae710a9fafc6349441b36336634b1bfca30ad89516d4fd087463bbe37d1b5b',
	shareTokenFactory: '0xb4921aa294a97e2236c5597e0f5391aa45574d0a664ce2b5037a60fd5c367409',
	uniformPriceDualCapBatchAuctionFactory: '0xcec6c159400edfe35a548cf68cdebcf3a9b873bf1a97c7323b9bac02d0ba80fe',
}

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
	const steps: DeploymentStep[] = [
		// Statoblast replaces the deployment status oracle step: the statoblast oracle
		// must monitor the nine additional statoblast contracts, so it is deployed with
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
			id: 'priceOracleManagerAndOperatorQueuerFactory',
			label: 'OpenOracle Price Coordinator Factory',
			address: addresses.priceOracleManagerAndOperatorQueuerFactory,
			dependencies: [...(profile.id === 'sepolia' ? (['weth'] as const) : []), 'proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getPriceOracleManagerAndOperatorQueuerFactoryByteCode(profile.wethAddress)),
		},
		{
			id: 'securityPoolForker',
			label: 'Security Pool Forker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'scalarOutcomes', 'securityPoolUtils', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameClaimDelegate',
			label: 'Escalation Claim Checkpoint Delegate',
			address: addresses.escalationGameClaimDelegate,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.bytecode.object}`),
		},
		{
			id: 'escalationGameFactory',
			label: 'Escalation Game Factory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer', 'escalationGameClaimDelegate'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate)),
		},
		{
			id: 'securityPoolFactory',
			label: 'Security Pool Factory',
			address: addresses.securityPoolFactory,
			dependencies: ['proxyDeployer', 'securityPoolForker', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'uniformPriceDualCapBatchAuctionFactory', 'priceOracleManagerAndOperatorQueuerFactory', 'securityPoolUtils'],
			deploy: async client =>
				await deployViaProxy(
					client,
					getSecurityPoolFactoryByteCode({
						escalationGameFactory: addresses.escalationGameFactory,
						openOracle: addresses.openOracle,
						priceOracleManagerAndOperatorQueuerFactory: addresses.priceOracleManagerAndOperatorQueuerFactory,
						securityPoolForker: addresses.securityPoolForker,
						shareTokenFactory: addresses.shareTokenFactory,
						uniformPriceDualCapBatchAuctionFactory: addresses.uniformPriceDualCapBatchAuctionFactory,
						zoltar: addresses.zoltar,
						zoltarQuestionData: addresses.zoltarQuestionData,
					}),
				),
		},
	]
	return withExpectedDeploymentRuntimeCodeHashes(steps, profile).map(step => ({
		...step,
		...(profile.id === 'sepolia' && EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES[step.id] !== undefined ? { expectedRuntimeCodeHash: EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES[step.id] } : {}),
		...(profile.id === 'mainnet' && EXPECTED_MAINNET_RUNTIME_CODE_HASHES[step.id] !== undefined ? { expectedRuntimeCodeHash: EXPECTED_MAINNET_RUNTIME_CODE_HASHES[step.id] } : {}),
	}))
}

export function getStatoblastDeploymentStatusOracleStepAddresses(profile = getRuntimeNetworkProfile()): Address[] {
	const addresses = getInfraContractAddresses(profile)
	return [
		...getZoltarDeploymentStatusOracleStepAddresses(profile),
		addresses.uniformPriceDualCapBatchAuctionFactory,
		addresses.securityPoolUtils,
		addresses.openOracle,
		addresses.shareTokenFactory,
		addresses.priceOracleManagerAndOperatorQueuerFactory,
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

function assertStepRuntimeCode(step: DeploymentStep, code: Hex | undefined): boolean {
	if (step.trustedSimulationCodePresence) return true
	if (code === undefined || code === '0x') return false
	if (step.expectedRuntimeCodeHash === undefined) throw new Error(`Exact runtime-code verification is unavailable for deployment step ${step.id} on the active network`)
	if (keccak256(code) !== step.expectedRuntimeCodeHash) throw new Error(`Unexpected runtime code for ${step.id} at ${step.address}`)
	return true
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
	if (!assertStepRuntimeCode(oracleStep, oracleCode)) {
		const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
		const proxyDeployerDeployed = assertStepRuntimeCode(proxyStep, proxyDeployerCode)
		return buildDeploymentStatusSnapshot(steps, proxyDeployerDeployed ? 1n : 0n, false)
	}
	const snapshot = buildDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMaskAtAddress(client, oracleAddress), true)
	await Promise.all(
		snapshot.deploymentStatuses.map(async step => {
			if (!step.deployed) return
			assertStepRuntimeCode(step, await client.getCode({ address: step.address }))
		}),
	)
	return snapshot
}
