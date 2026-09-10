"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.precompile08 = precompile08;
const util_1 = require("@ethereumjs/util");
const errors_ts_1 = require("../errors.js");
const evm_ts_1 = require("../evm.js");
const index_ts_1 = require("./index.js");
const util_ts_1 = require("./util.js");
function precompile08(opts) {
    const pName = (0, index_ts_1.getPrecompileName)('08');
    if (!(0, util_ts_1.moduloLengthCheck)(opts, 192, pName)) {
        return (0, evm_ts_1.EVMErrorResult)(new errors_ts_1.EVMError(errors_ts_1.EVMError.errorMessages.INVALID_INPUT_LENGTH), opts.gasLimit);
    }
    const inputDataSize = BigInt(Math.floor(opts.data.length / 192));
    const gasUsed = opts.common.param('bn254PairingGas') + inputDataSize * opts.common.param('bn254PairingWordGas');
    if (!(0, util_ts_1.gasLimitCheck)(opts, gasUsed, pName)) {
        return (0, evm_ts_1.OOGResult)(opts.gasLimit);
    }
    let returnData;
    try {
        returnData = opts._EVM['_bn254'].pairing(opts.data);
    }
    catch (e) {
        if (opts._debug !== undefined) {
            opts._debug(`${pName} failed: ${e.message}`);
        }
        return (0, evm_ts_1.EVMErrorResult)(e, opts.gasLimit);
    }
    // check ecpairing success or failure by comparing the output length
    if (returnData.length !== 32) {
        if (opts._debug !== undefined) {
            opts._debug(`${pName} failed: OOG`);
        }
        // TODO: should this really return OOG?
        return (0, evm_ts_1.OOGResult)(opts.gasLimit);
    }
    if (opts._debug !== undefined) {
        opts._debug(`${pName} return value=${(0, util_1.bytesToHex)(returnData)}`);
    }
    return {
        executionGasUsed: gasUsed,
        returnValue: returnData,
    };
}
//# sourceMappingURL=08-bn254-pairing.js.map