import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as pricingCopy from '@zoltar/ui-core-shared/copy/pricing.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
export function getRepPriceSourceCopy(source) {
    switch (source) {
        case 'mock':
            return {
                badgeLabel: pricingCopy.mock,
                linkTitle: pricingCopy.priceFromTheSimulationMock,
                quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtSimulationPrice,
                quotedRepPerEthLabel: pricingCopy.simulationRepEth,
                tooltip: pricingCopy.simulationPriceSourceDetail,
            };
        case 'v4':
            return {
                badgeLabel: pricingCopy.uniswapV4BadgeLabel,
                linkTitle: pricingCopy.priceFromUniswapV4,
                quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtUniswapV4Price,
                quotedRepPerEthLabel: pricingCopy.uniswapV4RepEth,
                tooltip: pricingCopy.uniswapV4PriceSourceDetail,
            };
        case 'v3':
            return {
                badgeLabel: pricingCopy.uniswapV3BadgeLabel,
                linkTitle: pricingCopy.priceFromUniswapV3,
                quotedCollateralizationLabel: pricingCopy.targetCollateralizationAtUniswapV3Price,
                quotedRepPerEthLabel: pricingCopy.uniswapV3RepEth,
                tooltip: pricingCopy.uniswapV3PriceSourceDetail,
            };
        case undefined:
            return {
                badgeLabel: undefined,
                linkTitle: undefined,
                quotedCollateralizationLabel: pricingCopy.targetCollateralization,
                quotedRepPerEthLabel: commonCopy.repPerEth,
                tooltip: pricingCopy.repPriceUnavailableDetail,
            };
        default:
            return assertNever(source);
    }
}
export function renderRepPriceSourceLabel(source, sourceUrl) {
    const copy = getRepPriceSourceCopy(source);
    if (copy.badgeLabel === undefined)
        return undefined;
    if (sourceUrl === undefined || copy.linkTitle === undefined)
        return pricingCopy.formatWrappedValue(copy.badgeLabel);
    return (_jsx("a", { href: sourceUrl, title: copy.linkTitle, target: '_blank', rel: 'noreferrer', children: pricingCopy.formatWrappedValue(copy.badgeLabel) }));
}
//# sourceMappingURL=repPriceSource.js.map