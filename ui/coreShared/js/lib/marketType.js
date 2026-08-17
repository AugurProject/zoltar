import { assertNever } from './assert.js';
import * as marketCopy from '../copy/marketType.js';
export function getMarketTypeLabel(marketType) {
    switch (marketType) {
        case 'binary':
            return marketCopy.binary;
        case 'categorical':
            return marketCopy.categorical;
        case 'scalar':
            return marketCopy.scalar;
        default:
            return assertNever(marketType);
    }
}
//# sourceMappingURL=marketType.js.map