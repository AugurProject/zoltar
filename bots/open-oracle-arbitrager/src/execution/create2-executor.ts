import { concatHex, createPublicClient, getCreate2Address, keccak256, parseTransaction, privateKeyToAccount, recoverTransactionAddress, type Address, type Chain, type Hash, type Hex } from '#ethereum'
import { executorArtifact } from '#contracts/artifacts.generated'
import { submitSignedTransaction, validateSubmissionSettings } from '#execution/transaction-submission'
import { endpointLabel, estimateRpcTransactionGas, readRpcGasPrice, readRpcPendingNonce, sendRawTransactionToRpc } from '#monitoring/connectivity'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { availableSettledValues, settledQuorumValue } from '#monitoring/read-quorum'
import { ConnectivityDegradedError } from '#monitoring/resilience'
import type { ExecutorDeploymentIntent } from '#execution/executor-deployment-store'

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

export async function assertExecutorDeploymentIntent(intent: ExecutorDeploymentIntent, account: Address, chainId: number, plan: ExecutorDeploymentPlan) {
	if (intent.account.toLowerCase() !== account.toLowerCase() || intent.address.toLowerCase() !== plan.address.toLowerCase() || intent.chainId !== chainId || intent.salt.toLowerCase() !== plan.salt.toLowerCase()) {
		throw new Error('Pending executor deployment intent does not match the active signer, chain, address, and salt')
	}
	if (keccak256(intent.serializedTransaction).toLowerCase() !== intent.transactionHash.toLowerCase()) throw new Error('Pending executor deployment intent transaction hash does not match its signed bytes')
	if ((await recoverTransactionAddress({ serializedTransaction: intent.serializedTransaction })).toLowerCase() !== account.toLowerCase()) throw new Error('Pending executor deployment intent signed transaction uses a different account')
	const transaction = parseTransaction(intent.serializedTransaction)
	if (transaction.chainId !== BigInt(chainId)) throw new Error('Pending executor deployment intent signed transaction uses a different chain')
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

function receiptNotFound(error: unknown) {
	return error instanceof Error && (error.name === 'TransactionReceiptNotFoundError' || (error.message.toLowerCase().includes('transaction receipt') && error.message.toLowerCase().includes('not found')))
}

async function executorDeploymentReceipt(parameters: { clients: readonly { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[]; transactionHash: Hash }) {
	return settledQuorumValue(
		'executor deployment receipt',
		parameters.clients.map(async ({ client, rpcUrl }) => {
			try {
				const receipt = await client.getTransactionReceipt({ hash: parameters.transactionHash })
				return {
					endpoint: endpointLabel(rpcUrl),
					value: { blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, status: receipt.status, transactionHash: receipt.transactionHash },
				}
			} catch (error) {
				if (receiptNotFound(error)) return { endpoint: endpointLabel(rpcUrl), value: undefined }
				throw error
			}
		}),
	)
}

async function waitForExecutorDeployment(parameters: { address: Address; clients: readonly { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[]; expectedRuntimeCodeHash: Hex; transactionHash: Hash }, timeoutMilliseconds = 180_000) {
	const deadline = Date.now() + timeoutMilliseconds
	while (true) {
		const receipt = await executorDeploymentReceipt(parameters)
		if (receipt !== undefined) {
			assertExecutorDeploymentReceipt(receipt.status, receipt.transactionHash)
			const codeStatus = await settledQuorumValue(
				'executor deployment runtime',
				parameters.clients.map(async ({ client, rpcUrl }) => ({ endpoint: endpointLabel(rpcUrl), value: executorCodeStatus(await client.getCode({ address: parameters.address }), parameters.expectedRuntimeCodeHash) })),
			)
			if (codeStatus !== 'verified') throw new Error('CREATE2 deployment did not produce executor runtime bytecode')
			const finalized = await confirmCanonicalReceiptFinality(
				parameters.clients.map(({ client }) => client),
				parameters.clients.map(({ rpcUrl }) => endpointLabel(rpcUrl)),
				'executor deployment',
				{ blockHash: receipt.blockHash, blockNumber: receipt.blockNumber },
				12n,
			)
			if (finalized) return receipt
		}
		if (Date.now() >= deadline) throw new Error('Executor deployment did not reach canonical finality before the confirmation deadline')
		await new Promise(resolve => {
			setTimeout(resolve, 1_000)
		})
	}
}

export async function deployExecutorCreate2(parameters: { chain: Chain; existingIntent?: ExecutorDeploymentIntent | undefined; persistIntent?: ((intent: ExecutorDeploymentIntent) => Promise<void>) | undefined; privateKey: Hex; readRpcUrls?: readonly string[] | undefined; rpcUrls: readonly string[]; salt: unknown }) {
	const plan = executorDeploymentPlan(parameters.salt)
	const expectedRuntimeCodeHash = keccak256(`0x${executorArtifact.evm.deployedBytecode.object}`)
	const account = privateKeyToAccount(parameters.privateKey)
	const readRpcUrls = parameters.readRpcUrls ?? parameters.rpcUrls
	if (readRpcUrls.length < 3 || new Set(readRpcUrls.map(url => new URL(url).origin)).size !== readRpcUrls.length) throw new Error('Executor deployment requires three independent read RPC origins')
	const readPool = createRpcEndpointPool(readRpcUrls)
	const clients = readRpcUrls.map(rpcUrl => ({ client: createPublicClient({ chain: parameters.chain, transport: readPool.transportFor(rpcUrl) }), rpcUrl }))
	const environment = await settledQuorumValue(
		'executor deployment environment',
		clients.map(async ({ client, rpcUrl }) => {
			const [chainId, proxyCode, existingCode] = await Promise.all([client.getChainId(), client.getCode({ address: deterministicDeploymentProxy }), client.getCode({ address: plan.address })])
			assertExecutorDeploymentEnvironment(chainId, parameters.chain.id, proxyCode)
			return { endpoint: endpointLabel(rpcUrl), value: { chainId, code: executorCodeStatus(existingCode, expectedRuntimeCodeHash), proxyCode: proxyCode?.toLowerCase() } }
		}),
	)
	let intent = parameters.existingIntent
	if (intent !== undefined) await assertExecutorDeploymentIntent(intent, account.address, parameters.chain.id, plan)
	if (environment.code === 'verified' && parameters.existingIntent === undefined) return { address: plan.address, alreadyDeployed: true, transactionHash: undefined }
	if (environment.code === 'verified' && parameters.existingIntent !== undefined) {
		const settledHeads = await Promise.allSettled(clients.map(async ({ client, rpcUrl }) => ({ endpoint: endpointLabel(rpcUrl), value: await client.getBlockNumber() })))
		const heads = availableSettledValues(settledHeads)
		if (heads.length < 2) throw new ConnectivityDegradedError('Executor deployment recovery requires at least two available independent RPC endpoints')
		const head = heads.reduce((minimum, observation) => (observation.value < minimum ? observation.value : minimum), heads[0]?.value ?? 0n)
		if (head < 12n) throw new ConnectivityDegradedError('Executor deployment recovery requires twelve canonical descendant blocks')
		const finalizedCodeStatus = await settledQuorumValue(
			'executor deployment finalized runtime',
			clients.map(async ({ client, rpcUrl }) => ({ endpoint: endpointLabel(rpcUrl), value: executorCodeStatus(await client.getCode({ address: plan.address, blockNumber: head - 12n }), expectedRuntimeCodeHash) })),
		)
		if (finalizedCodeStatus === 'verified') return { address: plan.address, alreadyDeployed: true, transactionHash: parameters.existingIntent.transactionHash as Hash }
	}
	if (intent === undefined) {
		const nonce = await settledQuorumValue(
			'executor deployment pending nonce',
			readRpcUrls.map(async rpcUrl => ({ endpoint: endpointLabel(rpcUrl), value: await readRpcPendingNonce(rpcUrl, account.address) })),
		)
		const gas = await settledQuorumValue(
			'executor deployment gas estimate',
			readRpcUrls.map(async rpcUrl => ({ endpoint: endpointLabel(rpcUrl), value: await estimateRpcTransactionGas(rpcUrl, { data: plan.calldata, from: account.address, to: deterministicDeploymentProxy }) })),
		)
		const gasPrice = await settledQuorumValue(
			'executor deployment gas price',
			readRpcUrls.map(async rpcUrl => ({ endpoint: endpointLabel(rpcUrl), value: await readRpcGasPrice(rpcUrl) })),
		)
		const signTransaction = account.signTransaction
		if (signTransaction === undefined) throw new Error('Executor deployment requires a local transaction signer')
		const serializedTransaction = await signTransaction({ chainId: parameters.chain.id, data: plan.calldata, gas, gasPrice, nonce, to: deterministicDeploymentProxy })
		intent = {
			account: account.address,
			address: plan.address,
			chainId: parameters.chain.id,
			salt: plan.salt,
			serializedTransaction,
			transactionHash: keccak256(serializedTransaction),
			version: 1,
		}
		if (parameters.persistIntent === undefined) throw new Error('Executor deployment requires durable intent persistence before submission')
		await parameters.persistIntent(intent)
	}
	if (environment.code !== 'verified') {
		await submitExecutorDeploymentTransaction({ account: account.address, publicRpcUrls: parameters.rpcUrls, publicSubmit: sendRawTransactionToRpc, serializedTransaction: intent.serializedTransaction, transactionHash: intent.transactionHash })
	}
	await waitForExecutorDeployment({ address: plan.address, clients, expectedRuntimeCodeHash, transactionHash: intent.transactionHash })
	return { address: plan.address, alreadyDeployed: false, transactionHash: intent.transactionHash as Hash }
}
