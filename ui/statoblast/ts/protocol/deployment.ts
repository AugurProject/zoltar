import type { NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { bytesToHex, hexToBytes, toHex, type Hash, type Hex } from '@zoltar/shared/ethereum'
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { assertDeploymentStepRuntimeCode, assertStaticDeploymentArtifactRuntimeCodeHashes, buildDeploymentStatusSnapshot, deployViaProxy, getDeploymentSteps as getZoltarDeploymentSteps, withExpectedDeploymentRuntimeCodeHashes } from '@zoltar/ui-zoltar/protocol/deployment.js'
import {
	getInfraContractAddresses,
	getEscalationGameFactoryByteCode,
	getPriceOracleManagerAndOperatorQueuerFactoryByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolOperationsDelegateRuntimeCode,
	getShareTokenFactoryByteCode,
} from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate, statoblast_SecurityPoolUtils_SecurityPoolUtils, statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, statoblast_openOracle_OpenOracle_OpenOracle } from '@zoltar/ui-core-shared/contractArtifact.js'

export { loadErc20Allowance, loadErc20Balance } from '@zoltar/ui-zoltar/protocol/deployment.js'

export const EXPECTED_SEPOLIA_STATOBLAST_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x08ab4e84d9d88edd1d398d2554b85e1f1b969bb6a815370cc8dbae60a93d4360',
	escalationGameFactory: '0x60d360f5056e6a9249e02ad271e870eadd8718253b383b4a70b13a1e246ad1b1',
	openOracle: '0x665aa24c6bb92eb4df9ddcd4823e7aa93c680f74acbcb2e1134207fbba8def77',
	priceOracleManagerAndOperatorQueuerFactory: '0x2de4bd043580a6edbdad42c0ecc3232e04e3593a96f4ec68914779be122b4bea',
	securityPoolFactory: '0x207234b371e13a35da6b3e58de69ac54a8be4243cc9815d43ed1f19c7ca29412',
	securityPoolOperationsDelegate: '0xa6dec425f9a73b0daec5ff354e77c7f28ae73216655723892d505daa414b3bbf',
	securityPoolForker: '0x2b32d8587441e2a3b97c6c8edad460d45266fd6931a15747c38703da2a234e13',
	securityPoolUtils: '0xc4c6aa66fead03797fa3a068a22bfc8bd6edac0f3997d4a320829e5875e737a5',
	shareTokenFactory: '0xd5ef1057a34d9141c447916b242e319ed7d1fc4628c127d102c3f0d83dc91137',
	uniformPriceDualCapBatchAuctionFactory: '0x0868fb01acef05b7d25f08fd5168057c8c088858ad63469e2782f61e144f3a6e',
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
	assertStaticDeploymentArtifactRuntimeCodeHashes(parameters)
}

const EXPECTED_MAINNET_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	escalationGameClaimDelegate: '0x08ab4e84d9d88edd1d398d2554b85e1f1b969bb6a815370cc8dbae60a93d4360',
	escalationGameFactory: '0x60d360f5056e6a9249e02ad271e870eadd8718253b383b4a70b13a1e246ad1b1',
	openOracle: '0x665aa24c6bb92eb4df9ddcd4823e7aa93c680f74acbcb2e1134207fbba8def77',
	priceOracleManagerAndOperatorQueuerFactory: '0xd89ead2f646fc2d25c2b4d63f3b242c013fcad7081dccf0c28465789d498478c',
	securityPoolFactory: '0xd10672df1d2945ac5b069d6122d4f125d98e7a76585ae021cee17a05fe6f3fcd',
	securityPoolOperationsDelegate: '0xa6dec425f9a73b0daec5ff354e77c7f28ae73216655723892d505daa414b3bbf',
	securityPoolForker: '0x235027fab2d6019ed6dc27e67dcbe3792cdf85ac7ed8ce4c0b8151c9c9ff7814',
	securityPoolUtils: '0xc4c6aa66fead03797fa3a068a22bfc8bd6edac0f3997d4a320829e5875e737a5',
	shareTokenFactory: '0xf8e699b9d88d6b6332568a3a9bc3975a834cb52ba08bff26da289812deff41cd',
	uniformPriceDualCapBatchAuctionFactory: '0x0868fb01acef05b7d25f08fd5168057c8c088858ad63469e2782f61e144f3a6e',
}

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
	const steps: DeploymentStep[] = [
		...getZoltarDeploymentSteps(profile, wait),
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
			label: 'Security Pool Operations Delegate',
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
			dependencies: ['proxyDeployer', 'securityPoolForker', 'securityPoolOperationsDelegate', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'uniformPriceDualCapBatchAuctionFactory', 'priceOracleManagerAndOperatorQueuerFactory', 'securityPoolUtils'],
			deploy: async client =>
				await deployViaProxy(
					client,
					getSecurityPoolFactoryByteCode({
						escalationGameFactory: addresses.escalationGameFactory,
						openOracle: addresses.openOracle,
						priceOracleManagerAndOperatorQueuerFactory: addresses.priceOracleManagerAndOperatorQueuerFactory,
						securityPoolForker: addresses.securityPoolForker,
						securityPoolOperationsDelegate: addresses.securityPoolOperationsDelegate,
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

export async function loadDeploymentStatusSnapshot(client: Pick<ReadClient, 'getCode'>): Promise<DeploymentStatusSnapshot> {
	const profile = getRuntimeNetworkProfile()
	const steps = getDeploymentSteps(profile)
	const deployedSteps = await Promise.all(steps.map(async step => assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address }))))
	return buildDeploymentStatusSnapshot(steps, deployedSteps)
}
