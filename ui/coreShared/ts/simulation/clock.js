import { bytesToHex, hexToBytes } from '@zoltar/shared/ethereum';
export const SIMULATION_INITIAL_TIMESTAMP = 1735689600n;
export const SIMULATION_BLOCK_INTERVAL_SECONDS = 1n;
function isSimulationNode(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    return 'getReceiptsManager' in value && typeof value.getReceiptsManager === 'function' && 'getTxPool' in value && typeof value.getTxPool === 'function' && 'getVm' in value && typeof value.getVm === 'function';
}
function getSimulationNode(memoryClient) {
    const tevmNode = memoryClient.transport.tevm;
    if (!isSimulationNode(tevmNode))
        throw new Error('Simulation transport did not expose a compatible Tevm node');
    return tevmNode;
}
function requireSimulationTimestamp(timestamp) {
    if (timestamp === undefined)
        throw new Error('Simulation block timestamp was unavailable');
    return timestamp;
}
function requireSimulationTransaction(tx, txHash) {
    if (tx === null)
        throw new Error(`Simulation transaction ${txHash} was not found in the tx pool`);
    return tx;
}
async function syncSimulationVmState({ block, memoryClient, receiptsManager, vm }) {
    const simulationNode = getSimulationNode(memoryClient);
    const originalVm = await simulationNode.getVm();
    const stateRootValue = vm.stateManager._baseState.stateRoots.get(bytesToHex(block.header.stateRoot));
    if (stateRootValue === undefined)
        throw new Error('Simulation state root was not found after mining a block');
    originalVm.stateManager.saveStateRoot(block.header.stateRoot, stateRootValue);
    originalVm.blockchain = vm.blockchain;
    originalVm.evm.blockchain = vm.evm.blockchain;
    receiptsManager.chain = vm.evm.blockchain;
    await originalVm.stateManager.setStateRoot(hexToBytes(vm.stateManager._baseState.getCurrentStateRoot()));
}
export async function getSimulationChainTimestamp(memoryClient) {
    const block = await memoryClient.getBlock();
    return requireSimulationTimestamp(block.timestamp);
}
export function getNextSimulationTimestamp(currentTimestamp) {
    return currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS;
}
async function mineSimulationBlockAtTimestamp(memoryClient, timestamp) {
    const simulationNode = getSimulationNode(memoryClient);
    const receiptsManager = await simulationNode.getReceiptsManager();
    const originalVm = await simulationNode.getVm();
    const vm = await originalVm.deepCopy();
    const parentBlock = await vm.blockchain.getCanonicalHeadBlock();
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
    });
    await vm.stateManager.checkpoint();
    await vm.stateManager.commit(true);
    const block = await blockBuilder.build();
    await Promise.all([receiptsManager.saveReceipts(block, []), vm.blockchain.putBlock(block)]);
    await syncSimulationVmState({ block, memoryClient, receiptsManager, vm });
}
export async function minePendingSimulationTransactionAtTimestamp(memoryClient, txHash, timestamp) {
    const simulationNode = getSimulationNode(memoryClient);
    const pool = await simulationNode.getTxPool();
    const receiptsManager = await simulationNode.getReceiptsManager();
    const originalVm = await simulationNode.getVm();
    const vm = await originalVm.deepCopy();
    const parentBlock = await vm.blockchain.getCanonicalHeadBlock();
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
    });
    const tx = requireSimulationTransaction(pool.getByHash(txHash), txHash);
    pool.removeByHash(txHash);
    const txResult = await blockBuilder.addTransaction(tx, {
        skipBalance: true,
        skipHardForkValidation: true,
        skipNonce: true,
    });
    await vm.stateManager.checkpoint();
    await vm.stateManager.commit(true);
    const block = await blockBuilder.build();
    await Promise.all([receiptsManager.saveReceipts(block, [txResult.receipt]), vm.blockchain.putBlock(block)]);
    pool.removeNewBlockTxs([block]);
    await syncSimulationVmState({ block, memoryClient, receiptsManager, vm });
    return bytesToHex(block.hash());
}
export async function mineNextSimulationBlock(memoryClient) {
    const currentTimestamp = await getSimulationChainTimestamp(memoryClient);
    await mineSimulationBlockAtTimestamp(memoryClient, getNextSimulationTimestamp(currentTimestamp));
}
export async function advanceSimulationTime(memoryClient, seconds) {
    const currentTimestamp = await getSimulationChainTimestamp(memoryClient);
    const offset = seconds > 0n ? seconds : SIMULATION_BLOCK_INTERVAL_SECONDS;
    await mineSimulationBlockAtTimestamp(memoryClient, currentTimestamp + offset);
}
export async function initializeSimulationClock(memoryClient, initialTimestamp = SIMULATION_INITIAL_TIMESTAMP) {
    const currentTimestamp = await getSimulationChainTimestamp(memoryClient);
    if (currentTimestamp >= initialTimestamp)
        return currentTimestamp;
    const nextTimestamp = currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS > initialTimestamp ? currentTimestamp + SIMULATION_BLOCK_INTERVAL_SECONDS : initialTimestamp;
    await mineSimulationBlockAtTimestamp(memoryClient, nextTimestamp);
    return nextTimestamp;
}
//# sourceMappingURL=clock.js.map