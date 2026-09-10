"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBinaryExecutionWitness = exports.BinaryTreeAccessWitness = void 0;
exports.decodeBinaryAccessState = decodeBinaryAccessState;
const common_1 = require("@ethereumjs/common");
const util_1 = require("@ethereumjs/util");
const debug_1 = require("debug");
const chunkCache_ts_1 = require("./chunkCache.js");
const stemCache_ts_1 = require("./stemCache.js");
const debug = (0, debug_1.default)('evm:binaryTree:aw');
/**
 * Tree key constants.
 */
const WitnessBranchReadCost = BigInt(1900);
const WitnessChunkReadCost = BigInt(200);
const WitnessBranchWriteCost = BigInt(3000);
const WitnessChunkWriteCost = BigInt(500);
const WitnessChunkFillCost = BigInt(6200);
function decodeBinaryAccessState(treeIndex, chunkIndex) {
    const position = BigInt(treeIndex) * BigInt(util_1.BINARY_TREE_NODE_WIDTH) + BigInt(chunkIndex);
    switch (position) {
        case BigInt(0):
            return { type: common_1.BinaryTreeAccessedStateType.BasicData };
        case BigInt(1):
            return { type: common_1.BinaryTreeAccessedStateType.CodeHash };
        default:
            if (position < util_1.BINARY_TREE_HEADER_STORAGE_OFFSET) {
                throw Error(`No attribute yet stored >=2 and <${util_1.BINARY_TREE_HEADER_STORAGE_OFFSET}`);
            }
            if (position >= util_1.BINARY_TREE_HEADER_STORAGE_OFFSET && position < util_1.BINARY_TREE_CODE_OFFSET) {
                const slot = position - BigInt(util_1.BINARY_TREE_HEADER_STORAGE_OFFSET);
                return { type: common_1.BinaryTreeAccessedStateType.Storage, slot };
            }
            else if (position >= util_1.BINARY_TREE_CODE_OFFSET &&
                position < util_1.BINARY_TREE_MAIN_STORAGE_OFFSET) {
                const codeChunkIdx = Number(position) - util_1.BINARY_TREE_CODE_OFFSET;
                return {
                    type: common_1.BinaryTreeAccessedStateType.Code,
                    codeOffset: codeChunkIdx * 31,
                };
            }
            else if (position >= util_1.BINARY_TREE_MAIN_STORAGE_OFFSET) {
                const slot = BigInt(position - util_1.BINARY_TREE_MAIN_STORAGE_OFFSET);
                return { type: common_1.BinaryTreeAccessedStateType.Storage, slot };
            }
            else {
                throw Error(`Invalid treeIndex=${treeIndex} chunkIndex=${chunkIndex} for binary tree access`);
            }
    }
}
class BinaryTreeAccessWitness {
    constructor(opts) {
        this.stemCache = new stemCache_ts_1.StemCache();
        this.chunkCache = new chunkCache_ts_1.ChunkCache();
        this.hashFunction = opts.hashFunction;
        this.stems = opts.stems ?? new Map();
        this.chunks = opts.chunks ?? new Map();
    }
    readAccountBasicData(address) {
        return this.touchAddressOnReadAndComputeGas(address, 0, util_1.BINARY_TREE_BASIC_DATA_LEAF_KEY);
    }
    writeAccountBasicData(address) {
        return this.touchAddressOnWriteAndComputeGas(address, 0, util_1.BINARY_TREE_BASIC_DATA_LEAF_KEY);
    }
    readAccountCodeHash(address) {
        return this.touchAddressOnReadAndComputeGas(address, 0, util_1.BINARY_TREE_CODE_HASH_LEAF_KEY);
    }
    writeAccountCodeHash(address) {
        return this.touchAddressOnWriteAndComputeGas(address, 0, util_1.BINARY_TREE_CODE_HASH_LEAF_KEY);
    }
    readAccountHeader(address) {
        let gas = util_1.BIGINT_0;
        gas += this.readAccountBasicData(address);
        gas += this.readAccountCodeHash(address);
        return gas;
    }
    writeAccountHeader(address) {
        let gas = util_1.BIGINT_0;
        gas += this.writeAccountBasicData(address);
        gas += this.writeAccountCodeHash(address);
        return gas;
    }
    readAccountCodeChunks(contract, startPc, endPc) {
        let gas = util_1.BIGINT_0;
        for (let chunkNum = Math.floor(startPc / 31); chunkNum <= Math.floor(endPc / 31); chunkNum++) {
            const { treeIndex, subIndex } = (0, util_1.getBinaryTreeIndicesForCodeChunk)(chunkNum);
            gas += this.touchAddressOnReadAndComputeGas(contract, treeIndex, subIndex);
        }
        return gas;
    }
    writeAccountCodeChunks(contract, startPc, endPc) {
        let gas = util_1.BIGINT_0;
        for (let chunkNum = Math.floor(startPc / 31); chunkNum <= Math.floor(endPc / 31); chunkNum++) {
            const { treeIndex, subIndex } = (0, util_1.getBinaryTreeIndicesForCodeChunk)(chunkNum);
            gas += this.touchAddressOnWriteAndComputeGas(contract, treeIndex, subIndex);
        }
        return gas;
    }
    readAccountStorage(address, storageSlot) {
        const { treeIndex, subIndex } = (0, util_1.getBinaryTreeIndicesForStorageSlot)(storageSlot);
        return this.touchAddressOnReadAndComputeGas(address, treeIndex, subIndex);
    }
    writeAccountStorage(address, storageSlot) {
        const { treeIndex, subIndex } = (0, util_1.getBinaryTreeIndicesForStorageSlot)(storageSlot);
        return this.touchAddressOnWriteAndComputeGas(address, treeIndex, subIndex);
    }
    touchAddressOnWriteAndComputeGas(address, treeIndex, subIndex) {
        return this.touchAddressAndComputeGas(address, treeIndex, subIndex, {
            isWrite: true,
        });
    }
    touchAddressOnReadAndComputeGas(address, treeIndex, subIndex) {
        return this.touchAddressAndComputeGas(address, treeIndex, subIndex, {
            isWrite: false,
        });
    }
    touchAddressAndComputeGas(address, treeIndex, subIndex, { isWrite }) {
        let gas = util_1.BIGINT_0;
        const { stemRead, stemWrite, chunkRead, chunkWrite, chunkFill } = this.touchAddress(address, treeIndex, subIndex, { isWrite });
        if (stemRead === true) {
            gas += WitnessBranchReadCost;
        }
        if (stemWrite === true) {
            gas += WitnessBranchWriteCost;
        }
        if (chunkRead === true) {
            gas += WitnessChunkReadCost;
        }
        if (chunkWrite === true) {
            gas += WitnessChunkWriteCost;
        }
        if (chunkFill === true) {
            gas += WitnessChunkFillCost;
        }
        debug(`touchAddressAndComputeGas=${gas} address=${address} treeIndex=${treeIndex} subIndex=${subIndex}`);
        return gas;
    }
    touchAddress(address, treeIndex, subIndex, { isWrite } = {}) {
        let stemRead = false, stemWrite = false, chunkRead = false, chunkWrite = false;
        // currently there are no gas charges for setting the chunk for the first time
        // i.e. no fill cost is charged right now
        const chunkFill = false;
        const accessedStemKey = (0, util_1.getBinaryTreeStem)(this.hashFunction, address, treeIndex);
        const accessedStemHex = (0, util_1.bytesToHex)(accessedStemKey);
        let accessedStem = this.stemCache.get(accessedStemHex) ?? this.stems.get(accessedStemHex);
        if (accessedStem === undefined) {
            stemRead = true;
            accessedStem = { address, treeIndex };
            this.stemCache.set(accessedStemHex, accessedStem);
        }
        const accessedChunkKey = (0, util_1.getBinaryTreeKey)(accessedStemKey, typeof subIndex === 'number' ? (0, util_1.intToBytes)(subIndex) : subIndex);
        const accessedChunkKeyHex = (0, util_1.bytesToHex)(accessedChunkKey);
        let accessedChunk = this.chunkCache.get(accessedChunkKeyHex) ?? this.chunks.get(accessedChunkKeyHex);
        if (accessedChunk === undefined) {
            chunkRead = true;
            accessedChunk = {};
            this.chunkCache.set(accessedChunkKeyHex, accessedChunk);
        }
        if (isWrite === true) {
            if (accessedStem.write !== true) {
                stemWrite = true;
                // this would also directly modify in the map
                accessedStem.write = true;
            }
            if (accessedChunk.write !== true) {
                chunkWrite = true;
                // this would also directly modify in the map
                accessedChunk.write = true;
            }
        }
        debug(`${accessedChunkKeyHex}: isWrite=${isWrite} for stemRead=${stemRead} stemWrite=${stemWrite} chunkRead=${chunkRead} chunkWrite=${chunkWrite} chunkFill=${chunkFill}`);
        return { stemRead, stemWrite, chunkRead, chunkWrite, chunkFill };
    }
    merge(accessWitness) {
        for (const [chunkKey, chunkValue] of accessWitness.chunks.entries()) {
            const stemKey = chunkKey.slice(0, chunkKey.length - 2);
            const stem = accessWitness.stems.get(stemKey);
            if (stem === undefined) {
                throw Error(`Internal error: missing stem for the chunkKey=${chunkKey}`);
            }
            const thisStem = this.stems.get(stemKey);
            if (thisStem === undefined) {
                this.stems.set(stemKey, stem);
            }
            else {
                thisStem.write = thisStem.write !== true ? stem.write : true;
            }
            const thisChunk = this.chunks.get(chunkKey);
            if (thisChunk === undefined) {
                this.chunks.set(chunkKey, chunkValue);
            }
            else {
                thisChunk.write = thisChunk.write !== true ? chunkValue.write : true;
                thisChunk.fill = thisChunk.fill !== true ? thisChunk.fill : true;
            }
        }
    }
    commit() {
        const cachedStems = this.stemCache.commit();
        for (const [stemKey, stemValue] of cachedStems) {
            this.stems.set(stemKey, stemValue);
        }
        const cachedChunks = this.chunkCache.commit();
        for (const [chunkKey, chunkValue] of cachedChunks) {
            this.chunks.set(chunkKey, chunkValue);
        }
    }
    revert() {
        this.stemCache.clear();
        this.chunkCache.clear();
    }
    debugWitnessCost() {
        // Calculate the aggregate gas cost for binary access witness per type
        let stemReads = 0, stemWrites = 0, chunkReads = 0, chunkWrites = 0;
        for (const [_, { write }] of this.stems.entries()) {
            stemReads++;
            if (write === true) {
                stemWrites++;
            }
        }
        for (const [_, { write }] of this.chunks.entries()) {
            chunkReads++;
            if (write === true) {
                chunkWrites++;
            }
        }
        debug(`${stemReads} stem reads, totalling ${BigInt(stemReads) * WitnessBranchReadCost} gas units`);
        debug(`${stemWrites} stem writes, totalling ${BigInt(stemWrites) * WitnessBranchWriteCost} gas units`);
        debug(`${chunkReads} chunk reads, totalling ${BigInt(chunkReads) * WitnessChunkReadCost} gas units`);
        debug(`${chunkWrites} chunk writes, totalling ${BigInt(chunkWrites) * WitnessChunkWriteCost} gas units`);
    }
    *rawAccesses() {
        for (const chunkKey of this.chunks.keys()) {
            // drop the last byte
            const stemKey = chunkKey.slice(0, chunkKey.length - 2);
            const stem = this.stems.get(stemKey);
            if (stem === undefined) {
                throw Error(`Internal error: missing stem for the chunkKey=${chunkKey}`);
            }
            const { address, treeIndex } = stem;
            const chunkIndex = Number(`0x${chunkKey.slice(chunkKey.length - 2)}`);
            const accessedState = { address, treeIndex, chunkIndex, chunkKey };
            yield accessedState;
        }
    }
    *accesses() {
        for (const rawAccess of this.rawAccesses()) {
            const { address, treeIndex, chunkIndex, chunkKey } = rawAccess;
            const accessedState = decodeBinaryAccessState(treeIndex, chunkIndex);
            yield { ...accessedState, address, chunkKey };
        }
    }
}
exports.BinaryTreeAccessWitness = BinaryTreeAccessWitness;
/**
 * Generate a {@link BinaryTreeExecutionWitness} from a state manager and an access witness.
 * @param stateManager - The state manager containing the state to generate the witness for.
 * @param accessWitness - The access witness containing the accessed states.
 * @param parentStateRoot - The parent state root (i.e. prestate root) to generate the witness for.
 * @returns The generated binary tree execution witness
 */
const generateBinaryExecutionWitness = async (stateManager, accessWitness, parentStateRoot) => {
    const tree = stateManager['_tree'];
    await tree['_lock'].acquire();
    const postStateRoot = await stateManager.getStateRoot();
    const ew = {
        stateDiff: [],
        parentStateRoot: (0, util_1.bytesToHex)(parentStateRoot),
        proof: undefined, // Binary proofs are not implemented
    };
    // Generate a map of all stems with their accessed suffixes
    const accessedSuffixes = new Map();
    for (const chunkKey of accessWitness['chunks'].keys()) {
        const stem = chunkKey.slice(0, 64);
        if (accessedSuffixes.has(stem)) {
            const suffixes = accessedSuffixes.get(stem);
            suffixes.push(parseInt(chunkKey.slice(64), 16));
            accessedSuffixes.set(stem, suffixes);
        }
        else {
            accessedSuffixes.set(stem, [parseInt(chunkKey.slice(64), 16)]);
        }
    }
    // Get values from the tree for each stem and suffix
    for (const stem of accessedSuffixes.keys()) {
        tree.root(parentStateRoot);
        const suffixes = accessedSuffixes.get(stem);
        if (suffixes === undefined || suffixes.length === 0)
            continue;
        const currentValues = await tree.get((0, util_1.hexToBytes)(stem), suffixes);
        tree.root(postStateRoot);
        const newValues = await tree.get((0, util_1.hexToBytes)(stem), suffixes);
        const stemStateDiff = [];
        for (let x = 0; x < suffixes.length; x++) {
            // skip if both are the same
            const currentValue = currentValues[x];
            const newValue = newValues[x];
            if (currentValue instanceof Uint8Array &&
                newValue instanceof Uint8Array &&
                (0, util_1.equalsBytes)(currentValue, newValue))
                continue;
            stemStateDiff.push({
                suffix: suffixes[x],
                currentValue: currentValue ? (0, util_1.bytesToHex)(currentValue) : null,
                newValue: newValue ? (0, util_1.bytesToHex)(newValue) : null,
            });
        }
        ew.stateDiff.push({ stem, suffixDiffs: stemStateDiff });
    }
    tree['_lock'].release();
    return ew;
};
exports.generateBinaryExecutionWitness = generateBinaryExecutionWitness;
//# sourceMappingURL=binaryTreeAccessWitness.js.map