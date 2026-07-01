import { encodeDeployData, getAddress, type Address, type Hash, type Hex } from 'viem'
import { ABIS } from '../abis.js'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/shared/deploymentAddresses'
import { DeploymentStatusOracle_DeploymentStatusOracle, ScalarOutcomes_ScalarOutcomes, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, peripherals_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import {
	MULTICALL3_BYTECODE,
	PROXY_DEPLOYER_ADDRESS,
	ZERO_SALT,
	getEscalationGameFactoryByteCode,
	getInfraContractAddresses,
	getPriceOracleManagerAndOperatorQueuerFactoryByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getShareTokenFactoryByteCode,
	getZoltarInitCode,
	getZoltarQuestionDataByteCode,
} from './deploymentHelpers.js'
import { waitForSubmittedTransactionReceipt } from './core.js'
import type { DeploymentStatusSnapshot, DeploymentStep, ReadClient, WriteClient } from '../types/contracts.js'
import type { TransactionRequestPreview } from '../lib/chainBackend.js'
import { getGenesisReputationTokenAddress } from '../lib/universe.js'

const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const PROXY_DEPLOYER_RUNTIME_CODE = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3' satisfies Hex
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n

function markDeploymentTransactionPrepared(
	client: WriteClient,
	{ account = client.account, data, dataLabel, functionName, requiresWalletConfirmation, to, value }: { account?: TransactionRequestPreview['account']; data?: Hex; dataLabel?: string; functionName: string; requiresWalletConfirmation?: boolean; to?: Address; value?: bigint },
) {
	client.onTransactionPrepared?.({
		account,
		args: undefined,
		chainName: client.chain?.name,
		data,
		dataLabel,
		functionName,
		requiresWalletConfirmation: requiresWalletConfirmation ?? client.requiresWalletConfirmation,
		to,
		value,
	})
}

function getDeploymentStatusOracleStepAddresses() {
	const addresses = getInfraContractAddresses()
	return [
		PROXY_DEPLOYER_ADDRESS,
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
		addresses.escalationGameFactory,
		addresses.securityPoolFactory,
	] satisfies Address[]
}

function getDeploymentStatusOracleByteCode() {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [getDeploymentStatusOracleStepAddresses()],
	})
}

function getDeploymentStatusSnapshot(deployedMask: bigint, deploymentStatusOracleDeployed: boolean): DeploymentStatusSnapshot {
	const steps = getDeploymentSteps()
	let maskIndex = 0n
	const deploymentStatuses = steps.map(step => {
		if (step.id === 'deploymentStatusOracle')
			return {
				...step,
				deployed: deploymentStatusOracleDeployed,
			}

		const deployed = (deployedMask & (1n << maskIndex)) !== 0n
		maskIndex += 1n
		return {
			...step,
			deployed,
		}
	})
	return {
		augurPlaceHolderDeployed: deploymentStatuses.every(step => step.deployed),
		deploymentStatuses,
	}
}

const { getDeploymentStatusOracleAddress } = createDeploymentStatusOracleAddressHelper({
	deploymentStatusOracleBytecode: getDeploymentStatusOracleByteCode,
	proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
	zeroSalt: ZERO_SALT,
})

async function deployViaProxy(client: WriteClient, bytecode: Hex) {
	markDeploymentTransactionPrepared(client, {
		data: bytecode,
		functionName: 'Deploy contract through deterministic proxy',
		to: PROXY_DEPLOYER_ADDRESS,
	})
	const hash = await client.sendTransaction({
		to: PROXY_DEPLOYER_ADDRESS,
		data: bytecode,
	})
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	return resolvedHash
}

async function ensureProxyDeployerDeployed(client: WriteClient) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (code !== undefined && code !== '0x') return undefined
	if (client.installSimulationProxyDeployer !== undefined) {
		await client.installSimulationProxyDeployer({
			address: PROXY_DEPLOYER_ADDRESS,
			runtimeCode: PROXY_DEPLOYER_RUNTIME_CODE,
		})
		return ZERO_HASH
	}

	markDeploymentTransactionPrepared(client, {
		functionName: 'Fund deterministic proxy deployer signer',
		to: PROXY_DEPLOYER_SIGNER,
		value: FUND_PROXY_DEPLOYER_SIGNER_AMOUNT,
	})
	const fundHash = await client.sendTransaction({
		to: PROXY_DEPLOYER_SIGNER,
		value: FUND_PROXY_DEPLOYER_SIGNER_AMOUNT,
	})
	await waitForSubmittedTransactionReceipt(client, fundHash)

	markDeploymentTransactionPrepared(client, {
		account: PROXY_DEPLOYER_SIGNER,
		data: PROXY_DEPLOYER_RAW_TRANSACTION,
		dataLabel: 'Raw transaction',
		functionName: 'Broadcast deterministic proxy deployer transaction',
		requiresWalletConfirmation: false,
	})
	const deployHash = await client.sendRawTransaction({
		serializedTransaction: PROXY_DEPLOYER_RAW_TRANSACTION,
	})
	const { hash: resolvedDeployHash } = await waitForSubmittedTransactionReceipt(client, deployHash)
	return resolvedDeployHash
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

export function getDeploymentSteps(): DeploymentStep[] {
	const addresses = getInfraContractAddresses()

	return [
		{
			id: 'proxyDeployer',
			label: 'Proxy Deployer',
			address: PROXY_DEPLOYER_ADDRESS,
			dependencies: [],
			deploy: async client => {
				const hash = await ensureProxyDeployerDeployed(client)
				return hash ?? ZERO_HASH
			},
		},
		{
			id: 'deploymentStatusOracle',
			label: 'Deployment Status Oracle',
			address: getDeploymentStatusOracleAddress(),
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getDeploymentStatusOracleByteCode()),
		},
		{
			id: 'multicall3',
			label: 'Multicall3',
			address: addresses.multicall3,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, MULTICALL3_BYTECODE),
		},
		{
			id: 'uniformPriceDualCapBatchAuctionFactory',
			label: 'UniformPriceDualCapBatchAuctionFactory',
			address: addresses.uniformPriceDualCapBatchAuctionFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`),
		},
		{
			id: 'scalarOutcomes',
			label: 'ScalarOutcomes',
			address: addresses.scalarOutcomes,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`),
		},
		{
			id: 'securityPoolUtils',
			label: 'SecurityPoolUtils',
			address: addresses.securityPoolUtils,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`),
		},
		{
			id: 'openOracle',
			label: 'OpenOracle',
			address: addresses.openOracle,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`),
		},
		{
			id: 'zoltarQuestionData',
			label: 'ZoltarQuestionData',
			address: addresses.zoltarQuestionData,
			dependencies: ['proxyDeployer', 'scalarOutcomes'],
			deploy: async client => await deployViaProxy(client, getZoltarQuestionDataByteCode()),
		},
		{
			id: 'zoltar',
			label: 'Zoltar',
			address: addresses.zoltar,
			dependencies: ['proxyDeployer', 'zoltarQuestionData'],
			deploy: async client => {
				const hash = await deployViaProxy(client, getZoltarInitCode(addresses.zoltarQuestionData))
				await client.patchSimulationGenesisRepToken?.({
					repAddress: getGenesisReputationTokenAddress(),
					zoltarAddress: addresses.zoltar,
				})
				return hash
			},
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
			label: 'Price Oracle Manager Factory',
			address: addresses.priceOracleManagerAndOperatorQueuerFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getPriceOracleManagerAndOperatorQueuerFactoryByteCode()),
		},
		{
			id: 'securityPoolForker',
			label: 'Security Pool Forker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'scalarOutcomes', 'securityPoolUtils', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameFactory',
			label: 'Escalation Game Factory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode()),
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
}

export async function loadDeploymentStatusOracleSnapshot(client: Pick<ReadClient, 'readContract' | 'getCode'>): Promise<DeploymentStatusSnapshot> {
	const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
	const deploymentStatusOracleCode = await client.getCode({ address: deploymentStatusOracleAddress })
	if (deploymentStatusOracleCode === undefined || deploymentStatusOracleCode === '0x') {
		const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
		const proxyDeployerDeployed = proxyDeployerCode !== undefined && proxyDeployerCode !== '0x'
		return getDeploymentStatusSnapshot(proxyDeployerDeployed ? 1n : 0n, false)
	}

	const deployedMask = await loadDeploymentStatusOracleMask(client)
	return getDeploymentStatusSnapshot(deployedMask, true)
}

export async function loadErc20Balance(client: ReadClient, tokenAddress: Address, ownerAddress: Address) {
	return await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: tokenAddress,
		args: [ownerAddress],
	})
}

export async function loadErc20Allowance(client: ReadClient, tokenAddress: Address, ownerAddress: Address, spenderAddress: Address) {
	return await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'allowance',
		address: tokenAddress,
		args: [ownerAddress, spenderAddress],
	})
}
