import { createMemoryClient } from 'tevm'
import { bytesToHex, hexToBytes, keccak256, type Hash, type Hex } from '@zoltar/shared/ethereum'

export const SIMULATION_INITIAL_TIMESTAMP = 1_735_689_600n
export const SIMULATION_BLOCK_INTERVAL_SECONDS = 1n

type TevmLikeClient = ReturnType<typeof createMemoryClient>
type SimulationBlock = {
	hash(): Uint8Array
	header: {
		calcNextBaseFee(): bigint
		gasLimit: bigint
		number: bigint
		serialize(): Uint8Array
		stateRoot: Uint8Array
	}
}
type SimulationBlockchain = {
	getBlock(blockNumber: bigint): Promise<SimulationBlock>
	getCanonicalHeadBlock(): Promise<SimulationBlock>
	putBlock(block: SimulationBlock): Promise<void>
}
type SimulationVm = {
	blockchain: SimulationBlockchain
	common: unknown
	deepCopy(): Promise<SimulationVm>
	evm: {
		blockchain: unknown
	}
	stateManager: {
		_baseState: {
			getCurrentStateRoot(): `0x${string}`
			stateRoots: Map<`0x${string}`, Uint8Array>
		}
		checkpoint(): Promise<void>
		commit(commitStateRoot?: boolean): Promise<void>
		saveStateRoot(root: Uint8Array, value: Uint8Array): void
		setStateRoot(root: Uint8Array): Promise<void>
	}
	buildBlock(parameters: {
		headerData: {
			baseFeePerGas: bigint
			gasLimit: bigint
			number: bigint
			timestamp: bigint
		}
		parentBlock: SimulationBlock
		blockOpts: {
			common: unknown
			freeze: boolean
			putBlockIntoBlockchain: boolean
			setHardfork: boolean
		}
	}): Promise<SimulationBlockBuilder>
}
type SimulationBlockBuilder = {
	addTransaction(
		tx: unknown,
		options: {
			skipBalance: boolean
			skipHardForkValidation: boolean
			skipNonce: boolean
		},
	): Promise<{ receipt: unknown }>
	build(): Promise<SimulationBlock>
}
type SimulationReceiptsManager = {
	chain: unknown
	saveReceipts(block: SimulationBlock, receipts: readonly unknown[]): Promise<void>
}
type SimulationTxPool = {
	getByHash(txHash: Hash): unknown | null
	removeByHash(txHash: Hash): void
	removeNewBlockTxs(blocks: readonly SimulationBlock[]): void
}
type SimulationNode = {
	getReceiptsManager(): Promise<SimulationReceiptsManager>
	getTxPool(): Promise<SimulationTxPool>
	getVm(): Promise<SimulationVm>
}

function isSimulationNode(value: unknown): value is SimulationNode {
	if (typeof value !== 'object' || value === null) return false
	return 'getReceiptsManager' in value && typeof value.getReceiptsManager === 'function' && 'getTxPool' in value && typeof value.getTxPool === 'function' && 'getVm' in value && typeof value.getVm === 'function'
}

function getSimulationNode(memoryClient: TevmLikeClient): SimulationNode {
	const tevmNode = memoryClient.transport.tevm
	if (!isSimulationNode(tevmNode)) throw new Error('Simulation transport did not expose a compatible Tevm node')
	return tevmNode
}

function requireSimulationTimestamp(timestamp: bigint | undefined) {
	if (timestamp === undefined) throw new Error('Simulation block timestamp was unavailable')
	return timestamp
}

function requireSimulationTransaction<T>(tx: T | null, txHash: Hash) {
	if (tx === null) throw new Error(`Simulation transaction ${txHash} was not found in the tx pool`)
	return tx
}

async function syncSimulationVmState({ block, memoryClient, receiptsManager, vm }: { block: SimulationBlock; memoryClient: TevmLikeClient; receiptsManager: SimulationReceiptsManager; vm: SimulationVm }) {
	const simulationNode = getSimulationNode(memoryClient)
	const originalVm = await simulationNode.getVm()
	const stateRootValue = vm.stateManager._baseState.stateRoots.get(bytesToHex(block.header.stateRoot))
	if (stateRootValue === undefined) throw new Error('Simulation state root was not found after mining a block')
	originalVm.stateManager.saveStateRoot(block.header.stateRoot, stateRootValue)
	originalVm.blockchain = vm.blockchain
	originalVm.evm.blockchain = vm.evm.blockchain
	receiptsManager.chain = vm.evm.blockchain
	await originalVm.stateManager.setStateRoot(hexToBytes(vm.stateManager._baseState.getCurrentStateRoot()))
}

export async function getSimulationChainTimestamp(memoryClient: TevmLikeClient) {
	const block = await memoryClient.getBlock()
	return requireSimulationTimestamp(block.timestamp)
}

export async function getSimulationExecutionBlockHeaderRlp(memoryClient: TevmLikeClient, blockNumber: bigint): Promise<Hex> {
	const simulationNode = getSimulationNode(memoryClient)
	const vm = await simulationNode.getVm()
	const block = await vm.blockchain.getBlock(blockNumber)
	const encodedHeader = bytesToHex(block.header.serialize())
	if (keccak256(encodedHeader) !== bytesToHex(block.hash())) {
		throw new Error(`Serialized simulation header does not match block ${blockNumber.toString()}`)
	}
	return encodedHeader
}

export async function getSimulationChainBlockNumber(memoryClient: TevmLikeClient) {
	const simulationNode = getSimulationNode(memoryClient)
	const vm = await simulationNode.getVm()
	return (await vm.blockchain.getCanonicalHeadBlock()).header.number
}

export function getNextSimulationTimestamp(currentTimestamp: bigint) {
	return currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS
}

async function mineSimulationBlockAtTimestamp(memoryClient: TevmLikeClient, timestamp: bigint) {
	const simulationNode = getSimulationNode(memoryClient)
	const receiptsManager = await simulationNode.getReceiptsManager()
	const originalVm = await simulationNode.getVm()
	const vm = await originalVm.deepCopy()
	const parentBlock = await vm.blockchain.getCanonicalHeadBlock()
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
	await vm.stateManager.checkpoint()
	await vm.stateManager.commit(true)
	const block = await blockBuilder.build()
	await Promise.all([receiptsManager.saveReceipts(block, []), vm.blockchain.putBlock(block)])
	await syncSimulationVmState({ block, memoryClient, receiptsManager, vm })
}

export async function minePendingSimulationTransactionAtTimestamp(memoryClient: TevmLikeClient, txHash: Hash, timestamp: bigint) {
	const simulationNode = getSimulationNode(memoryClient)
	const pool = await simulationNode.getTxPool()
	const receiptsManager = await simulationNode.getReceiptsManager()
	const originalVm = await simulationNode.getVm()
	const vm = await originalVm.deepCopy()
	const parentBlock = await vm.blockchain.getCanonicalHeadBlock()
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
	const tx = requireSimulationTransaction(pool.getByHash(txHash), txHash)
	pool.removeByHash(txHash)
	const txResult = await blockBuilder.addTransaction(tx, {
		skipBalance: true,
		skipHardForkValidation: true,
		skipNonce: true,
	})
	await vm.stateManager.checkpoint()
	await vm.stateManager.commit(true)
	const block = await blockBuilder.build()
	await Promise.all([receiptsManager.saveReceipts(block, [txResult.receipt]), vm.blockchain.putBlock(block)])
	pool.removeNewBlockTxs([block])
	await syncSimulationVmState({ block, memoryClient, receiptsManager, vm })
	return bytesToHex(block.hash())
}

export async function mineNextSimulationBlock(memoryClient: TevmLikeClient) {
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	await mineSimulationBlockAtTimestamp(memoryClient, getNextSimulationTimestamp(currentTimestamp))
}

export async function advanceSimulationTime(memoryClient: TevmLikeClient, seconds: bigint) {
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	const offset = seconds > 0n ? seconds : SIMULATION_BLOCK_INTERVAL_SECONDS
	await mineSimulationBlockAtTimestamp(memoryClient, currentTimestamp + offset)
}

export async function initializeSimulationClock(memoryClient: TevmLikeClient, initialTimestamp: bigint = SIMULATION_INITIAL_TIMESTAMP) {
	const currentTimestamp = await getSimulationChainTimestamp(memoryClient)
	if (currentTimestamp >= initialTimestamp) return currentTimestamp
	const nextTimestamp = currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS > initialTimestamp ? currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS : initialTimestamp
	await mineSimulationBlockAtTimestamp(memoryClient, nextTimestamp)
	return nextTimestamp
}
