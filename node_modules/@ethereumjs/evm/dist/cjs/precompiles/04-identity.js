"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.precompile04 = precompile04;
const util_1 = require("@ethereumjs/util");
const evm_ts_1 = require("../evm.js");
const index_ts_1 = require("./index.js");
const util_ts_1 = require("./util.js");
function precompile04(opts) {
    const pName = (0, index_ts_1.getPrecompileName)('04');
    const data = opts.data;
    let gasUsed = opts.common.param('identityGas');
    gasUsed += opts.common.param('identityWordGas') * BigInt(Math.ceil(data.length / 32));
    if (!(0, util_ts_1.gasLimitCheck)(opts, gasUsed, pName)) {
        return (0, evm_ts_1.OOGResult)(opts.gasLimit);
    }
    if (opts._debug !== undefined) {
        opts._debug(`${pName} return data=${(0, util_1.short)(opts.data)}`);
    }
    return {
        executionGasUsed: gasUsed,
        returnValue: Uint8Array.from(data), // Copy the memory (`Uint8Array.from()`)
    };
}
//# sourceMappingURL=04-identity.js.map