"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dumpNodeHashes = exports.dumpLeafValues = void 0;
const util_1 = require("@ethereumjs/util");
const internalNode_ts_1 = require("./node/internalNode.js");
const stemNode_ts_1 = require("./node/stemNode.js");
const util_ts_1 = require("./node/util.js");
/**
 * Recursively walks down the tree from a given starting node and returns all the leaf values
 * @param tree - The binary tree
 * @param startingNode - The starting node
 * @returns An array of key-value pairs containing the tree keys and associated values
 */
const dumpLeafValues = async (tree, startingNode) => {
    if ((0, util_1.equalsBytes)(startingNode, tree.EMPTY_TREE_ROOT) === true)
        return;
    // Retrieve starting node from DB
    const rawNode = await tree['_db'].get(startingNode);
    if (rawNode === undefined)
        return;
    const node = (0, util_ts_1.decodeBinaryNode)(rawNode);
    const entries = [];
    if (node instanceof stemNode_ts_1.StemBinaryNode) {
        for (const [idx, val] of node.values.entries()) {
            if (val !== null) {
                entries.push([(0, util_1.bytesToHex)((0, util_1.concatBytes)(node.stem, Uint8Array.from([idx]))), (0, util_1.bytesToHex)(val)]);
            }
        }
        return entries;
    }
    else {
        const childPaths = node.children
            .filter((value) => value !== null)
            .map((value) => (0, exports.dumpLeafValues)(tree, value.hash));
        const res = (await Promise.all(childPaths)).filter((val) => val !== undefined);
        return res.flat(1);
    }
};
exports.dumpLeafValues = dumpLeafValues;
/**
 * Recursively walks down the tree from a given starting node and returns all the node paths and hashes
 * @param tree - The binary tree
 * @param startingNode - The starting node
 * @returns An array of key-value pairs containing the tree paths and associated hashes
 */
const dumpNodeHashes = async (tree, startingNode) => {
    let entries = [];
    // Retrieve starting node from DB
    const rawNode = await tree['_db'].get(startingNode);
    if (rawNode === undefined)
        return;
    const node = (0, util_ts_1.decodeBinaryNode)(rawNode);
    // If current node is root, push '0x' for path and node hash for commitment
    (0, util_1.equalsBytes)(startingNode, tree.root()) && entries.push(['0x', (0, util_1.bytesToHex)(startingNode)]);
    if (node instanceof internalNode_ts_1.InternalBinaryNode) {
        const children = node.children.filter((value) => value !== null);
        // Push non-null children paths and hashes
        for (const child of children) {
            entries.push([child.path.join(''), (0, util_1.bytesToHex)(child.hash)]);
        }
        // Recursively call dumpNodeHashes on each child node
        const childPaths = (await Promise.all(children.map((value) => (0, exports.dumpNodeHashes)(tree, value.hash))))
            .filter((val) => val !== undefined)
            .flat(1);
        // Add all child paths and hashes to entries
        entries = [...entries, ...childPaths];
    }
    return entries;
};
exports.dumpNodeHashes = dumpNodeHashes;
//# sourceMappingURL=util.js.map