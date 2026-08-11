import { concatHex, createPublicClient, getCreate2Address, http, keccak256, privateKeyToAccount, type Address, type Chain, type Hash, type Hex } from '#ethereum'
import { executorArtifact } from '#contracts/artifacts.generated'
import { submitSignedTransaction, validateSubmissionSettings } from '#execution/transaction-submission'
import { endpointLabel, estimateRpcTransactionGas, readRpcGasPrice, readRpcPendingNonce, sendRawTransactionToRpc } from '#monitoring/connectivity'

export const deterministicDeploymentProxy = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Address
export const deterministicDeploymentProxyCode = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3' as Hex

export type ExecutorDeploymentPlan = {
	address: Address
	bytecode: Hex
	calldata: Hex
	salt: Hex
}

export function executorDeploymentPlan(saltValue: unknown): ExecutorDeploymentPlan {
	if (typeof saltValue !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(saltValue)) throw new Error('CREATE2 salt must be a 32-byte 0x-prefixed value')
	const salt = saltValue as Hex
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

export async function deployExecutorCreate2(parameters: { chain: Chain; privateKey: Hex; rpcUrls: readonly string[]; salt: unknown }) {
	const plan = executorDeploymentPlan(parameters.salt)
	const expectedRuntimeCodeHash = keccak256(`0x${executorArtifact.evm.deployedBytecode.object}`)
	let publicClient: ReturnType<typeof createPublicClient> | undefined
	let preparationRpcUrl: string | undefined
	const preflightFailures: string[] = []
	for (const rpcUrl of parameters.rpcUrls) {
		try {
			const candidate = createPublicClient({ chain: parameters.chain, transport: http(rpcUrl) })
			const chainId = await candidate.getChainId()
			const proxyCode = await candidate.getCode({ address: deterministicDeploymentProxy })
			assertExecutorDeploymentEnvironment(chainId, parameters.chain.id, proxyCode)
			const existingCode = await candidate.getCode({ address: plan.address })
			if (executorCodeStatus(existingCode, expectedRuntimeCodeHash) === 'verified') return { address: plan.address, alreadyDeployed: true, transactionHash: undefined }
			publicClient = candidate
			preparationRpcUrl = rpcUrl
			break
		} catch (error) {
			preflightFailures.push(`${endpointLabel(rpcUrl)}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	if (publicClient === undefined || preparationRpcUrl === undefined) throw new Error(`Every public RPC failed executor deployment preflight: ${preflightFailures.join('; ')}`)
	const account = privateKeyToAccount(parameters.privateKey)
	const signTransaction = account.signTransaction
	if (signTransaction === undefined) throw new Error('Executor deployment requires a local transaction signer')
	const [nonce, gas, gasPrice] = await Promise.all([readRpcPendingNonce(preparationRpcUrl, account.address), estimateRpcTransactionGas(preparationRpcUrl, { data: plan.calldata, from: account.address, to: deterministicDeploymentProxy }), readRpcGasPrice(preparationRpcUrl)])
	const serializedTransaction = await signTransaction({
		chainId: parameters.chain.id,
		data: plan.calldata,
		gas,
		gasPrice,
		nonce,
		to: deterministicDeploymentProxy,
	})
	const transactionHash = keccak256(serializedTransaction)
	await submitExecutorDeploymentTransaction({
		account: account.address,
		publicRpcUrls: parameters.rpcUrls,
		publicSubmit: sendRawTransactionToRpc,
		serializedTransaction,
		transactionHash,
	})
	const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
	assertExecutorDeploymentReceipt(receipt.status, receipt.transactionHash)
	const deployedCode = await publicClient.getCode({ address: plan.address })
	if (executorCodeStatus(deployedCode, expectedRuntimeCodeHash) !== 'verified') throw new Error('CREATE2 deployment did not produce executor runtime bytecode')
	return { address: plan.address, alreadyDeployed: false, transactionHash: transactionHash as Hash }
}
