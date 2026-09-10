import { short } from '@ethereumjs/util';
import { OOGResult } from "../evm.js";
import { getPrecompileName } from "./index.js";
import { gasLimitCheck } from "./util.js";
export function precompile04(opts) {
    const pName = getPrecompileName('04');
    const data = opts.data;
    let gasUsed = opts.common.param('identityGas');
    gasUsed += opts.common.param('identityWordGas') * BigInt(Math.ceil(data.length / 32));
    if (!gasLimitCheck(opts, gasUsed, pName)) {
        return OOGResult(opts.gasLimit);
    }
    if (opts._debug !== undefined) {
        opts._debug(`${pName} return data=${short(opts.data)}`);
    }
    return {
        executionGasUsed: gasUsed,
        returnValue: Uint8Array.from(data), // Copy the memory (`Uint8Array.from()`)
    };
}
//# sourceMappingURL=04-identity.js.map