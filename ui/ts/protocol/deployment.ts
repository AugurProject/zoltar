import { encodeDeployData, getAddress, keccak256, type Address, type Hash, type Hex } from '@zoltar/shared/ethereum'
import { ABIS } from '../abis.js'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/shared/deploymentAddresses'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	ScalarOutcomes_ScalarOutcomes,
	peripherals_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	peripherals_SecurityPoolUtils_SecurityPoolUtils,
	peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
} from '../contractArtifact.js'
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
import { getRuntimeNetworkProfile, type NetworkProfile } from '../lib/networkProfile.js'
import { SEPOLIA_GENESIS_REP_INIT_CODE, SEPOLIA_WETH_INIT_CODE } from '../lib/sepoliaDeploymentConfig.js'

const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const PROXY_DEPLOYER_RAW_TRANSACTION_HASH = keccak256(PROXY_DEPLOYER_RAW_TRANSACTION)
export const PROXY_DEPLOYER_RUNTIME_CODE = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3' satisfies Hex
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n

export async function getProxyDeployerFundingShortfall(client: Pick<ReadClient, 'getBalance'>) {
	const balance = await client.getBalance({ address: PROXY_DEPLOYER_SIGNER })
	return balance >= FUND_PROXY_DEPLOYER_SIGNER_AMOUNT ? 0n : FUND_PROXY_DEPLOYER_SIGNER_AMOUNT - balance
}

export async function getProxyDeployerActivity(client: Pick<ReadClient, 'getBalance' | 'getTransactionCount'>) {
	const [confirmedBalance, pendingBalance, confirmedNonce, pendingNonce] = await Promise.all([
		client.getBalance({ address: PROXY_DEPLOYER_SIGNER, blockTag: 'latest' }),
		client.getBalance({ address: PROXY_DEPLOYER_SIGNER, blockTag: 'pending' }),
		client.getTransactionCount({ address: PROXY_DEPLOYER_SIGNER, blockTag: 'latest' }),
		client.getTransactionCount({ address: PROXY_DEPLOYER_SIGNER, blockTag: 'pending' }),
	])
	return {
		confirmedNonce,
		deploymentPending: pendingNonce !== confirmedNonce,
		fundingPending: pendingBalance !== confirmedBalance,
		pending: pendingBalance !== confirmedBalance || pendingNonce !== confirmedNonce,
	}
}

async function proxyDeployerIsInstalled(client: Pick<ReadClient, 'getCode'>) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (code === undefined || code === '0x') return false
	if (code.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(`Unexpected code at canonical proxy deployer ${PROXY_DEPLOYER_ADDRESS}`)
	return true
}

async function waitForCanonicalProxyDeployer(client: WriteClient) {
	const { hash } = await waitForSubmittedTransactionReceipt(client, PROXY_DEPLOYER_RAW_TRANSACTION_HASH)
	if (!(await proxyDeployerIsInstalled(client))) throw new Error(`Canonical proxy deployer transaction ${hash} confirmed without installing code at ${PROXY_DEPLOYER_ADDRESS}`)
	return hash
}

async function resolveProxyDeployerBroadcastRace(client: WriteClient, broadcastError: unknown) {
	if (await proxyDeployerIsInstalled(client)) return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
	const activity = await getProxyDeployerActivity(client)
	if (activity.deploymentPending) return await waitForCanonicalProxyDeployer(client)
	if (activity.confirmedNonce !== 0n) {
		if (await proxyDeployerIsInstalled(client)) return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
		throw new Error('The deterministic proxy deployer signer nonce was consumed without installing the canonical proxy', { cause: broadcastError })
	}
	throw broadcastError
}

function markDeploymentTransactionPrepared(
	client: WriteClient,
	{ account = client.account, data, dataLabel, functionName, requiresWalletConfirmation, to, toLabel, value }: { account?: TransactionRequestPreview['account']; data?: Hex; dataLabel?: string; functionName: string; requiresWalletConfirmation?: boolean; to?: Address; toLabel?: string; value?: bigint },
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
		toLabel,
		value,
	})
}

function getDeploymentStatusOracleStepAddresses(profile = getRuntimeNetworkProfile()) {
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

function getDeploymentStatusOracleByteCode(profile = getRuntimeNetworkProfile()) {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [getDeploymentStatusOracleStepAddresses(profile)],
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
		augurStatoblastDeployed: deploymentStatuses.every(step => step.deployed),
		deploymentStatuses,
	}
}

function getDeploymentStatusOracleAddress(profile = getRuntimeNetworkProfile()) {
	return createDeploymentStatusOracleAddressHelper({
		deploymentStatusOracleBytecode: () => getDeploymentStatusOracleByteCode(profile),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		zeroSalt: ZERO_SALT,
	}).getDeploymentStatusOracleAddress()
}

async function deployViaProxy(client: WriteClient, bytecode: Hex) {
	markDeploymentTransactionPrepared(client, {
		data: bytecode,
		functionName: 'Deploy contract through deterministic proxy',
		to: PROXY_DEPLOYER_ADDRESS,
		toLabel: 'Proxy deployer',
	})
	const hash = await client.sendTransaction({
		to: PROXY_DEPLOYER_ADDRESS,
		data: bytecode,
	})
	const { hash: resolvedHash } = await waitForSubmittedTransactionReceipt(client, hash)
	return resolvedHash
}

async function ensureProxyDeployerDeployed(client: WriteClient) {
	if (await proxyDeployerIsInstalled(client)) return undefined
	if (client.installSimulationProxyDeployer !== undefined) {
		await client.installSimulationProxyDeployer({
			address: PROXY_DEPLOYER_ADDRESS,
			runtimeCode: PROXY_DEPLOYER_RUNTIME_CODE,
		})
		return ZERO_HASH
	}
	const activity = await getProxyDeployerActivity(client)
	if (activity.deploymentPending) return await waitForCanonicalProxyDeployer(client)
	if (activity.fundingPending) {
		throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	}
	if (await proxyDeployerIsInstalled(client)) return undefined
	if (activity.confirmedNonce !== 0n) throw new Error('The deterministic proxy deployer signer nonce has already been consumed, but the canonical proxy is missing')

	const fundingShortfall = await getProxyDeployerFundingShortfall(client)
	if (fundingShortfall > 0n) {
		const finalActivity = await getProxyDeployerActivity(client)
		if (finalActivity.pending) {
			throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
		}
		if (await proxyDeployerIsInstalled(client)) return undefined
		const confirmedNonce = await client.getTransactionCount({ address: PROXY_DEPLOYER_SIGNER, blockTag: 'latest' })
		if (confirmedNonce !== 0n) throw new Error('The deterministic proxy deployer signer nonce has already been consumed, but the canonical proxy is missing')
		const finalFundingShortfall = await getProxyDeployerFundingShortfall(client)
		if (finalFundingShortfall > 0n) {
			markDeploymentTransactionPrepared(client, {
				functionName: 'Fund deterministic proxy deployer signer',
				to: PROXY_DEPLOYER_SIGNER,
				toLabel: 'Proxy deployer signer',
				value: finalFundingShortfall,
			})
			const fundHash = await client.sendTransaction({
				to: PROXY_DEPLOYER_SIGNER,
				value: finalFundingShortfall,
			})
			await waitForSubmittedTransactionReceipt(client, fundHash)
		}
	}
	if (await proxyDeployerIsInstalled(client)) return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
	const postFundingActivity = await getProxyDeployerActivity(client)
	if (postFundingActivity.deploymentPending) return await waitForCanonicalProxyDeployer(client)
	if (postFundingActivity.fundingPending) throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (postFundingActivity.confirmedNonce !== 0n) throw new Error('The deterministic proxy deployer signer nonce has already been consumed, but the canonical proxy is missing')

	markDeploymentTransactionPrepared(client, {
		account: PROXY_DEPLOYER_SIGNER,
		data: PROXY_DEPLOYER_RAW_TRANSACTION,
		dataLabel: 'Raw transaction',
		functionName: 'Broadcast deterministic proxy deployer transaction',
		requiresWalletConfirmation: false,
	})
	let deployHash: Hash
	try {
		deployHash = await client.sendRawTransaction({
			serializedTransaction: PROXY_DEPLOYER_RAW_TRANSACTION,
		})
	} catch (error) {
		return await resolveProxyDeployerBroadcastRace(client, error)
	}
	const { hash: resolvedDeployHash } = await waitForSubmittedTransactionReceipt(client, deployHash)
	if (!(await proxyDeployerIsInstalled(client))) throw new Error(`Canonical proxy deployer transaction ${resolvedDeployHash} confirmed without installing code at ${PROXY_DEPLOYER_ADDRESS}`)
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

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile()): DeploymentStep[] {
	const addresses = getInfraContractAddresses(profile)
	const testTokenSteps =
		profile.id === 'sepolia'
			? ([
					{
						id: 'weth',
						label: 'Wrapped Ether',
						address: profile.wethAddress,
						dependencies: ['proxyDeployer'],
						deploy: async client => await deployViaProxy(client, SEPOLIA_WETH_INIT_CODE),
					},
					{
						id: 'reputationToken',
						label: 'Genesis Reputation Token',
						address: profile.genesisRepTokenAddress,
						dependencies: ['proxyDeployer'],
						deploy: async client => await deployViaProxy(client, SEPOLIA_GENESIS_REP_INIT_CODE),
					},
				] satisfies DeploymentStep[])
			: []

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
			address: getDeploymentStatusOracleAddress(profile),
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getDeploymentStatusOracleByteCode(profile)),
		},
		...testTokenSteps,
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
			dependencies: [...(profile.id === 'sepolia' ? (['reputationToken'] as const) : []), 'proxyDeployer', 'zoltarQuestionData'],
			deploy: async client => {
				const hash = await deployViaProxy(client, getZoltarInitCode(addresses.zoltarQuestionData, profile.genesisRepTokenAddress))
				await client.patchSimulationGenesisRepToken?.({
					repAddress: profile.genesisRepTokenAddress,
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

export async function loadErc20Balance(client: ReadClient, tokenAddress: Address, ownerAddress: Address): Promise<bigint> {
	const balance = await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: tokenAddress,
		args: [ownerAddress],
	})
	return typeof balance === 'bigint' ? balance : BigInt(balance)
}

export async function loadErc20Allowance(client: ReadClient, tokenAddress: Address, ownerAddress: Address, spenderAddress: Address): Promise<bigint> {
	const allowance = await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'allowance',
		address: tokenAddress,
		args: [ownerAddress, spenderAddress],
	})
	return typeof allowance === 'bigint' ? allowance : BigInt(allowance)
}
