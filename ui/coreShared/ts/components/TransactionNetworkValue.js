import { Fragment as _Fragment, jsx as _jsx } from "preact/jsx-runtime";
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js';
import { formatTransactionNetworkLabel } from '../lib/networkProfile.js';
export function TransactionNetworkValue() {
    return _jsx(_Fragment, { children: formatTransactionNetworkLabel(getActiveNetworkProfile()) });
}
//# sourceMappingURL=TransactionNetworkValue.js.map