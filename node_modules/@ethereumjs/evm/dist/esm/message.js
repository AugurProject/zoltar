import { BIGINT_0, EthereumJSErrorWithoutCode, createZeroAddress } from '@ethereumjs/util';
const defaults = {
    value: BIGINT_0,
    caller: createZeroAddress(),
    data: new Uint8Array(0),
    depth: 0,
    isStatic: false,
    isCompiled: false,
    delegatecall: false,
    gasRefund: BIGINT_0,
};
export class Message {
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
            throw EthereumJSErrorWithoutCode(`value field cannot be negative, received ${this.value}`);
        }
    }
    /**
     * Note: should only be called in instances where `_codeAddress` or `to` is defined.
     */
    get codeAddress() {
        const codeAddress = this._codeAddress ?? this.to;
        if (!codeAddress) {
            throw EthereumJSErrorWithoutCode('Missing codeAddress');
        }
        return codeAddress;
    }
}
//# sourceMappingURL=message.js.map