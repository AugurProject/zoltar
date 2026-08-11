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

async function waitForExecutorDeployment(parameters: { address: Address; clients: readonly { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[]; expectedRuntimeCodeHash: Hex; transactionHash: Hash }, timeoutMilliseconds = 180_000) {
	const deadline = Date.now() + timeoutMilliseconds
	let failures: string[] = []
	while (true) {
		const settled = await Promise.allSettled(
			parameters.clients.map(async ({ client, rpcUrl }) => {
				const receipt = await client.getTransactionReceipt({ hash: parameters.transactionHash })
				assertExecutorDeploymentReceipt(receipt.status, receipt.transactionHash)
				const deployedCode = await client.getCode({ address: parameters.address })
				if (executorCodeStatus(deployedCode, parameters.expectedRuntimeCodeHash) !== 'verified') throw new Error('CREATE2 deployment did not produce executor runtime bytecode')
				return { receipt, rpcUrl }
			}),
		)
		const confirmed = settled.find(result => result.status === 'fulfilled')
		if (confirmed?.status === 'fulfilled') return confirmed.value.receipt
		failures = settled.map((result, index) => {
			const endpoint = parameters.clients[index]
			if (endpoint === undefined) return 'Unknown RPC: missing deployment confirmation result'
			return `${endpointLabel(endpoint.rpcUrl)}: ${result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : 'unknown confirmation failure'}`
		})
		if (Date.now() >= deadline) throw new Error(`Every public RPC failed executor deployment confirmation: ${failures.join('; ')}`)
		await new Promise(resolve => {
			setTimeout(resolve, 1_000)
		})
	}
}

export async function deployExecutorCreate2(parameters: { chain: Chain; privateKey: Hex; rpcUrls: readonly string[]; salt: unknown }) {
	const plan = executorDeploymentPlan(parameters.salt)
	const expectedRuntimeCodeHash = keccak256(`0x${executorArtifact.evm.deployedBytecode.object}`)
	const account = privateKeyToAccount(parameters.privateKey)
	const clients: { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[] = []
	let prepared: { gas: bigint; gasPrice: bigint; nonce: bigint } | undefined
	const preflightFailures: string[] = []
	for (const rpcUrl of parameters.rpcUrls) {
		try {
			const candidate = createPublicClient({ chain: parameters.chain, transport: http(rpcUrl) })
			const chainId = await candidate.getChainId()
			const proxyCode = await candidate.getCode({ address: deterministicDeploymentProxy })
			assertExecutorDeploymentEnvironment(chainId, parameters.chain.id, proxyCode)
			const existingCode = await candidate.getCode({ address: plan.address })
			if (executorCodeStatus(existingCode, expectedRuntimeCodeHash) === 'verified') return { address: plan.address, alreadyDeployed: true, transactionHash: undefined }
			clients.push({ client: candidate, rpcUrl })
			if (prepared === undefined) {
				const [nonce, gas, gasPrice] = await Promise.all([readRpcPendingNonce(rpcUrl, account.address), estimateRpcTransactionGas(rpcUrl, { data: plan.calldata, from: account.address, to: deterministicDeploymentProxy }), readRpcGasPrice(rpcUrl)])
				prepared = { gas, gasPrice, nonce }
			}
		} catch (error) {
			preflightFailures.push(`${endpointLabel(rpcUrl)}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	if (prepared === undefined) throw new Error(`Every public RPC failed executor deployment preflight or transaction preparation: ${preflightFailures.join('; ')}`)
	const signTransaction = account.signTransaction
	if (signTransaction === undefined) throw new Error('Executor deployment requires a local transaction signer')
	const serializedTransaction = await signTransaction({
		chainId: parameters.chain.id,
		data: plan.calldata,
		gas: prepared.gas,
		gasPrice: prepared.gasPrice,
		nonce: prepared.nonce,
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
	await waitForExecutorDeployment({ address: plan.address, clients, expectedRuntimeCodeHash, transactionHash })
	return { address: plan.address, alreadyDeployed: false, transactionHash: transactionHash as Hash }
}
