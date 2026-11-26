import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { encodeDeployData, getAddress, keccak256, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { constructorArgumentsFromInitCode, createDeploymentStatusOracleAddressHelper, PROXY_DEPLOYER_RUNTIME_CODE, zoltarDeploymentStatusStepAddresses } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { DeploymentStatusOracle_DeploymentStatusOracle, GenesisReputationToken_GenesisReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import { MULTICALL3_BYTECODE, PROXY_DEPLOYER_ADDRESS, ZERO_SALT, getZoltarContractAddresses, getZoltarInitCode, getZoltarQuestionDataByteCode } from './zoltarDeploymentHelpers.js'
import { readWithRpcStateRetries, type RpcStateRetryWait } from '@zoltar/ui-core-shared/lib/rpcStateRetries.js'
import { waitForSubmittedTransactionReceipt } from './core.js'
import type { DeploymentStatusSnapshot, DeploymentStep, DeploymentStepId, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { TransactionRequestPreview } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getSepoliaGenesisRepDeployment } from '@zoltar/ui-core-shared/lib/sepoliaDeploymentConfig.js'
import { formatUnexpectedProxyDeployerCode, proxyDeployerSendWithoutHash } from '../copy/deployment.js'

const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const PROXY_DEPLOYER_RAW_TRANSACTION_HASH = keccak256(PROXY_DEPLOYER_RAW_TRANSACTION)
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' satisfies Hash
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n
const TRUSTED_SIMULATION_CODE_PRESENCE: true = true
export const CANONICAL_DEPLOYER_RAW_GAS_PRICE = 100_000_000_000n
export const CANONICAL_DEPLOYER_RAW_TRANSACTION_COST = 10_000_000_000_000_000n
export const EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	deploymentStatusOracle: '0x4d74b03ec334c428ccae8674f7caed0288a1d43b3dcf6614a60a78abd21e41cc',
	multicall3: '0x1ff11a2c64e95bb3d4e330d0235adbe3c3f78eeecb5c5104ac38c89673dfaade',
	proxyDeployer: '0x5acaad953250bec20933f7c72a25bb03bfa54767ebd3a750396276512c46a79c',
	reputationToken: '0x1939fc9070edce2ad78392d5145b884e58d307171bc2e24a95927db370002b86',
	zoltar: '0x595517e727ed0fe0208e9392506cc150090bc0837859b2e93d8bed32c67ee0cb',
	zoltarQuestionData: '0x2ec8ddb6c595a4a52d9c2d6f03282c3508877165e2e3b3250ad3a57ec747105d',
}

const EXPECTED_NO_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
	zoltar: '0x375210b4efc587fb91585f1a6e3545f39ca20139846621ec4797227a7e3ea066',
}

const STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID = {
	deploymentStatusOracle: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.deployedBytecode.object}`,
	multicall3: `0x${statoblast_Multicall3_Multicall3.evm.deployedBytecode.object}`,
	zoltarQuestionData: `0x${ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object}`,
} satisfies Readonly<Partial<Record<DeploymentStepId, Hex>>>

export function assertStaticDeploymentArtifactRuntimeCodeHashes(
	parameters: { expectedRuntimeCodeHashes: Readonly<Record<string, Hash | undefined>>; runtimeCodeByStepId: Readonly<Record<string, Hex>> } = {
		expectedRuntimeCodeHashes: EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES,
		runtimeCodeByStepId: STATIC_DEPLOYMENT_ARTIFACT_RUNTIME_CODE_BY_STEP_ID,
	},
) {
	const verifiedStepIds: string[] = []
	for (const [id, runtimeCode] of Object.entries(parameters.runtimeCodeByStepId)) {
		const expectedRuntimeCodeHash = parameters.expectedRuntimeCodeHashes[id]
		if (expectedRuntimeCodeHash === undefined) throw new Error(`Static deployment artifact ${id} has no expected contract code hash`)
		const artifactRuntimeCodeHash = keccak256(runtimeCode)
		verifiedStepIds.push(id)
		if (artifactRuntimeCodeHash !== expectedRuntimeCodeHash) {
			throw new Error(`Local contract code for ${id} does not match its pinned expected hash: expected ${expectedRuntimeCodeHash}, artifact contains ${artifactRuntimeCodeHash}. Run bun run compile-contracts and refresh the pinned deployment hashes if the bytecode change is intentional.`)
		}
	}
	return verifiedStepIds.sort()
}

const EXPECTED_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	deploymentStatusOracle: '0x4d74b03ec334c428ccae8674f7caed0288a1d43b3dcf6614a60a78abd21e41cc',
	multicall3: '0x1ff11a2c64e95bb3d4e330d0235adbe3c3f78eeecb5c5104ac38c89673dfaade',
	proxyDeployer: '0x5acaad953250bec20933f7c72a25bb03bfa54767ebd3a750396276512c46a79c',
	zoltar: '0x98389b38b200e0a91197008f4a805411effa008662b52fde52f0ed96319bedfc',
	zoltarQuestionData: '0x2ec8ddb6c595a4a52d9c2d6f03282c3508877165e2e3b3250ad3a57ec747105d',
}

const EXPECTED_NO_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES: Readonly<Partial<Record<DeploymentStepId, Hash>>> = {
	...EXPECTED_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES,
	zoltar: '0x42fb518c8f2b7fd2c52b28187d858cbd5da73ec0bc474d9d4f298b3b5995dd80',
}
const EXPECTED_PUBLIC_DEPLOYMENT_RUNTIME_CODE_HASHES = {
	mainnet: { yes: EXPECTED_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES, no: EXPECTED_NO_MAINNET_DEPLOYMENT_RUNTIME_CODE_HASHES },
	sepolia: { yes: EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES, no: EXPECTED_NO_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES },
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
const ATOMIC_FUNDING_BYTECODE =
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
	if (code.toLowerCase() !== PROXY_DEPLOYER_RUNTIME_CODE.toLowerCase()) throw new Error(formatUnexpectedProxyDeployerCode(PROXY_DEPLOYER_ADDRESS))
	return true
}

const PROXY_DEPLOYER_TRANSACTION_USED_ERROR = 'The shared proxy cannot be deployed on this network: its one-time deployment transaction was already used, but the contract is missing.'

export async function assertCanonicalRawTransactionFeeCompatible(client: Pick<ReadClient, 'getBlock'>, label: string) {
	const { baseFeePerGas } = await client.getBlock()
	if (baseFeePerGas === undefined) throw new Error(`${label} cannot be deployed because this network does not report a base fee.`)
	if (baseFeePerGas > CANONICAL_DEPLOYER_RAW_GAS_PRICE) {
		throw new Error(`${label} cannot be deployed right now: its fixed gas price of ${formatCurrencyBalance(CANONICAL_DEPLOYER_RAW_GAS_PRICE, 9)} nanoETH per gas is below the current base fee of ${formatCurrencyBalance(baseFeePerGas, 9)} nanoETH per gas. No ETH was sent.`)
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
	if (!(await proxyDeployerIsInstalledAfterReceipt(client, wait))) throw new Error(PROXY_DEPLOYER_TRANSACTION_USED_ERROR)
	accountCanonicalRawTransaction(client, PROXY_DEPLOYER_SIGNER)
	return PROXY_DEPLOYER_RAW_TRANSACTION_HASH
}

async function waitForCanonicalProxyDeployer(client: WriteClient, wait?: RpcStateRetryWait) {
	const { hash } = await waitForSubmittedTransactionReceipt(client, PROXY_DEPLOYER_RAW_TRANSACTION_HASH)
	if (!(await proxyDeployerIsInstalledAfterReceipt(client, wait))) throw new Error(`Shared proxy deployment transaction ${hash} confirmed, but no contract code was found at ${PROXY_DEPLOYER_ADDRESS}.`)
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
			throw new Error(PROXY_DEPLOYER_TRANSACTION_USED_ERROR, { cause: error ?? broadcastError })
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
			if (allowInsufficientFunds) throw new Error(`The network rejected the shared proxy deployment before it was funded: ${resolvedError instanceof Error ? resolvedError.message : String(resolvedError)}`, { cause: resolvedError })
			throw resolvedError
		}
	}
	client.recordCanonicalRawTransaction?.(PROXY_DEPLOYER_SIGNER, CANONICAL_DEPLOYER_RAW_TRANSACTION_COST)
	const { hash: resolvedDeployHash } = await waitForSubmittedTransactionReceipt(client, deployHash)
	if (!(await proxyDeployerIsInstalledAfterReceipt(client, wait))) throw new Error(`Shared proxy deployment transaction ${resolvedDeployHash} confirmed, but no contract code was found at ${PROXY_DEPLOYER_ADDRESS}.`)
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

export function getZoltarDeploymentStatusOracleStepAddresses(profile = getRuntimeNetworkProfile()) {
	const addresses = getZoltarContractAddresses(profile)
	return zoltarDeploymentStatusStepAddresses(profile.id, profile.genesisRepTokenAddress, { proxyDeployer: PROXY_DEPLOYER_ADDRESS, ...addresses })
}

function getDeploymentStatusOracleByteCode(profile = getRuntimeNetworkProfile()) {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [getZoltarDeploymentStatusOracleStepAddresses(profile)],
	})
}

export function buildDeploymentStatusSnapshot(steps: readonly DeploymentStep[], deployedMask: bigint, deploymentStatusOracleDeployed: boolean): DeploymentStatusSnapshot {
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
		applicationDeploymentComplete: deploymentStatuses.every(step => step.deployed),
		deploymentStatuses,
	}
}

function getDeploymentStatusSnapshot(deployedMask: bigint, deploymentStatusOracleDeployed: boolean): DeploymentStatusSnapshot {
	return buildDeploymentStatusSnapshot(getDeploymentSteps(), deployedMask, deploymentStatusOracleDeployed)
}

function getDeploymentStatusOracleAddress(profile = getRuntimeNetworkProfile()) {
	return createDeploymentStatusOracleAddressHelper({
		deploymentStatusOracleBytecode: () => getDeploymentStatusOracleByteCode(profile),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		zeroSalt: ZERO_SALT,
	}).getDeploymentStatusOracleAddress()
}

export async function deployViaProxy(client: WriteClient, bytecode: Hex) {
	markDeploymentTransactionPrepared(client, {
		data: bytecode,
		functionName: 'Deploy contract through deterministic proxy',
		to: PROXY_DEPLOYER_ADDRESS,
		toLabel: 'Shared proxy',
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
		throw new Error('The shared proxy has pending funding or deployment activity. Wait for it to finish, then retry.')
	}
	if (await proxyDeployerIsInstalled(client)) return undefined
	if (activity.confirmedNonce !== 0n) return await resolveConfirmedProxyDeployer(client, wait)
	await assertCanonicalRawTransactionFeeCompatible(client, 'Shared proxy')
	const reviewedFundingShortfall = client.onTransactionPlan === undefined ? undefined : await getProxyDeployerFundingShortfall(client)
	client.onTransactionPlan?.([
		{ functionName: 'Broadcast deterministic proxy deployer transaction' },
		...((reviewedFundingShortfall ?? 0n) > 0n
			? [
					{ functionName: 'Fund deterministic proxy deployer signer without surplus', value: FUND_PROXY_DEPLOYER_SIGNER_AMOUNT, optional: true },
					{ functionName: 'Broadcast deterministic proxy deployer transaction', optional: true },
				]
			: []),
	])
	const preFundingDeploymentHash = await broadcastCanonicalProxyDeployer(client, true, wait)
	if (preFundingDeploymentHash !== undefined) return preFundingDeploymentHash

	const fundingShortfall = await getProxyDeployerFundingShortfall(client)
	if (fundingShortfall > 0n) {
		const finalActivity = await getProxyDeployerActivity(client)
		if (finalActivity.pending) {
			throw new Error('The shared proxy has pending funding or deployment activity. Wait for it to finish, then retry.')
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
	if (postFundingActivity.fundingPending) throw new Error('The shared proxy has pending funding or deployment activity. Wait for it to finish, then retry.')
	if (postFundingActivity.confirmedNonce !== 0n) return await resolveConfirmedProxyDeployer(client, wait)

	const resolvedDeployHash = await broadcastCanonicalProxyDeployer(client, false, wait)
	if (resolvedDeployHash === undefined) throw new Error(proxyDeployerSendWithoutHash)
	return resolvedDeployHash
}

export async function loadDeploymentStatusOracleMaskAtAddress(client: Pick<ReadClient, 'readContract'>, address: Address): Promise<bigint> {
	return BigInt(
		await client.readContract({
			abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
			functionName: 'getDeploymentMask',
			address,
			args: [],
		}),
	)
}

async function loadDeploymentStatusOracleMask(client: Pick<ReadClient, 'readContract'>): Promise<bigint> {
	return await loadDeploymentStatusOracleMaskAtAddress(client, getDeploymentStatusOracleAddress())
}

export function getDeploymentSteps(profile: NetworkProfile = getRuntimeNetworkProfile(), wait?: RpcStateRetryWait): DeploymentStep[] {
	const addresses = getZoltarContractAddresses(profile)
	const genesisToken = getSepoliaGenesisRepDeployment(profile.genesisOutcome)
	const testTokenSteps =
		profile.id === 'sepolia'
			? ([
					{
						id: 'reputationToken',
						label: 'GenesisReputationToken',
						address: profile.genesisRepTokenAddress,
						dependencies: ['proxyDeployer'],
						deploy: async client => await deployViaProxy(client, genesisToken.initCode),
					},
				] satisfies DeploymentStep[])
			: []

	const steps: DeploymentStep[] = [
		{
			id: 'proxyDeployer',
			label: 'Shared proxy',
			address: PROXY_DEPLOYER_ADDRESS,
			dependencies: [],
			deploy: async client => {
				const hash = await ensureProxyDeployerDeployed(client, wait)
				return hash ?? ZERO_HASH
			},
		},
		{
			id: 'deploymentStatusOracle',
			label: 'DeploymentStatusOracle',
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
			id: 'zoltarQuestionData',
			label: 'ZoltarQuestionData',
			address: addresses.zoltarQuestionData,
			dependencies: ['proxyDeployer'],
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
	]
	return withExpectedDeploymentRuntimeCodeHashes(steps, profile)
}

// Constructor arguments for the proxy-deployed steps, keyed by step id, as
// appended to each step's init code. Deployment manifests record these so
// explorer source verification never re-derives deployment parameters.
export function getZoltarDeploymentStepConstructorArguments(profile: NetworkProfile = getRuntimeNetworkProfile()): Partial<Record<DeploymentStepId, string>> {
	const addresses = getZoltarContractAddresses(profile)
	const constructorArguments: Partial<Record<DeploymentStepId, string>> = {
		deploymentStatusOracle: constructorArgumentsFromInitCode(getDeploymentStatusOracleByteCode(profile), DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object),
		multicall3: constructorArgumentsFromInitCode(MULTICALL3_BYTECODE, statoblast_Multicall3_Multicall3.evm.bytecode.object),
		zoltarQuestionData: constructorArgumentsFromInitCode(getZoltarQuestionDataByteCode(), ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object),
		zoltar: constructorArgumentsFromInitCode(getZoltarInitCode(addresses.zoltarQuestionData, profile.genesisRepTokenAddress), Zoltar_Zoltar.evm.bytecode.object),
	}
	if (profile.id === 'sepolia') {
		constructorArguments.reputationToken = constructorArgumentsFromInitCode(getSepoliaGenesisRepDeployment(profile.genesisOutcome).initCode, GenesisReputationToken_GenesisReputationToken.evm.bytecode.object)
	}
	return constructorArguments
}

export function withExpectedDeploymentRuntimeCodeHashes(steps: readonly DeploymentStep[], profile: NetworkProfile): DeploymentStep[] {
	return steps.map(step => {
		const expectedRuntimeCodeHash = profile.id === 'simulation' ? undefined : EXPECTED_PUBLIC_DEPLOYMENT_RUNTIME_CODE_HASHES[profile.id][profile.genesisOutcome][step.id]
		return {
			...step,
			...(expectedRuntimeCodeHash === undefined ? {} : { expectedRuntimeCodeHash }),
			...(profile.id === 'simulation' && step.id === 'proxyDeployer' ? { expectedRuntimeCodeHash: EXPECTED_SEPOLIA_DEPLOYMENT_RUNTIME_CODE_HASHES.proxyDeployer } : {}),
			...(profile.id === 'simulation' ? { trustedSimulationCodePresence: TRUSTED_SIMULATION_CODE_PRESENCE } : {}),
		}
	})
}

export function assertDeploymentStepRuntimeCode(step: Pick<DeploymentStep, 'address' | 'expectedRuntimeCodeHash' | 'id' | 'trustedSimulationCodePresence'>, code: Hex | undefined) {
	if (code === undefined || code === '0x') return false
	if (step.trustedSimulationCodePresence) return true
	if (step.expectedRuntimeCodeHash === undefined) throw new Error(`Could not verify the contract code for deployment step ${step.id} on the active network`)
	const actualRuntimeCodeHash = keccak256(code)
	if (actualRuntimeCodeHash !== step.expectedRuntimeCodeHash) {
		throw new Error(`Unexpected contract code for ${step.id} at ${step.address}: expected ${step.expectedRuntimeCodeHash}, received ${actualRuntimeCodeHash}`)
	}
	return true
}

/**
 * Builds a status snapshot by reading every step's code when this plan's status
 * oracle is absent. Shared infrastructure that another plan (such as the other
 * genesis root) already installed is then reported as deployed instead of
 * missing until this plan's oracle exists.
 */
export async function loadDeploymentStatusSnapshotFromCode(client: Pick<ReadClient, 'getCode'>, steps: readonly DeploymentStep[]): Promise<DeploymentStatusSnapshot> {
	const deploymentStatuses = await Promise.all(
		steps.map(async step => ({
			...step,
			deployed: step.id === 'deploymentStatusOracle' ? false : assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address })),
		})),
	)
	return { applicationDeploymentComplete: false, deploymentStatuses }
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
	if (oracleStep === undefined) throw new Error('Deployment plan is missing its deployment status oracle step')
	const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
	const deploymentStatusOracleCode = await client.getCode({ address: deploymentStatusOracleAddress })
	if (!assertDeploymentStepRuntimeCode(oracleStep, deploymentStatusOracleCode)) return await loadDeploymentStatusSnapshotFromCode(client, steps)

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
