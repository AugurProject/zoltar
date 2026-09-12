import { executorArtifact } from '#contracts/artifacts.generated'
import { concatHex, getCreate2Address } from '@zoltar/bot-shared/ethereum'
import { isHash32 } from '@zoltar/bot-shared/infrastructure/json-validation'

import { type ExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { submitSignedTransaction, validateSubmissionSettings } from '#execution/transaction-submission'
import { type Address, type Hash, type Hex, keccak256, parseTransaction, recoverTransactionAddress } from '@zoltar/bot-shared/ethereum'

export const deterministicDeploymentProxy = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Address

const deterministicDeploymentProxyCode = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3' as Hex

export type ExecutorDeploymentPlan = {
	address: Address
	bytecode: Hex
	calldata: Hex
	salt: Hex
}

export function executorDeploymentPlan(saltValue: unknown): ExecutorDeploymentPlan {
	if (!isHash32(saltValue)) throw new Error('CREATE2 salt must be a 32-byte 0x-prefixed value')
	const salt = saltValue
	const bytecode = `0x${executorArtifact.evm.bytecode.object}` as Hex
	return {
		address: getCreate2Address({ bytecode, from: deterministicDeploymentProxy, salt }),
		bytecode,
		calldata: concatHex([salt, bytecode]),
		salt,
	}
}

export function assertExecutorDeploymentEnvironment(actualChainId: number, expectedChainId: number, proxyCode: Hex | undefined) {
	if (actualChainId !== expectedChainId) throw new Error(`RPC chain mismatch: expected ${expectedChainId.toString()}, received ${actualChainId.toString()}`)
	if (proxyCode?.toLowerCase() !== deterministicDeploymentProxyCode.toLowerCase()) throw new Error('Canonical CREATE2 deployment proxy is missing or has unexpected bytecode')
}

export function executorCodeStatus(code: Hex | undefined, expectedRuntimeCodeHash: Hex) {
	if (code === undefined || code === '0x') return 'missing' as const
	if (keccak256(code).toLowerCase() !== expectedRuntimeCodeHash.toLowerCase()) throw new Error('Executor address contains unexpected runtime bytecode')
	return 'verified' as const
}

export function assertExecutorDeploymentReceipt(status: 'reverted' | 'success', transactionHash: Hash) {
	if (status !== 'success') throw new Error(`CREATE2 executor deployment reverted: ${transactionHash}`)
}

export function assertExecutorDeploymentActive(isStopping: (() => boolean) | undefined) {
	if (isStopping?.()) throw new Error('Operator stopping before executor deployment submission')
}

export async function assertExecutorDeploymentIntent(intent: ExecutorDeploymentIntent, account: Address, chainId: number, plan: ExecutorDeploymentPlan) {
	if (intent.account.toLowerCase() !== account.toLowerCase() || intent.address.toLowerCase() !== plan.address.toLowerCase() || intent.chainId !== chainId || intent.salt.toLowerCase() !== plan.salt.toLowerCase()) {
		throw new Error('Pending executor deployment intent does not match the active signer, chain, address, and salt')
	}
	if (keccak256(intent.serializedTransaction).toLowerCase() !== intent.transactionHash.toLowerCase()) throw new Error('Pending executor deployment intent transaction hash does not match its signed bytes')
	if ((await recoverTransactionAddress({ serializedTransaction: intent.serializedTransaction })).toLowerCase() !== account.toLowerCase()) throw new Error('Pending executor deployment intent signed transaction uses a different account')
	const transaction = parseTransaction(intent.serializedTransaction)
	if (transaction.chainId !== BigInt(chainId)) throw new Error('Pending executor deployment intent signed transaction uses a different chain')
	if (transaction.value !== 0n) throw new Error('Pending executor deployment intent must not transfer ETH')
	if (transaction.to?.toLowerCase() !== deterministicDeploymentProxy.toLowerCase() || transaction.data?.toLowerCase() !== plan.calldata.toLowerCase()) throw new Error('Pending executor deployment intent does not contain the expected CREATE2 call')
}

const executorPublicSubmissionSettings = validateSubmissionSettings({ minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] })

export async function submitExecutorDeploymentTransaction(parameters: { account: Address; publicRpcUrls: readonly string[]; publicSubmit: (rpcUrl: string, serializedTransaction: Hex) => Promise<Hex>; serializedTransaction: Hex; transactionHash: Hex }) {
	return await submitSignedTransaction({
		address: parameters.account,
		hash: parameters.transactionHash,
		maxBlockNumber: 0n,
		publicRpcUrls: parameters.publicRpcUrls,
		publicSubmit: parameters.publicSubmit,
		serializedTransaction: parameters.serializedTransaction,
		settings: executorPublicSubmissionSettings,
		signMessage: async () => {
			throw new Error('Public executor deployment does not sign relay messages')
		},
	})
}
