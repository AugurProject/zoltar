import { createContext, type ComponentChildren } from 'preact'
import { useContext } from 'preact/hooks'
import type { GlobalTransactionPresentation } from '../types/components.js'

const GlobalTransactionPresentationContext = createContext<GlobalTransactionPresentation | undefined>(undefined)

export function GlobalTransactionPresentationProvider({ children, transaction }: { children: ComponentChildren; transaction: GlobalTransactionPresentation | undefined }) {
	return <GlobalTransactionPresentationContext.Provider value={transaction}>{children}</GlobalTransactionPresentationContext.Provider>
}

export function useGlobalTransactionPresentation() {
	return useContext(GlobalTransactionPresentationContext)
}

export function isPendingGlobalTransactionPresentation(transaction: GlobalTransactionPresentation | undefined) {
	return transaction?.tone === 'preparing' || transaction?.tone === 'awaiting-wallet' || transaction?.tone === 'pending'
}
