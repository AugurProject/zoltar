import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { getOracleLastPriceDisplay, getOraclePriceValidityPresentation } from '../lib/openOracle.js';
export function OpenOraclePriceValue({ currentTimestamp, lastPrice, lastSettlementTimestamp, priceValidUntilTimestamp }) {
    if (lastPrice === undefined || lastSettlementTimestamp === 0n)
        return commonCopy.unavailable;
    const chainCurrentTimestamp = useChainTimestamp();
    const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp;
    const validityPresentation = resolvedCurrentTimestamp === undefined
        ? undefined
        : getOraclePriceValidityPresentation({
            currentTimestamp: resolvedCurrentTimestamp,
            lastSettlementTimestamp,
            priceValidUntilTimestamp,
        });
    return (_jsxs("span", { className: 'oracle-price-value', children: [_jsx("span", { children: getOracleLastPriceDisplay({ lastPrice, lastSettlementTimestamp }) }), validityPresentation === undefined ? null : _jsx("span", { className: `oracle-price-validity ${validityPresentation.tone}`, children: validityPresentation.text })] }));
}
//# sourceMappingURL=OpenOraclePriceValue.js.map