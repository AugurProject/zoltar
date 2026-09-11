import { createPublicClient, keccak256, privateKeyToAccount, type Address, type Chain, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import { executorArtifact } from '#contracts/artifacts.generated'
import { endpointLabel, estimateRpcTransactionGas, readRpcGasPrice, readRpcPendingNonce, sendRawTransactionToRpc } from '#monitoring/connectivity'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { ExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { configuredReadRpcEndpointMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { assertExecutorDeploymentActive, assertExecutorDeploymentEnvironment, assertExecutorDeploymentIntent, assertExecutorDeploymentReceipt, deterministicDeploymentProxy, executorCodeStatus, executorDeploymentPlan, submitExecutorDeploymentTransaction } from '#execution/executor-deployment-primitives'

export async function assertStoredExecutorDeploymentIntent(intent: ExecutorDeploymentIntent, expectedChainId: number) {
	await assertExecutorDeploymentIntent(intent, intent.account, expectedChainId, executorDeploymentPlan(intent.salt))
}

function receiptNotFound(error: unknown) {
	return error instanceof Error && (error.name === 'TransactionReceiptNotFoundError' || (error.message.toLowerCase().includes('transaction receipt') && (error.message.toLowerCase().includes('not found') || error.message.toLowerCase().includes('could not be found'))))
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

async function waitForExecutorDeployment(parameters: { address: Address; clients: readonly { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[]; expectedRuntimeCodeHash: Hex; isStopping?: (() => boolean) | undefined; transactionHash: Hash }, timeoutMilliseconds = 180_000) {
	const deadline = Date.now() + timeoutMilliseconds
	while (true) {
		assertExecutorDeploymentActive(parameters.isStopping)
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

export async function deployExecutorCreate2(parameters: {
	chain: Chain
	existingIntent?: ExecutorDeploymentIntent | undefined
	isStopping?: (() => boolean) | undefined
	persistIntent?: ((intent: ExecutorDeploymentIntent) => Promise<void>) | undefined
	privateKey: Hex
	readRpcUrls?: readonly string[] | undefined
	rpcUrls: readonly string[]
	salt: unknown
}) {
	const plan = executorDeploymentPlan(parameters.salt)
	const expectedRuntimeCodeHash = keccak256(`0x${executorArtifact.evm.deployedBytecode.object}`)
	const account = privateKeyToAccount(parameters.privateKey)
	const readRpcUrls = parameters.readRpcUrls ?? parameters.rpcUrls
	if (readRpcUrls.length < configuredReadRpcEndpointMinimum() || new Set(readRpcUrls.map(url => new URL(url).origin)).size !== readRpcUrls.length) throw new Error('Executor deployment requires three independent read RPC origins')
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
		const receipt = await executorDeploymentReceipt({ clients, transactionHash: parameters.existingIntent.transactionHash as Hash })
		if (receipt === undefined) throw new ConnectivityDegradedError('Stored executor deployment transaction has no quorum-visible receipt; recovery remains pending')
		if (receipt.transactionHash.toLowerCase() !== parameters.existingIntent.transactionHash.toLowerCase()) throw new Error('Executor deployment receipt does not match the stored signed transaction')
		assertExecutorDeploymentReceipt(receipt.status, receipt.transactionHash)
		const finalized = await confirmCanonicalReceiptFinality(
			clients.map(({ client }) => client),
			clients.map(({ rpcUrl }) => endpointLabel(rpcUrl)),
			'executor deployment recovery',
			{ blockHash: receipt.blockHash, blockNumber: receipt.blockNumber },
			12n,
		)
		if (!finalized) throw new ConnectivityDegradedError('Stored executor deployment transaction has not reached canonical finality; recovery remains pending')
		return { address: plan.address, alreadyDeployed: true, transactionHash: parameters.existingIntent.transactionHash as Hash }
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
		assertExecutorDeploymentActive(parameters.isStopping)
		await submitExecutorDeploymentTransaction({ account: account.address, publicRpcUrls: parameters.rpcUrls, publicSubmit: sendRawTransactionToRpc, serializedTransaction: intent.serializedTransaction, transactionHash: intent.transactionHash })
	}
	await waitForExecutorDeployment({ address: plan.address, clients, expectedRuntimeCodeHash, ...(parameters.isStopping === undefined ? {} : { isStopping: parameters.isStopping }), transactionHash: intent.transactionHash })
	return { address: plan.address, alreadyDeployed: false, transactionHash: intent.transactionHash as Hash }
}
