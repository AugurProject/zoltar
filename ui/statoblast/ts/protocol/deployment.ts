import type { NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { encodeDeployData, keccak256, type Address, type Hash, type Hex } from '@zoltar/shared/ethereum'
import type { DeploymentStatus, DeploymentStatusSnapshot, DeploymentStep, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { getDeploymentSteps as getZoltarDeploymentSteps, withExpectedDeploymentRuntimeCodeHashes } from '@zoltar/ui-zoltar/protocol/deployment.js'
import { getInfraContractAddresses, getEscalationGameFactoryByteCode, getSecurityPoolFactoryByteCode, getSecurityPoolForkerByteCode } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'
import { DeploymentStatusOracle_DeploymentStatusOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import { peripherals_EscalationGameClaimDelegate_EscalationGameClaimDelegate } from '@zoltar/ui-core-shared/contractArtifact.js'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/shared/deploymentAddresses'
import { PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'

export { loadErc20Allowance, loadErc20Balance } from '@zoltar/ui-zoltar/protocol/deployment.js'

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
	const steps: DeploymentStep[] = [
		// Statoblast replaces the deployment status oracle step: the statoblast oracle
		// must monitor the four additional statoblast contracts, so it is deployed with
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
			deploy: async client => await deployViaProxy(client, `0x${peripherals_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.bytecode.object}`),
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
	return withExpectedDeploymentRuntimeCodeHashes(steps, profile)
}

async function deployViaProxy(client: WriteClient, bytecode: Hex): Promise<Hash> {
	const hash = await client.sendTransaction({
		to: PROXY_DEPLOYER_ADDRESS,
		data: bytecode,
	})
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	return resolvedHash
}

async function waitForSubmittedTransactionReceipt(client: WriteClient, hash: Hash) {
	const { waitForSubmittedTransactionReceipt: waitReceipt } = await import('@zoltar/ui-zoltar/protocol/core.js')
	return await waitReceipt(client, hash)
}

function getDeploymentStatusOracleStepAddresses(profile = getRuntimeNetworkProfile()): Address[] {
	const addresses = getInfraContractAddresses(profile)
	return [
		PROXY_DEPLOYER_ADDRESS,
		...(profile.id === 'sepolia' ? [profile.wethAddress, profile.genesisRepTokenAddress] : []),
		addresses.multicall3,
		addresses.uniformPriceDualCapBatchAuctionFactory,
		addresses.scalarOutcomes,
		addresses.securityPoolUtils,
		addresses.openOracle,
		addresses.zoltarQuestionData,
		addresses.zoltar,
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
		args: [getDeploymentStatusOracleStepAddresses(profile)],
	})
}

function getDeploymentStatusOracleAddress(profile = getRuntimeNetworkProfile()): Address {
	return createDeploymentStatusOracleAddressHelper({
		deploymentStatusOracleBytecode: () => getDeploymentStatusOracleByteCode(profile),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		zeroSalt: ZERO_SALT,
	}).getDeploymentStatusOracleAddress()
}

async function loadDeploymentStatusOracleMask(client: Pick<ReadClient, 'readContract'>): Promise<bigint> {
	return BigInt(
		await client.readContract({
			abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
			functionName: 'getDeploymentMask',
			address: getDeploymentStatusOracleAddress(),
			args: [],
		}),
	)
}

function getDeploymentStatusSnapshot(steps: readonly DeploymentStep[], deployedMask: bigint, deploymentStatusOracleDeployed: boolean): DeploymentStatusSnapshot {
	let maskIndex = 0n
	const deploymentStatuses: DeploymentStatus[] = steps.map(step => {
		if (step.id === 'deploymentStatusOracle') return { ...step, deployed: deploymentStatusOracleDeployed }
		const deployed = (deployedMask & (1n << maskIndex)) !== 0n
		maskIndex += 1n
		return { ...step, deployed }
	})
	return {
		applicationDeploymentComplete: deploymentStatuses.every(step => step.deployed),
		deploymentStatuses,
	}
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
			return getDeploymentStatusSnapshot(steps, proxyDeployerCode === undefined || proxyDeployerCode === '0x' ? 0n : 1n, false)
		}
		return getDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMask(client), true)
	}
	const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
	const proxyStep = steps.find(step => step.id === 'proxyDeployer')
	if (oracleStep === undefined || proxyStep === undefined) throw new Error('Deployment plan is missing required verification steps')
	if (!assertStepRuntimeCode(oracleStep, oracleCode)) {
		const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
		const proxyDeployerDeployed = assertStepRuntimeCode(proxyStep, proxyDeployerCode)
		return getDeploymentStatusSnapshot(steps, proxyDeployerDeployed ? 1n : 0n, false)
	}
	const snapshot = getDeploymentStatusSnapshot(steps, await loadDeploymentStatusOracleMask(client), true)
	await Promise.all(
		snapshot.deploymentStatuses.map(async step => {
			if (!step.deployed) return
			assertStepRuntimeCode(step, await client.getCode({ address: step.address }))
		}),
	)
	return snapshot
}
