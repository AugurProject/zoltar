import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { addOpenOracleBountyBuffer } from '../../../protocol/openOracleMath.js';
import { resolveOracleOperationEthFunding } from '../../../protocol/oracleRequestFunding.js';
export { resolveOracleOperationEthFunding };
function getBufferedOracleRequestEthValue(requestPriceCostAttoEth) {
    if (requestPriceCostAttoEth === undefined)
        return undefined;
    return addOpenOracleBountyBuffer(requestPriceCostAttoEth);
}
export function getOracleRequestEthGuardMessage({ actionLabel, includeBuffer = false, requiredCostAttoEth, walletBalanceAttoEth }) {
    const requiredEthValue = includeBuffer ? getBufferedOracleRequestEthValue(requiredCostAttoEth) : requiredCostAttoEth;
    if (requiredEthValue === undefined)
        return undefined;
    if (requiredEthValue === 0n)
        return undefined;
    if (walletBalanceAttoEth === undefined)
        return 'Loading wallet ETH balance.';
    if (walletBalanceAttoEth >= requiredEthValue)
        return undefined;
    return `Need ${formatCurrencyBalance(requiredEthValue - walletBalanceAttoEth)} more ETH in this wallet to ${actionLabel}.`;
}
//# sourceMappingURL=oracleRequestEth.js.map