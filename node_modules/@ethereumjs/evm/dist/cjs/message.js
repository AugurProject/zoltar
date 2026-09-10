"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
const util_1 = require("@ethereumjs/util");
const defaults = {
    value: util_1.BIGINT_0,
    caller: (0, util_1.createZeroAddress)(),
    data: new Uint8Array(0),
    depth: 0,
    isStatic: false,
    isCompiled: false,
    delegatecall: false,
    gasRefund: util_1.BIGINT_0,
};
class Message {
    constructor(opts) {
        this.to = opts.to;
        this.value = opts.value ?? defaults.value;
        this.caller = opts.caller ?? defaults.caller;
        this.gasLimit = opts.gasLimit;
        this.data = opts.data ?? defaults.data;
        this.eofCallData = opts.eofCallData;
        this.depth = opts.depth ?? defaults.depth;
        this.code = opts.code;
        this._codeAddress = opts.codeAddress;
        this.isStatic = opts.isStatic ?? defaults.isStatic;
        this.isCompiled = opts.isCompiled ?? defaults.isCompiled;
        this.salt = opts.salt;
        this.selfdestruct = opts.selfdestruct;
        this.createdAddresses = opts.createdAddresses;
        this.delegatecall = opts.delegatecall ?? defaults.delegatecall;
        this.gasRefund = opts.gasRefund ?? defaults.gasRefund;
        this.blobVersionedHashes = opts.blobVersionedHashes;
        this.accessWitness = opts.accessWitness;
        if (this.value < 0) {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`value field cannot be negative, received ${this.value}`);
        }
    }
    /**
     * Note: should only be called in instances where `_codeAddress` or `to` is defined.
     */
    get codeAddress() {
        const codeAddress = this._codeAddress ?? this.to;
        if (!codeAddress) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Missing codeAddress');
        }
        return codeAddress;
    }
}
exports.Message = Message;
//# sourceMappingURL=message.js.map