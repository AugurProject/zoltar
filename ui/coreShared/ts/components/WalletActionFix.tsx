import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import { createContext } from 'preact'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'
import type { ComponentChildren, RefObject } from 'preact'
import { getActionAvailabilityReason } from '../transactions/actionGuards.js'
import type { ActionAvailability, WalletActionBlocker } from '../types/components.js'
import { LoadingText } from './LoadingText.js'

/** The application's wallet session controls, shared with the header so blocked actions can offer the same connect and switch fixes. */
export type WalletActions = {
	isConnectingWallet: boolean
	isManagingWallet: boolean
	onConnect: () => void
	onSwitchNetwork: () => void
}

const WalletActionsContext = createContext<WalletActions | undefined>(undefined)

export function WalletActionsProvider({ children, walletActions }: { children: ComponentChildren; walletActions: WalletActions | undefined }) {
	return <WalletActionsContext.Provider value={walletActions}>{children}</WalletActionsContext.Provider>
}

function getWalletActionFixLabel(blocker: WalletActionBlocker) {
	return blocker.kind === 'wallet-disconnected' ? commonCopy.connectWallet : appCopy.formatSwitchToNetwork(blocker.targetChainName)
}

/**
 * Resolves the connect or switch fix for an action its wallet blocks. Returns undefined without wallet actions in context
 * (for example Trading or isolated component tests) so the action keeps its text reason. After the fix resolves the blocker,
 * focus returns to the action it unblocked.
 */
export function useWalletActionFix({ actionButtonRef, actionDisabled, availability }: { actionButtonRef: RefObject<HTMLButtonElement>; actionDisabled: boolean; availability: ActionAvailability | undefined }) {
	const walletActions = useContext(WalletActionsContext)
	const availabilityReason = getActionAvailabilityReason(availability)
	const blocker = walletActions === undefined || availabilityReason === undefined || availabilityReason.kind === 'other' ? undefined : availabilityReason
	const fixButtonRef = useRef<HTMLButtonElement>(null)
	const restoreFocus = useRef(false)
	const pending = walletActions !== undefined && blocker !== undefined && (blocker.kind === 'wallet-disconnected' ? walletActions.isConnectingWallet || walletActions.isManagingWallet : walletActions.isManagingWallet)
	const blockerKind = blocker?.kind
	useLayoutEffect(() => {
		// The fix button is disabled while the wallet request is pending, so focus falls back to the page; return it to the next control once the request settles.
		// An unblocked action may still wait for data that loads after connecting, so focus waits until it is enabled.
		if (pending || !restoreFocus.current || (blockerKind === undefined && actionDisabled)) return
		restoreFocus.current = false
		if (document.activeElement !== null && document.activeElement !== document.body) return
		const nextFocus = blockerKind === undefined ? actionButtonRef.current : fixButtonRef.current
		nextFocus?.focus()
	}, [actionButtonRef, actionDisabled, blockerKind, pending])
	if (walletActions === undefined || blocker === undefined) return undefined
	const label = getWalletActionFixLabel(blocker)
	return (id: string) => (
		<button
			aria-busy={pending}
			className='secondary tx-action-wallet-fix'
			disabled={pending}
			id={id}
			ref={fixButtonRef}
			type='button'
			onClick={() => {
				restoreFocus.current = true
				if (blocker.kind === 'wallet-disconnected') walletActions.onConnect()
				else walletActions.onSwitchNetwork()
			}}
		>
			{pending ? <LoadingText>{blocker.kind === 'wallet-disconnected' ? appCopy.connecting : appCopy.managingWallet}</LoadingText> : label}
		</button>
	)
}
