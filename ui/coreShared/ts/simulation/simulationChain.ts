import { callHandlerOpts, ethCallProcedure, executeCall, handleTransactionCreation, type CallParams } from '@tevm/actions'
import { createCommon } from '@tevm/common'
import { createMemoryClient } from '@tevm/memory-client'
import { isHex, toHex, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { NetworkProfile } from '../wallet/networkProfile.js'
import { exportSimulationChainHistory, restoreSimulationChainHistory } from './chainHistory.js'
import { getSimulationNode, mineLockedSimulationTransaction, withSimulationLock, type SimulationNode, type SimulationVm, type TevmLikeClient } from './clock.js'
import type { SerializedSimulationBlock } from './savedStates.js'
import type { SimulationProviderRequest } from './simulationProvider.js'
import type { SimulationTransactionReceipt } from './transactionReceipts.js'

/**
 * One tevm chain with the request paths the simulation needs made cheap.
 *
 * tevm serves `eth_call`, transaction creation and receipt lookups from a deep copy of the VM, and its state manager
 * serializes the whole state again on every nested EVM call commit. On a seeded chain those copies dwarf the EVM work.
 * The chain keeps tevm's handlers and error reporting but runs them on the live VM inside a reverted state checkpoint,
 * serves receipts recorded while mining, and skips the nested serialization.
 */
export type SimulationChain = {
	/** Every mined block with its receipts, for saving alongside the state; call under `withLock`. */
	exportHistory(): Promise<SerializedSimulationBlock[]>
	memoryClient: TevmLikeClient
	request(parameters: SimulationProviderRequest): Promise<unknown>
	/** Re-inserts saved blocks into a chain still at genesis whose state was loaded from the same save. */
	restoreHistory(blocks: readonly SerializedSimulationBlock[]): Promise<void>
	/** Runs direct state writes or dumps on `memoryClient` after every in-flight call or transaction has settled. */
	withLock<TResult>(work: () => Promise<TResult>): Promise<TResult>
	/** Creates an impersonated transaction for `from`, mines it in the next block and returns its hash. */
	sendTransaction(parameters: SimulationTransactionParameters, label: string): Promise<Hash>
}

export type SimulationTransactionParameters = {
	data: Hex
	from: Address
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | undefined
	to?: Address | null | undefined
	value?: bigint | undefined
}

type EthCallRequest = {
	blockTag: Hex | 'latest' | undefined
	transaction: { data?: Hex; from?: Address; gas?: Hex; gasPrice?: Hex; to?: Address; value?: Hex }
}

type RpcErrorLike = { code?: unknown; data?: unknown; message?: unknown }

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHexString(value: unknown): value is Hex {
	return typeof value === 'string' && isHex(value, { strict: true })
}

function optionalHex(record: Record<string, unknown>, key: string): Hex | undefined | false {
	const value = record[key]
	if (value === undefined || value === null) return undefined
	return isHexString(value) ? value : false
}

/** Extracts the fields tevm's `eth_call` procedure reads; anything else falls back to the regular request path. */
function parseEthCallRequest(params: unknown): EthCallRequest | undefined {
	// State and block overrides only exist on tevm's own path.
	if (!Array.isArray(params) || params.length > 2 || !isObjectRecord(params[0])) return undefined
	const [transaction, blockTag] = params
	if (blockTag !== undefined && blockTag !== 'latest' && !isHexString(blockTag)) return undefined
	const data = optionalHex(transaction, 'data')
	const from = optionalHex(transaction, 'from')
	const gas = optionalHex(transaction, 'gas')
	const gasPrice = optionalHex(transaction, 'gasPrice')
	const to = optionalHex(transaction, 'to')
	const value = optionalHex(transaction, 'value')
	if (data === false || from === false || gas === false || gasPrice === false || to === false || value === false) return undefined
	return {
		blockTag,
		transaction: {
			...(data === undefined ? {} : { data }),
			...(from === undefined ? {} : { from }),
			...(gas === undefined ? {} : { gas }),
			...(gasPrice === undefined ? {} : { gasPrice }),
			...(to === undefined ? {} : { to }),
			...(value === undefined ? {} : { value }),
		},
	}
}

function parseReceiptHash(params: unknown): Hash | undefined {
	if (!Array.isArray(params)) return undefined
	const hash = params[0]
	return isHexString(hash) ? hash : undefined
}

/** Mirrors how tevm's EIP-1193 request decorator surfaces a JSON-RPC error object. */
function createRpcError(error: unknown): Error {
	const record: RpcErrorLike = isObjectRecord(error) ? error : {}
	const code = typeof record.code === 'number' ? record.code : Number(record.code)
	return Object.assign(new Error(typeof record.message === 'string' ? record.message : 'Unknown provider error'), {
		code: Number.isFinite(code) ? code : -32000,
		data: 'data' in record ? record.data : error,
		details: typeof record.message === 'string' ? record.message : 'Unknown provider error',
	})
}

function requireTransactionHash(hash: Hex | undefined, label: string): Hash {
	if (hash === undefined) throw new Error(`Simulation ${label} did not return a transaction hash`)
	return hash
}

function createCallParams({ data, from, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }: SimulationTransactionParameters): CallParams {
	return {
		addToMempool: 'on-success',
		data,
		from,
		...(gas === undefined ? {} : { gas }),
		...(gasPrice === undefined ? {} : { gasPrice }),
		...(maxFeePerGas === undefined ? {} : { maxFeePerGas }),
		...(maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas }),
		...(nonce === undefined ? {} : { nonce }),
		...(to === undefined || to === null ? {} : { to }),
		...(value === undefined ? {} : { value }),
	}
}

/** Mirrors tevm's `maybeThrowOnFail`, so failures surface exactly as `tevmCall` reports them. */
function throwTevmErrors(errors: readonly unknown[]): never {
	if (errors.length === 1) throw errors[0]
	throw new AggregateError(errors)
}

/**
 * The live VM presented as its own "deep copy", so tevm's handlers and the transaction pool execute and read in place.
 * Only the latest block can be served this way; the state-root check rejects anything else.
 */
function createLiveSimulationVm(vm: SimulationVm): SimulationVm {
	const liveVm: SimulationVm = {
		...vm,
		deepCopy: async () => liveVm,
		stateManager: {
			...vm.stateManager,
			setStateRoot: async (root: Uint8Array) => {
				if (toHex(root) !== vm.stateManager._baseState.getCurrentStateRoot()) throw new Error('The live simulation VM only serves the latest block state')
			},
		},
	}
	return liveVm
}

/** Runs `work` inside a state checkpoint that is always reverted, so the live VM can execute calls without keeping their effects. */
async function withRevertedStateCheckpoint<TResult>(vm: SimulationVm, work: () => Promise<TResult>) {
	await vm.stateManager.checkpoint()
	try {
		return await work()
	} finally {
		await vm.stateManager.revert()
	}
}

/**
 * tevm's state manager snapshots every account, slot and bytecode on each commit so it can record state roots. The EVM
 * journal commits once per nested message call, which makes every internal call cost a full serialization of the chain.
 * Only commits that close the outermost checkpoint or create a block root need the snapshot; the nested ones just merge
 * their cache layer, which is all tevm's own commit does with the snapshot's result at that depth.
 */
function skipNestedStateDumps(vm: SimulationVm) {
	if (vm.evm.stateManager !== vm.stateManager) throw new Error('Simulation VM and EVM do not share a state manager')
	const stateManager = vm.stateManager
	const baseState = stateManager._baseState
	const commit = stateManager.commit
	stateManager.commit = async (createNewStateRoot = false) => {
		if (createNewStateRoot || baseState.caches.accounts._checkpoints <= 1) {
			await commit(createNewStateRoot)
			return
		}
		baseState.caches.accounts.commit()
		baseState.caches.contracts.commit()
		baseState.caches.storage.commit()
		baseState.tombstones.checkpoints.pop()
		baseState.options.onCommit?.(baseState)
	}
}

export async function createSimulationChain(profile: Pick<NetworkProfile, 'chain'>): Promise<SimulationChain> {
	const memoryClient = createMemoryClient({
		common: createCommon({
			...profile.chain,
		}),
		miningConfig: {
			type: 'manual',
		},
	})
	await memoryClient.tevmReady()
	const node = getSimulationNode(memoryClient)
	const vm = await node.getVm()
	skipNestedStateDumps(vm)
	const liveVm = createLiveSimulationVm(vm)
	const liveNode: SimulationNode = { ...node, getVm: async () => liveVm }
	// The pool validates every added transaction against a deep copy of its VM; the live view makes that a plain read.
	const pool = await node.getTxPool()
	pool.vm = liveVm
	const receipts = new Map<string, SimulationTransactionReceipt>()
	// viem types the transport request by RPC schema; the simulation forwards arbitrary methods through tevm's own handlers.
	const requestRaw = async (parameters: SimulationProviderRequest) => await (memoryClient.request as (parameters: SimulationProviderRequest) => Promise<unknown>)(parameters)
	const requestFallback = async (parameters: SimulationProviderRequest) => await withSimulationLock(memoryClient, async () => await requestRaw(parameters))

	const servesLatestBlock = async (blockTag: EthCallRequest['blockTag']) => {
		if (blockTag === undefined || blockTag === 'latest') return true
		const head = await vm.blockchain.getCanonicalHeadBlock()
		return BigInt(blockTag) === head.header.number
	}

	// The head is compared under the lock: a transaction queued ahead of the call may have moved it since the request arrived.
	const call = async (parameters: SimulationProviderRequest, parsed: EthCallRequest) =>
		await withSimulationLock(memoryClient, async () => {
			if (!(await servesLatestBlock(parsed.blockTag))) return await requestRaw(parameters)
			const response = await withRevertedStateCheckpoint(vm, async () => await ethCallProcedure(liveNode)({ id: 1, jsonrpc: '2.0', method: 'eth_call', params: [parsed.transaction, parsed.blockTag ?? 'latest'] }))
			if ('error' in response && response.error !== undefined) throw createRpcError(response.error)
			return response.result
		})

	const request: SimulationChain['request'] = async parameters => {
		if (parameters.method === 'eth_getTransactionReceipt') {
			const hash = parseReceiptHash(parameters.params)
			if (hash !== undefined) return receipts.get(hash.toLowerCase()) ?? null
		}
		if (parameters.method === 'eth_call') {
			const parsed = parseEthCallRequest(parameters.params)
			if (parsed !== undefined) return await call(parameters, parsed)
		}
		return await requestFallback(parameters)
	}

	/**
	 * `tevmCall` with `addToMempool` executes the call on a VM copy and then builds the pooled transaction from the
	 * original. The same two tevm steps run here on the live VM: the validating execution inside a reverted checkpoint,
	 * then transaction creation against the untouched state. The block builder is the execution that counts.
	 */
	const sendTransaction: SimulationChain['sendTransaction'] = async (parameters, label) =>
		await withSimulationLock(memoryClient, async () => {
			const callParams = createCallParams(parameters)
			const callOptions = await callHandlerOpts(liveNode, callParams)
			if (callOptions.errors !== undefined) throwTevmErrors(callOptions.errors)
			const executedCall = await withRevertedStateCheckpoint(vm, async () => await executeCall(liveNode, callOptions.data, callParams))
			if (!('runTxResult' in executedCall)) throwTevmErrors(executedCall.errors)
			if (executedCall.errors !== undefined) throwTevmErrors(executedCall.errors)
			const created = await handleTransactionCreation(liveNode, callParams, executedCall, callOptions.data)
			if (created.errors !== undefined) throwTevmErrors(created.errors)
			const hash = requireTransactionHash(created.hash, label)
			receipts.set(hash.toLowerCase(), await mineLockedSimulationTransaction(memoryClient, hash))
			return hash
		})

	const exportHistory: SimulationChain['exportHistory'] = async () => await exportSimulationChainHistory(memoryClient)

	const withLock: SimulationChain['withLock'] = async work => await withSimulationLock(memoryClient, work)

	const restoreHistory: SimulationChain['restoreHistory'] = async blocks =>
		await withSimulationLock(memoryClient, async () => {
			for (const [hash, receipt] of await restoreSimulationChainHistory(memoryClient, blocks)) receipts.set(hash, receipt)
		})

	return { exportHistory, memoryClient, request, restoreHistory, sendTransaction, withLock }
}
