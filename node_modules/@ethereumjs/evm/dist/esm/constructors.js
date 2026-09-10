import { Common, Mainnet } from '@ethereumjs/common';
import { SimpleStateManager } from '@ethereumjs/statemanager';
import { EVM } from "./index.js";
import { NobleBN254 } from "./precompiles/index.js";
import { EVMMockBlockchain } from "./types.js";
/**
 * Use this async static constructor for the initialization
 * of an EVM object
 *
 * @param createOpts The EVM options
 * @returns A new EVM
 */
export async function createEVM(createOpts) {
    const opts = createOpts ?? {};
    opts.bn254 = new NobleBN254();
    if (opts.common === undefined) {
        opts.common = new Common({ chain: Mainnet });
    }
    if (opts.blockchain === undefined) {
        opts.blockchain = new EVMMockBlockchain();
    }
    if (opts.stateManager === undefined) {
        opts.stateManager = new SimpleStateManager();
    }
    return new EVM(opts);
}
//# sourceMappingURL=constructors.js.map