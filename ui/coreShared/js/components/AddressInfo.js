import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { AddressValue } from './AddressValue.js';
import { MetricField } from './MetricField.js';
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js';
export function AddressInfo({ address, label, unavailableLabel = commonCopy.unknown }) {
    const fallbackLabel = unavailableLabel === commonCopy.unknown ? getMetricPlaceholderPresentation(address)?.placeholder : unavailableLabel;
    return _jsx(MetricField, { label: label, children: address === undefined ? fallbackLabel : _jsx(AddressValue, { address: address }) });
}
//# sourceMappingURL=AddressInfo.js.map