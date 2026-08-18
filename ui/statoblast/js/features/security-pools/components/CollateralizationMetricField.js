import { jsxs as _jsxs, jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as pricingCopy from '@zoltar/ui-core-shared/copy/pricing.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { getRepPriceSourceCopy, renderRepPriceSourceLabel } from '@zoltar/ui-zoltar/features/open-oracle/lib/repPriceSource.js';
import { getCollateralizationDisplayState, getCollateralizationTone } from '../../markets/lib/trading.js';
function getDefaultLabel(repPerEthSource, repPerEthSourceUrl) {
    const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource);
    return (_jsxs("span", { title: repPriceSourceCopy.tooltip, children: [`${pricingCopy.collateralizationLabel} `, renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)] }));
}
export function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, capacityOwnershipAttoRep, statoblastSecurityMultiplierBps, unavailableCopy = pricingCopy.awaitingRepEthPrice }) {
    const displayState = getCollateralizationDisplayState(capacityOwnershipAttoRep, collateralizationPercent);
    const tone = displayState === 'noActiveCapacityOwnership' ? undefined : getCollateralizationTone(collateralizationPercent, statoblastSecurityMultiplierBps);
    const valueClassName = (() => {
        if (tone === 'success')
            return 'metric-value-success';
        if (tone === 'danger')
            return 'metric-value-danger';
        return undefined;
    })();
    return (_jsx(MetricField, { className: className, label: label ?? getDefaultLabel(repPerEthSource, repPerEthSourceUrl), valueClassName: valueClassName, children: (() => {
            if (displayState === 'noActiveCapacityOwnership')
                return pricingCopy.noActiveCapacityOwnership;
            if (displayState === 'unavailable')
                return unavailableCopy;
            return _jsx(CurrencyValue, { value: collateralizationPercent, suffix: commonCopy.percent, copyable: false });
        })() }));
}
//# sourceMappingURL=CollateralizationMetricField.js.map