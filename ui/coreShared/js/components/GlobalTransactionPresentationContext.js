import { jsx as _jsx } from "preact/jsx-runtime";
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
const GlobalTransactionPresentationContext = createContext(undefined);
export function GlobalTransactionPresentationProvider({ children, transaction }) {
    return _jsx(GlobalTransactionPresentationContext.Provider, { value: transaction, children: children });
}
export function useGlobalTransactionPresentation() {
    return useContext(GlobalTransactionPresentationContext);
}
export function isPendingGlobalTransactionPresentation(transaction) {
    return transaction?.tone === 'preparing' || transaction?.tone === 'awaiting-wallet' || transaction?.tone === 'pending';
}
//# sourceMappingURL=GlobalTransactionPresentationContext.js.map