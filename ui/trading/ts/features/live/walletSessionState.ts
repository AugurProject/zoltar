import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import type { InjectedEthereum } from '../../protocol/injected.js'

type WalletConnectionFeedback = { route: string; detail: string }

export type WalletSessionState = {
	account: Address | undefined
	walletClient: WalletClient | undefined
	walletProvider: InjectedEthereum | undefined
	/** Last chain the injected wallet reported; kept even when the session refuses the account so the UI can ask for a network switch. */
	walletChainId: number | undefined
	walletContextInvalidated: boolean
	walletSummaryStatus: WalletSummaryState['status']
	walletEthAttoEth: bigint | undefined
	walletRepAttoRep: bigint | undefined
	walletSummaryError: string | undefined
	walletSummaryErrorLabel: string | undefined
	walletSummaryUniverseId: string | undefined
	walletSummaryReceiptNonce: number
	walletConnectionFeedback: WalletConnectionFeedback | undefined
}

export type WalletSessionTransition =
	| { type: 'chainObserved'; chainId: number | undefined }
	| { type: 'identityInvalidated'; detail: string; route: string; universeId: string | undefined }
	| { type: 'connected'; account: Address; provider: InjectedEthereum; universeId: string | undefined; walletClient: WalletClient }
	| { type: 'receiptRefreshRequested'; status: WalletSummaryState['status']; universeId: string | undefined }
	| { type: 'balancesCleared' }
	| { type: 'summaryStatusResolved'; error?: string | undefined; errorLabel?: string | undefined; status: WalletSummaryState['status']; universeId: string | undefined }
	| { type: 'balancesLoaded'; ethAttoEth: bigint; repAttoRep: bigint }
	| { type: 'balancesFailed'; error: string; errorLabel: string }
	| { type: 'routeChanged'; route: string }

export const initialWalletSessionState: WalletSessionState = {
	account: undefined,
	walletClient: undefined,
	walletProvider: undefined,
	walletChainId: undefined,
	walletContextInvalidated: false,
	walletSummaryStatus: 'disconnected',
	walletEthAttoEth: undefined,
	walletRepAttoRep: undefined,
	walletSummaryError: undefined,
	walletSummaryErrorLabel: undefined,
	walletSummaryUniverseId: undefined,
	walletSummaryReceiptNonce: 0,
	walletConnectionFeedback: undefined,
}

function clearedSummary(universeId: string | undefined, status: WalletSummaryState['status']) {
	return { walletEthAttoEth: undefined, walletRepAttoRep: undefined, walletSummaryError: undefined, walletSummaryErrorLabel: undefined, walletSummaryStatus: status, walletSummaryUniverseId: universeId }
}

/** Applies a partial update, keeping the current state object when every field already matches so unchanged transitions do not re-render. */
function patch(state: WalletSessionState, update: Partial<WalletSessionState>): WalletSessionState {
	const current: Record<string, unknown> = state
	const changed = Object.entries(update).some(([key, value]) => current[key] !== value)
	return changed ? { ...state, ...update } : state
}

export function walletSessionReducer(state: WalletSessionState, transition: WalletSessionTransition): WalletSessionState {
	switch (transition.type) {
		case 'chainObserved':
			return patch(state, { walletChainId: transition.chainId })
		case 'identityInvalidated':
			return patch(state, {
				...clearedSummary(transition.universeId, 'disconnected'),
				account: undefined,
				walletClient: undefined,
				walletProvider: undefined,
				walletContextInvalidated: true,
				walletConnectionFeedback: { route: transition.route, detail: transition.detail },
			})
		case 'connected':
			return patch(state, {
				...clearedSummary(transition.universeId, 'loading'),
				account: transition.account,
				walletClient: transition.walletClient,
				walletProvider: transition.provider,
				walletContextInvalidated: false,
				walletConnectionFeedback: undefined,
			})
		case 'receiptRefreshRequested':
			return { ...state, ...clearedSummary(transition.universeId, transition.status), walletSummaryReceiptNonce: state.walletSummaryReceiptNonce + 1 }
		case 'balancesCleared':
			return patch(state, { walletEthAttoEth: undefined, walletRepAttoRep: undefined })
		case 'summaryStatusResolved':
			return patch(state, { walletSummaryStatus: transition.status, walletSummaryError: transition.error, walletSummaryErrorLabel: transition.errorLabel, walletSummaryUniverseId: transition.universeId })
		case 'balancesLoaded':
			return patch(state, { walletEthAttoEth: transition.ethAttoEth, walletRepAttoRep: transition.repAttoRep, walletSummaryStatus: 'ready' })
		case 'balancesFailed':
			return patch(state, { walletSummaryStatus: 'error', walletSummaryError: transition.error, walletSummaryErrorLabel: transition.errorLabel })
		case 'routeChanged':
			return state.walletConnectionFeedback?.route === transition.route ? state : patch(state, { walletConnectionFeedback: undefined })
		default:
			return assertNever(transition)
	}
}
