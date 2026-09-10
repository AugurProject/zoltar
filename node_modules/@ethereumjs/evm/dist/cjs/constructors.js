"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEVM = createEVM;
const common_1 = require("@ethereumjs/common");
const statemanager_1 = require("@ethereumjs/statemanager");
const index_ts_1 = require("./index.js");
const index_ts_2 = require("./precompiles/index.js");
const types_ts_1 = require("./types.js");
/**
 * Use this async static constructor for the initialization
 * of an EVM object
 *
 * @param createOpts The EVM options
 * @returns A new EVM
 */
async function createEVM(createOpts) {
    const opts = createOpts ?? {};
    opts.bn254 = new index_ts_2.NobleBN254();
    if (opts.common === undefined) {
        opts.common = new common_1.Common({ chain: common_1.Mainnet });
    }
    if (opts.blockchain === undefined) {
        opts.blockchain = new types_ts_1.EVMMockBlockchain();
    }
    if (opts.stateManager === undefined) {
        opts.stateManager = new statemanager_1.SimpleStateManager();
    }
    return new index_ts_1.EVM(opts);
}
//# sourceMappingURL=constructors.js.map