import { encodeDeployData, getAddress, keccak256, type Address, type Hash, type Hex } from '@zoltar/shared/ethereum'
import { ABIS } from '../abis.js'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/shared/deploymentAddresses'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	ScalarOutcomes_ScalarOutcomes,
	ZoltarQuestionData_ZoltarQuestionData,
	peripherals_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	peripherals_Multicall3_Multicall3,
	peripherals_SecurityPoolUtils_SecurityPoolUtils,
	peripherals_WETH9_WETH9,
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
import { readWithRpcStateRetries, waitForSubmittedTransactionReceipt, type RpcStateRetryWait } from './core.js'
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient, WriteClient } from '../types/contracts.js'
import type { TransactionRequestPreview } from '../lib/chainBackend.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '../lib/networkProfile.js'
import { SEPOLIA_GENESIS_REP_INIT_CODE, SEPOLIA_WETH_INIT_CODE } from '../lib/sepoliaDeploymentConfig.js'

const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const PROXY_DEPLOYER_RAW_TRANSACTION_HASH = keccak256(PROXY_DEPLOYER_RAW_TRANSACTION)
export const PROXY_DEPLOYER_RUNTIME_CODE = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3' satisfies Hex
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n
const TRUSTED_SIMULATION_CODE_PRESENCE: true = true
export const CANONICAL_DEPLOYER_RAW_GAS_PRICE = 100_000_000_000n
export const CANONICAL_DEPLOYER_RAW_TRANSACTION_COST = 10_000_000_000_000_000n
export const EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Record<DeploymentStepId, Hash>> = {
	deploymentStatusOracle: '0xa8385e5704060e4e97fdaba0f7bf6ef692162bacc83533ebd616b455d2b190e1',
	escalationGameClaimDelegate: '0x08ab4e84d9d88edd1d398d2554b85e1f1b969bb6a815370cc8dbae60a93d4360',
	escalationGameFactory: '0xc0ca7781654627254c618bed4b774e388e548f9f66bc82381030247830ef6633',
	multicall3: '0x1ff11a2c64e95bb3d4e330d0235adbe3c3f78eeecb5c5104ac38c89673dfaade',
	openOracle: '0x665aa24c6bb92eb4df9ddcd4823e7aa93c680f74acbcb2e1134207fbba8def77',
	priceOracleManagerAndOperatorQueuerFactory: '0x7f751a604c4a52704d9b94b27da6a75aeeaf79688b616f5b7d7d273989e31e22',
	proxyDeployer: '0x5acaad953250bec20933f7c72a25bb03bfa54767ebd3a750396276512c46a79c',
	reputationToken: '0xffc50c2e60f6b94512c41eb736669e9ce8ec546340cb85b3959c00c0efbde9e3',
	scalarOutcomes: '0x3c55237b3869f93f3e570793afec9785f20a4ee7cd0a7798a418838c833228e0',
	securityPoolFactory: '0x0d6f01c469c96aa4aa2fd65fb67a95f7b9186eeea16806ad880a418147b9676a',
	securityPoolForker: '0x4ac2a066fee9195891ad612d6a82bf8aa3c7c74f48025e45df89b16feb66e8ab',
	securityPoolUtils: '0x0e221ef10688680eaa2d5511fa46bd2824ab03551e161403662a22590f9d4c39',
	shareTokenFactory: '0xfcf1abdf1e5ced1f74f24c58c22cc745806007c4bae0a9586a42dd327feec73a',
	uniformPriceDualCapBatchAuctionFactory: '0xafd9aad01b9a12e4026cf7c1c9bfcd6b371de7a8bf9c2a942bd63b11d2860111',
	weth: '0x664399615dc3e489416583855e1125048c92043bc544f20dc1de8f1a78106b20',
	zoltar: '0xab10fc74b97acd4e7a97007283f9f341ddfa81cf894fdfe5c9caf0bb939946b2',
	zoltarQuestionData: '0xcacb1ffe2a738ceda0aced156f7ff50b405b57d66a6c1307e5d8ff87789a4340',
}

export const STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	deploymentStatusOracle: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.deployedBytecode.object}`,
	escalationGameClaimDelegate: `0x${peripherals_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.deployedBytecode.object}`,
	multicall3: `0x${peripherals_Multicall3_Multicall3.evm.deployedBytecode.object}`,
	openOracle: `0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object}`,
	scalarOutcomes: `0x${ScalarOutcomes_ScalarOutcomes.evm.deployedBytecode.object}`,
	uniformPriceDualCapBatchAuctionFactory: `0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.deployedBytecode.object}`,
	weth: `0x${peripherals_WETH9_WETH9.evm.deployedBytecode.object}`,
	zoltarQuestionData: `0x${ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object}`,
} satisfies Readonly<Partial<Record<DeploymentStepId, Hex>>>

export function assertStaticDeploymentArtifactRuntimeCodeHashes(
	parameters: { expectedRuntimeCodeHashes: Readonly<Record<string, Hash | undefined>>; runtimeCodeByStepId: Readonly<Record<string, Hex>> } = {
		expectedRuntimeCodeHashes: EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
		runtimeCodeByStepId: STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID,
	},
) {
	for (const [id, runtimeCode] of Object.entries(parameters.runtimeCodeByStepId)) {
		const expectedRuntimeCodeHash = parameters.expectedRuntimeCodeHashes[id]
		if (expectedRuntimeCodeHash === undefined) throw new Error(`Static deployment artifact ${id} has no pinned expected runtime code hash`)
		const artifactRuntimeCodeHash = keccak256(runtimeCode)
		if (artifactRuntimeCodeHash !== expectedRuntimeCodeHash) {
			throw new Error(`Local runtime code for ${id} does not match its pinned expected hash: expected ${expectedRuntimeCodeHash}, artifact contains ${artifactRuntimeCodeHash}. Run bun run compile-contracts and refresh the pinned deployment hashes if the bytecode change is intentional.`)
		}
	}
}

const EXPECTED_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	deploymentStatusOracle: '0xa8385e5704060e4e97fdaba0f7bf6ef692162bacc83533ebd616b455d2b190e1',
	escalationGameClaimDelegate: '0x08ab4e84d9d88edd1d398d2554b85e1f1b969bb6a815370cc8dbae60a93d4360',
	escalationGameFactory: '0xc0ca7781654627254c618bed4b774e388e548f9f66bc82381030247830ef6633',
	multicall3: '0x1ff11a2c64e95bb3d4e330d0235adbe3c3f78eeecb5c5104ac38c89673dfaade',
	openOracle: '0x665aa24c6bb92eb4df9ddcd4823e7aa93c680f74acbcb2e1134207fbba8def77',
	priceOracleManagerAndOperatorQueuerFactory: '0x34925a2e7f57b849c531f9e1efb9ce70e2536eb9cf8b94adecf26d643ceadfda',
	proxyDeployer: '0x5acaad953250bec20933f7c72a25bb03bfa54767ebd3a750396276512c46a79c',
	scalarOutcomes: '0x3c55237b3869f93f3e570793afec9785f20a4ee7cd0a7798a418838c833228e0',
	securityPoolFactory: '0xc71a8e1e0c186a914b2c6113d2f804bac6ef2152e8df5c2fb5c91dcd217478f6',
	securityPoolForker: '0x04f5e9da9bb9473e63c1a6d3917d213a4cfc3a45e1854055a9cc4149cc4bfbe6',
	securityPoolUtils: '0x0e221ef10688680eaa2d5511fa46bd2824ab03551e161403662a22590f9d4c39',
	shareTokenFactory: '0xb4921aa294a97e2236c5597e0f5391aa45574d0a664ce2b5037a60fd5c367409',
	uniformPriceDualCapBatchAuctionFactory: '0xafd9aad01b9a12e4026cf7c1c9bfcd6b371de7a8bf9c2a942bd63b11d2860111',
	zoltar: '0xd88ac0e34684f9156068590e63fe1a0da390eb63b4261e456e7e0843cc2090f0',
	zoltarQuestionData: '0xcacb1ffe2a738ceda0aced156f7ff50b405b57d66a6c1307e5d8ff87789a4340',
}
const ATOMIC_FUNDING_CONSTRUCTOR_ABI = [
	{
		inputs: [
			{ name: 'signer', type: 'address' },
			{ name: 'expectedDeployer', type: 'address' },
			{ name: 'requiredBalance', type: 'uint256' },
		],
		stateMutability: 'payable',
		type: 'constructor',
	},
] as const
// Compiled with solc 0.8.17, optimizer runs=200, metadata bytecodeHash=none.
export const ATOMIC_FUNDING_SOURCE = `pragma solidity 0.8.17;
contract AtomicFunding {
    constructor(address payable signer, address expectedDeployer, uint256 requiredBalance) payable {
        if (expectedDeployer.code.length == 0) {
            uint256 balance = signer.balance;
            if (balance < requiredBalance) {
                (bool success,) = signer.call{value: requiredBalance - balance}("");
                require(success, "Funding failed");
            }
        }
        selfdestruct(payable(msg.sender));
    }
}`
export const ATOMIC_FUNDING_BYTECODE =
	'0x608060405260405161016e38038061016e83398101604081905261002291610103565b816001600160a01b03163b6000036100e8576001600160a01b03831631818110156100e65760006001600160a01b03851661005d8385610146565b604051600081818185875af1925050503d8060008114610099576040519150601f19603f3d011682016040523d82523d6000602084013e61009e565b606091505b50509050806100e45760405162461bcd60e51b815260206004820152600e60248201526d119d5b991a5b99c819985a5b195960921b604482015260640160405180910390fd5b505b505b33ff5b6001600160a01b038116811461010057600080fd5b50565b60008060006060848603121561011857600080fd5b8351610123816100eb565b6020850151909350610134816100eb565b80925050604084015190509250925092565b8181038181111561016757634e487b7160e01b600052601160045260246000fd5b9291505056fe' satisfies Hex

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

export async function assertCanonicalRawTransactionFeeCompatible(client: Pick<ReadClient, 'getBlock'>, label: string) {
	const { baseFeePerGas } = await client.getBlock()
	if (baseFeePerGas === undefined) throw new Error(`${label} requires an EIP-1559 base fee before its canonical raw transaction can be funded`)
	if (baseFeePerGas > CANONICAL_DEPLOYER_RAW_GAS_PRICE) {
		throw new Error(`${label} canonical raw transaction gas price is ${CANONICAL_DEPLOYER_RAW_GAS_PRICE.toString()} attoETH per gas, below the current base fee ${baseFeePerGas.toString()} attoETH per gas; no signer funding was sent`)
	}
}

export function isInsufficientFundsError(error: unknown) {
	if (!(error instanceof Error)) return false
	const message = `${error.message} ${'shortMessage' in error && typeof error.shortMessage === 'string' ? error.shortMessage : ''}`.toLowerCase()
	return message.includes('insufficient funds') || message.includes('insufficient balance') || message.includes('funds for gas')
}

export async function fundCanonicalDeployerSigner(client: WriteClient, parameters: { expectedDeployer: Address; label: string; requiredBalance: bigint; signer: Address }) {
	const data = encodeDeployData({
		abi: ATOMIC_FUNDING_CONSTRUCTOR_ABI,
		args: [parameters.signer, parameters.expectedDeployer, parameters.requiredBalance],
		bytecode: ATOMIC_FUNDING_BYTECODE,
	})
	markDeploymentTransactionPrepared(client, {
		data,
		dataLabel: 'Atomic funding constructor',
		functionName: `Fund ${parameters.label} signer without surplus`,
		value: parameters.requiredBalance,
	})
	const hash = await client.sendTransaction({ data, value: parameters.requiredBalance })
	client.recordCanonicalFunding?.(parameters.signer, parameters.requiredBalance)
	return await waitForSubmittedTransactionReceipt(client, hash)
}

function accountCanonicalRawTransaction(client: WriteClient, signer: Address) {
	client.assertCanonicalRawTransactionCost?.(signer, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	client.recordCanonicalRawTransaction?.(signer, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
}

async function proxyDeployerIsInstalledAfterReceipt(client: WriteClient, wait?: RpcStateRetryWait) {
	return await readWithRpcStateRetries(
		() => proxyDeployerIsInstalled(client),
		installed => installed,
		wait,
	)
}

async function resolveConfirmedProxyDeployer(client: WriteClient, wait?: RpcStateRetryWait) {
	if (!(await proxyDeployerIsInstalledAfterReceipt(client, wait))) throw new Error('The deterministic proxy deployer signer nonce has already been consumed, but the canonical proxy is missing')
	accountCanonicalRawTransaction(client, PROXY_DEPLOYER_SIGNER)
	return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
}

async function waitForCanonicalProxyDeployer(client: WriteClient, wait?: RpcStateRetryWait) {
	const { hash } = await waitForSubmittedTransactionReceipt(client, PROXY_DEPLOYER_RAW_TRANSACTION_HASH)
	if (!(await proxyDeployerIsInstalledAfterReceipt(client, wait))) throw new Error(`Canonical proxy deployer transaction ${hash} confirmed without installing code at ${PROXY_DEPLOYER_ADDRESS}`)
	return hash
}

async function resolveProxyDeployerBroadcastRace(client: WriteClient, broadcastError: unknown, wait?: RpcStateRetryWait) {
	if (await proxyDeployerIsInstalled(client)) {
		client.recordCanonicalRawTransaction?.(PROXY_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
		return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
	}
	const activity = await getProxyDeployerActivity(client)
	if (activity.deploymentPending) {
		client.recordCanonicalRawTransaction?.(PROXY_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
		return await waitForCanonicalProxyDeployer(client, wait)
	}
	if (activity.confirmedNonce !== 0n) {
		try {
			return await resolveConfirmedProxyDeployer(client, wait)
		} catch (error) {
			throw new Error('The deterministic proxy deployer signer nonce was consumed without installing the canonical proxy', { cause: error ?? broadcastError })
		}
	}
	throw broadcastError
}

async function broadcastCanonicalProxyDeployer(client: WriteClient, allowInsufficientFunds: boolean, wait?: RpcStateRetryWait) {
	markDeploymentTransactionPrepared(client, {
		account: PROXY_DEPLOYER_SIGNER,
		data: PROXY_DEPLOYER_RAW_TRANSACTION,
		dataLabel: 'Raw transaction',
		functionName: 'Broadcast deterministic proxy deployer transaction',
		requiresWalletConfirmation: false,
	})
	client.assertCanonicalRawTransactionCost?.(PROXY_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	let deployHash: Hash
	try {
		deployHash = await client.sendRawTransaction({
			serializedTransaction: PROXY_DEPLOYER_RAW_TRANSACTION,
		})
	} catch (error) {
		if (allowInsufficientFunds && isInsufficientFundsError(error)) {
			if (await proxyDeployerIsInstalled(client)) {
				client.recordCanonicalRawTransaction?.(PROXY_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
				return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
			}
			return undefined
		}
		try {
			return await resolveProxyDeployerBroadcastRace(client, error, wait)
		} catch (resolvedError) {
			if (allowInsufficientFunds) throw new Error(`RPC rejected the canonical proxy deployer raw transaction before signer funding: ${resolvedError instanceof Error ? resolvedError.message : String(resolvedError)}`, { cause: resolvedError })
			throw resolvedError
		}
	}
	client.recordCanonicalRawTransaction?.(PROXY_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	const { hash: resolvedDeployHash } = await waitForSubmittedTransactionReceipt(client, deployHash)
	if (!(await proxyDeployerIsInstalledAfterReceipt(client, wait))) throw new Error(`Canonical proxy deployer transaction ${resolvedDeployHash} confirmed without installing code at ${PROXY_DEPLOYER_ADDRESS}`)
	return resolvedDeployHash
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

async function ensureProxyDeployerDeployed(client: WriteClient, wait?: RpcStateRetryWait) {
	if (await proxyDeployerIsInstalled(client)) return undefined
	if (client.installSimulationProxyDeployer !== undefined) {
		await client.installSimulationProxyDeployer({
			address: PROXY_DEPLOYER_ADDRESS,
			runtimeCode: PROXY_DEPLOYER_RUNTIME_CODE,
		})
		return ZERO_HASH
	}
	const activity = await getProxyDeployerActivity(client)
	if (activity.deploymentPending) {
		accountCanonicalRawTransaction(client, PROXY_DEPLOYER_SIGNER)
		return await waitForCanonicalProxyDeployer(client, wait)
	}
	if (activity.fundingPending) {
		throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	}
	if (await proxyDeployerIsInstalled(client)) return undefined
	if (activity.confirmedNonce !== 0n) return await resolveConfirmedProxyDeployer(client, wait)
	await assertCanonicalRawTransactionFeeCompatible(client, 'Deterministic proxy deployer')
	const preFundingDeploymentHash = await broadcastCanonicalProxyDeployer(client, true, wait)
	if (preFundingDeploymentHash !== undefined) return preFundingDeploymentHash

	const fundingShortfall = await getProxyDeployerFundingShortfall(client)
	if (fundingShortfall > 0n) {
		const finalActivity = await getProxyDeployerActivity(client)
		if (finalActivity.pending) {
			throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
		}
		if (await proxyDeployerIsInstalled(client)) return undefined
		const confirmedNonce = await client.getTransactionCount({ address: PROXY_DEPLOYER_SIGNER, blockTag: 'latest' })
		if (confirmedNonce !== 0n) return await resolveConfirmedProxyDeployer(client, wait)
		const finalFundingShortfall = await getProxyDeployerFundingShortfall(client)
		if (finalFundingShortfall > 0n) {
			await fundCanonicalDeployerSigner(client, {
				expectedDeployer: PROXY_DEPLOYER_ADDRESS,
				label: 'deterministic proxy deployer',
				requiredBalance: FUND_PROXY_DEPLOYER_SIGNER_AMOUNT,
				signer: PROXY_DEPLOYER_SIGNER,
			})
		}
	}
	if (await proxyDeployerIsInstalled(client)) {
		accountCanonicalRawTransaction(client, PROXY_DEPLOYER_SIGNER)
		return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
	}
	const postFundingActivity = await getProxyDeployerActivity(client)
	if (postFundingActivity.deploymentPending) {
		accountCanonicalRawTransaction(client, PROXY_DEPLOYER_SIGNER)
		return await waitForCanonicalProxyDeployer(client, wait)
	}
	if (postFundingActivity.fundingPending) throw new Error('The deterministic proxy deployer has pending funding or deployment activity. Wait for it to settle, then retry.')
	if (postFundingActivity.confirmedNonce !== 0n) return await resolveConfirmedProxyDeployer(client, wait)

	const resolvedDeployHash = await broadcastCanonicalProxyDeployer(client, false, wait)
	if (resolvedDeployHash === undefined) throw new Error('Canonical proxy deployer broadcast unexpectedly returned without a transaction hash')
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

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: RpcStateRetryWait): DeploymentStep[] {
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

	const steps: DeploymentStep[] = [
		{
			id: 'proxyDeployer',
			label: 'Proxy Deployer',
			address: PROXY_DEPLOYER_ADDRESS,
			dependencies: [],
			deploy: async client => {
				const hash = await ensureProxyDeployerDeployed(client, wait)
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
	return steps.map(step => ({
		...step,
		...(profile.id === 'sepolia' ? { expectedRuntimeCodeHash: EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES[step.id] } : {}),
		...(profile.id === 'mainnet' ? { expectedRuntimeCodeHash: EXPECTED_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES[step.id] } : {}),
		...(profile.id === 'simulation' && step.id === 'proxyDeployer' ? { expectedRuntimeCodeHash: EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES.proxyDeployer } : {}),
		...(profile.id === 'simulation' ? { trustedSimulationCodePresence: TRUSTED_SIMULATION_CODE_PRESENCE } : {}),
	}))
}

export function assertDeploymentStepRuntimeCode(step: Pick<DeploymentStep, 'address' | 'expectedRuntimeCodeHash' | 'id' | 'trustedSimulationCodePresence'>, code: Hex | undefined) {
	if (code === undefined || code === '0x') return false
	if (step.trustedSimulationCodePresence) return true
	if (step.expectedRuntimeCodeHash === undefined) throw new Error(`Exact runtime-code verification is unavailable for deployment step ${step.id} on the active network`)
	const actualRuntimeCodeHash = keccak256(code)
	if (actualRuntimeCodeHash !== step.expectedRuntimeCodeHash) {
		throw new Error(`Unexpected runtime code for ${step.id} at ${step.address}: expected ${step.expectedRuntimeCodeHash}, received ${actualRuntimeCodeHash}`)
	}
	return true
}

export async function loadDeploymentStatusOracleSnapshot(client: Pick<ReadClient, 'readContract' | 'getCode'>): Promise<DeploymentStatusSnapshot> {
	const profile = getRuntimeNetworkProfile()
	if (profile.id === 'simulation') {
		const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
		const deploymentStatusOracleCode = await client.getCode({ address: deploymentStatusOracleAddress })
		if (deploymentStatusOracleCode === undefined || deploymentStatusOracleCode === '0x') {
			const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
			return getDeploymentStatusSnapshot(proxyDeployerCode === undefined || proxyDeployerCode === '0x' ? 0n : 1n, false)
		}
		return getDeploymentStatusSnapshot(await loadDeploymentStatusOracleMask(client), true)
	}

	const steps = getDeploymentSteps(profile)
	const oracleStep = steps.find(step => step.id === 'deploymentStatusOracle')
	const proxyStep = steps.find(step => step.id === 'proxyDeployer')
	if (oracleStep === undefined || proxyStep === undefined) throw new Error('Deployment plan is missing required verification steps')
	const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
	const deploymentStatusOracleCode = await client.getCode({ address: deploymentStatusOracleAddress })
	if (!assertDeploymentStepRuntimeCode(oracleStep, deploymentStatusOracleCode)) {
		const proxyDeployerCode = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
		const proxyDeployerDeployed = assertDeploymentStepRuntimeCode(proxyStep, proxyDeployerCode)
		return getDeploymentStatusSnapshot(proxyDeployerDeployed ? 1n : 0n, false)
	}

	const deployedMask = await loadDeploymentStatusOracleMask(client)
	const snapshot = getDeploymentStatusSnapshot(deployedMask, true)
	await Promise.all(
		snapshot.deploymentStatuses.map(async step => {
			if (!step.deployed) return
			assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address }))
		}),
	)
	return snapshot
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
