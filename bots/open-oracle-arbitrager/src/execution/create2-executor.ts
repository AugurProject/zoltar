import { createPublicClient, keccak256, privateKeyToAccount, type Address, type Chain, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import { executorArtifact } from '#contracts/artifacts.generated'
import { endpointLabel, estimateRpcTransactionGas, readRpcGasPrice, readRpcPendingNonce, sendRawTransactionToRpc } from '#monitoring/connectivity'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { availableSettledValues, quorumValue, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { ExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { configuredReadRpcEndpointMinimum, rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { assertExecutorDeploymentActive, assertExecutorDeploymentEnvironment, assertExecutorDeploymentIntent, assertExecutorDeploymentReceipt, deterministicDeploymentProxy, executorCodeStatus, executorDeploymentPlan, submitExecutorDeploymentTransaction } from '#execution/executor-deployment-primitives'

export async function assertStoredExecutorDeploymentIntent(intent: ExecutorDeploymentIntent, expectedChainId: number) {
	await assertExecutorDeploymentIntent(intent, intent.account, expectedChainId, executorDeploymentPlan(intent.salt))
}

function receiptNotFound(error: unknown) {
	return error instanceof Error && (error.name === 'TransactionReceiptNotFoundError' || (error.message.toLowerCase().includes('transaction receipt') && (error.message.toLowerCase().includes('not found') || error.message.toLowerCase().includes('could not be found'))))
}

/**
 * Returns the included deployment receipt once the configured reader requirement has seen it together with the executor runtime
 * bytecode, or `undefined` while inclusion is still pending. A reader that has not yet seen the receipt is treated as lagging rather
 * than disagreeing, and only readers that have seen it are asked for the executor code; those readers must agree exactly.
 * The deterministic proxy reverts when CREATE2 fails, so a success receipt without code is an inconsistent read (a backend that
 * served the receipt before importing the block, or a reorg between the two reads) and is also treated as lagging. A reverted
 * receipt is returned as is so the caller surfaces the revert immediately.
 */
async function includedExecutorDeployment(parameters: { address: Address; clients: readonly { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[]; expectedRuntimeCodeHash: Hex; transactionHash: Hash }) {
	const requirement = rpcQuorumRequirement()
	const settled = await Promise.allSettled(
		parameters.clients.map(async ({ client, rpcUrl }) => {
			const endpoint = endpointLabel(rpcUrl)
			let receipt
			try {
				receipt = await client.getTransactionReceipt({ hash: parameters.transactionHash })
			} catch (error) {
				if (receiptNotFound(error)) return { endpoint, value: undefined }
				throw error
			}
			const code = executorCodeStatus(await client.getCode({ address: parameters.address }), parameters.expectedRuntimeCodeHash)
			if (receipt.status === 'success' && code === 'missing') return { endpoint, value: undefined }
			return {
				endpoint,
				value: { blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, status: receipt.status, transactionHash: receipt.transactionHash },
			}
		}),
	)
	const available = availableSettledValues(settled)
	if (available.length < requirement) {
		const failures = settled.flatMap(result => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []))
		throw new ConnectivityDegradedError(`executor deployment receipt requires at least ${requirement === 1 ? 'one available RPC endpoint' : 'two available independent RPC endpoints'}${failures.length === 0 ? '' : `; ${failures.join('; ')}`}`)
	}
	const visible = available.flatMap(observation => (observation.value === undefined ? [] : [{ endpoint: observation.endpoint, value: observation.value }]))
	if (visible.length < requirement) return undefined
	return quorumValue('executor deployment receipt', visible, requirement)
}

/**
 * Waits for the deployment transaction to be included and its runtime bytecode to be visible.
 * Inclusion is sufficient: the CREATE2 address is deterministic and the durable intent is cleared only after this returns.
 * Finality is not awaited, so the deployment checklist may be stale after a shallow reorg; arming live execution and
 * operator restarts re-authenticate the canonical deployments and refuse to arm until the executor is redeployed.
 */
async function waitForExecutorDeployment(parameters: { address: Address; clients: readonly { client: ReturnType<typeof createPublicClient>; rpcUrl: string }[]; expectedRuntimeCodeHash: Hex; isStopping?: (() => boolean) | undefined; transactionHash: Hash }, timeoutMilliseconds = 180_000) {
	const deadline = Date.now() + timeoutMilliseconds
	while (true) {
		assertExecutorDeploymentActive(parameters.isStopping)
		const receipt = await includedExecutorDeployment(parameters)
		if (receipt !== undefined) {
			assertExecutorDeploymentReceipt(receipt.status, receipt.transactionHash)
			return receipt
		}
		if (Date.now() >= deadline) throw new Error('Executor deployment was not included in a block before the confirmation deadline')
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
		const receipt = await includedExecutorDeployment({ address: plan.address, clients, expectedRuntimeCodeHash, transactionHash: parameters.existingIntent.transactionHash as Hash })
		if (receipt === undefined) throw new ConnectivityDegradedError('Stored executor deployment transaction has no quorum-visible receipt; recovery remains pending')
		if (receipt.transactionHash.toLowerCase() !== parameters.existingIntent.transactionHash.toLowerCase()) throw new Error('Executor deployment receipt does not match the stored signed transaction')
		assertExecutorDeploymentReceipt(receipt.status, receipt.transactionHash)
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
