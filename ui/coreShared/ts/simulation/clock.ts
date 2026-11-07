import type { createMemoryClient } from '@tevm/memory-client'
import { toHex, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatSimulationTransactionReceipt } from './transactionReceipts.js'

const SIMULATION_INITIAL_TIMESTAMP = 1_735_689_600n
const SIMULATION_BLOCK_INTERVAL_SECONDS = 1n

export type TevmLikeClient = ReturnType<typeof createMemoryClient>
export type SimulationNode = TevmLikeClient['transport']['tevm']
export type SimulationVm = Awaited<ReturnType<SimulationNode['getVm']>>
type SimulationBlockBuilder = Awaited<ReturnType<SimulationVm['buildBlock']>>
type SimulationTransactionResult = Awaited<ReturnType<SimulationBlockBuilder['addTransaction']>>
/** `[address, topics, data]` as tevm stores a log in a receipt. */
export type SimulationReceiptLog = [Uint8Array, Uint8Array[], Uint8Array]
/** The parts of a pooled tevm transaction the simulation reads; tevm types them through a package the UI does not depend on. */
export type SimulationTransaction = {
	getSenderAddress(): { toString(): string }
	hash(): Uint8Array
	nonce: bigint
	to?: { toString(): string } | undefined
	type: number
} & ({ gasPrice: bigint } | { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint })

function hasFunctions(value: unknown, names: readonly string[]) {
	if (typeof value !== 'object' || value === null) return false
	return names.every(name => name in value && typeof Reflect.get(value, name) === 'function')
}

export function getSimulationNode(memoryClient: TevmLikeClient): SimulationNode {
	const tevmNode = memoryClient.transport.tevm
	if (!hasFunctions(tevmNode, ['getReceiptsManager', 'getTxPool', 'getVm'])) throw new Error('Simulation transport did not expose a compatible Tevm node')
	return tevmNode
}

const simulationLocks = new WeakMap<TevmLikeClient, Promise<void>>()

/**
 * Runs `work` after every earlier locked operation on the same chain has settled. Blocks, calls and transactions all
 * mutate the live VM through state checkpoints that must nest last-in-first-out, so the worker must never interleave
 * two of them even though it handles requests concurrently.
 */
export async function withSimulationLock<TResult>(memoryClient: TevmLikeClient, work: () => Promise<TResult>): Promise<TResult> {
	const previous = simulationLocks.get(memoryClient) ?? Promise.resolve()
	const current = previous.then(work)
	simulationLocks.set(
		memoryClient,
		current.then(
			() => undefined,
			() => undefined,
		),
	)
	return await current
}

function requireSimulationTimestamp(timestamp: bigint | undefined) {
	if (timestamp === undefined) throw new Error('Simulation block timestamp was unavailable')
	return timestamp
}

function requireSimulationTransaction(tx: SimulationTransaction | null, txHash: Hash) {
	if (tx === null) throw new Error(`Simulation transaction ${txHash} was not found in the tx pool`)
	return tx
}

export async function getSimulationChainTimestamp(memoryClient: TevmLikeClient) {
	const block = await memoryClient.getBlock()
	return requireSimulationTimestamp(block.timestamp)
}

export function getNextSimulationTimestamp(currentTimestamp: bigint) {
	return currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS
}

/** Opens a block on the live VM. tevm's own miner builds on a deep copy of the VM, which costs a serialization of the whole state per block. */
async function startSimulationBlock(memoryClient: TevmLikeClient, timestamp: bigint) {
	const node = getSimulationNode(memoryClient)
	const vm = await node.getVm()
	const parentBlock = await vm.blockchain.getCanonicalHeadBlock()
	const parentRoot = toHex(parentBlock.header.stateRoot)
	const parentState = vm.stateManager._baseState.stateRoots.get(parentRoot)
	const blockBuilder = await vm.buildBlock({
		headerData: {
			baseFeePerGas: parentBlock.header.calcNextBaseFee(),
			gasLimit: parentBlock.header.gasLimit,
			number: parentBlock.header.number + 1n,
			timestamp,
		},
		parentBlock,
		blockOpts: {
			common: vm.common,
			freeze: false,
			putBlockIntoBlockchain: false,
			setHardfork: false,
		},
	})
	return { blockBuilder, node, parentRoot, parentState, vm }
}

async function sealSimulationBlock({ blockBuilder, node, parentRoot, parentState, vm }: Awaited<ReturnType<typeof startSimulationBlock>>, receipts: readonly SimulationTransactionResult['receipt'][]) {
	// A committed checkpoint with a fresh root is how tevm records the block's state for later block-tagged reads.
	await vm.stateManager.checkpoint()
	await vm.stateManager.commit(true)
	const block = await blockBuilder.build()
	const receiptsManager = await node.getReceiptsManager()
	await Promise.all([receiptsManager.saveReceipts(block, receipts), vm.blockchain.putBlock(block)])
	// tevm re-records the current root's snapshot on every ordinary commit, which on the live VM would leave the parent
	// block's root describing the child's state. Block-tagged reads of the parent need the snapshot it had.
	const stateRoots = vm.stateManager._baseState.stateRoots
	if (parentState !== undefined && stateRoots.get(parentRoot) !== parentState) stateRoots.set(parentRoot, parentState)
	return block
}

async function mineEmptySimulationBlock(memoryClient: TevmLikeClient, timestamp: bigint) {
	const pendingBlock = await startSimulationBlock(memoryClient, timestamp)
	await sealSimulationBlock(pendingBlock, [])
}

async function minePooledSimulationTransaction(memoryClient: TevmLikeClient, txHash: Hash, timestamp: bigint) {
	const pendingBlock = await startSimulationBlock(memoryClient, timestamp)
	const pool = await pendingBlock.node.getTxPool()
	const transaction = requireSimulationTransaction(pool.getByHash(txHash), txHash)
	pool.removeByHash(txHash)
	let result: SimulationTransactionResult
	try {
		result = await pendingBlock.blockBuilder.addTransaction(transaction, {
			skipBalance: true,
			skipHardForkValidation: true,
			skipNonce: true,
		})
	} catch (error) {
		await pendingBlock.blockBuilder.revert()
		throw error
	}
	const block = await sealSimulationBlock(pendingBlock, [result.receipt])
	pool.removeNewBlockTxs([block])
	return formatSimulationTransactionReceipt({ block, result, transaction, transactionIndex: 0 })
}

/** Mines the pooled transaction into its own block at `timestamp` and returns its receipt; a transaction the builder rejects leaves the state untouched. */
export async function includePendingSimulationTransactionAtTimestamp(memoryClient: TevmLikeClient, txHash: Hash, timestamp: bigint) {
	return await withSimulationLock(memoryClient, async () => await minePooledSimulationTransaction(memoryClient, txHash, timestamp))
}

/** `includePendingSimulationTransaction` for callers that already hold the chain's lock. */
export async function mineLockedSimulationTransaction(memoryClient: TevmLikeClient, txHash: Hash) {
	return await minePooledSimulationTransaction(memoryClient, txHash, getNextSimulationTimestamp(await getSimulationChainTimestamp(memoryClient)))
}

export async function includePendingSimulationTransaction(memoryClient: TevmLikeClient, txHash: Hash) {
	return await withSimulationLock(memoryClient, async () => await mineLockedSimulationTransaction(memoryClient, txHash))
}

export async function advanceNextSimulationBlock(memoryClient: TevmLikeClient) {
	await withSimulationLock(memoryClient, async () => await mineEmptySimulationBlock(memoryClient, getNextSimulationTimestamp(await getSimulationChainTimestamp(memoryClient))))
}

export async function advanceSimulationTime(memoryClient: TevmLikeClient, seconds: bigint) {
	const offset = seconds > 0n ? seconds : SIMULATION_BLOCK_INTERVAL_SECONDS
	await withSimulationLock(memoryClient, async () => await mineEmptySimulationBlock(memoryClient, (await getSimulationChainTimestamp(memoryClient)) + offset))
}

export async function initializeSimulationClock(memoryClient: TevmLikeClient, initialTimestamp: bigint = SIMULATION_INITIAL_TIMESTAMP) {
	return await withSimulationLock(memoryClient, async () => {
		const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
		if (currentTimestamp >= initialTimestamp) return currentTimestamp
		const nextTimestamp = currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS > initialTimestamp ? currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS : initialTimestamp
		await mineEmptySimulationBlock(memoryClient, nextTimestamp)
		return nextTimestamp
	})
}
