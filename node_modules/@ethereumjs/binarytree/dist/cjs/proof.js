"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.binaryTreeFromProof = binaryTreeFromProof;
exports.verifyBinaryProof = verifyBinaryProof;
const util_1 = require("@ethereumjs/util");
const constructors_ts_1 = require("./constructors.js");
const index_ts_1 = require("./node/index.js");
/**
 * Saves the nodes from a proof into the tree.
 * @param proof
 */
async function binaryTreeFromProof(proof) {
    const proofTrie = await (0, constructors_ts_1.createBinaryTree)();
    const putStack = proof.map((bytes) => {
        const node = (0, index_ts_1.decodeBinaryNode)(bytes);
        return [proofTrie['merkelize'](node), node];
    });
    await proofTrie.saveStack(putStack);
    const root = putStack[0][0];
    proofTrie.root(root);
    return proofTrie;
}
/**
 * Verifies a proof.
 * @param rootHash
 * @param key
 * @param proof
 * @throws If proof is found to be invalid.
 * @returns The value from the key, or null if valid proof of non-existence.
 */
async function verifyBinaryProof(rootHash, key, proof) {
    const proofTrie = await binaryTreeFromProof(proof);
    if (!(0, util_1.equalsBytes)(proofTrie.root(), rootHash)) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('rootHash does not match proof root');
    }
    const [value] = await proofTrie.get(key.slice(0, 31), [key[31]]);
    const valueNode = (0, index_ts_1.decodeBinaryNode)(proof[proof.length - 1]);
    const expectedValue = valueNode.values[key[31]];
    if (!expectedValue) {
        if (value) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Proof is invalid');
        }
    }
    else if (value && !(0, util_1.equalsBytes)(value, expectedValue)) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Proof is invalid');
    }
    return value;
}
//# sourceMappingURL=proof.js.map