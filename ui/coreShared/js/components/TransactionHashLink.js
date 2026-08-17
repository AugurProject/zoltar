import { jsx as _jsx } from "preact/jsx-runtime";
import * as transactionCopy from '../copy/transaction.js';
import { getActiveNetworkProfile } from '../lib/activeEnvironment.js';
import { buildTransactionExplorerUrl } from '../lib/networkProfile.js';
export function TransactionHashLink({ hash }) {
    const transactionUrl = buildTransactionExplorerUrl(getActiveNetworkProfile(), hash);
    if (transactionUrl === undefined)
        return _jsx("span", { className: 'transaction-hash-link', children: hash });
    return (_jsx("a", { className: 'transaction-hash-link', href: transactionUrl, target: '_blank', rel: 'noreferrer', title: transactionCopy.viewTransaction, children: hash }));
}
//# sourceMappingURL=TransactionHashLink.js.map