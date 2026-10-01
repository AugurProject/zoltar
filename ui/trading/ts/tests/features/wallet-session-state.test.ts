import { describe, expect, test } from 'bun:test'
import { createWalletClient, custom } from '@zoltar/core-shared/evm/ethereum'
import type { InjectedEthereum } from '../../protocol/injected.js'
import { initialWalletSessionState, walletSessionReducer, type WalletSessionState } from '../../features/live/walletSessionState.js'

const account = '0x1111111111111111111111111111111111111111'
const provider: InjectedEthereum = { request: async () => undefined }
const walletClient = createWalletClient({ account, transport: custom(provider) })

function connectedState(): WalletSessionState {
	return walletSessionReducer({ ...initialWalletSessionState, walletContextInvalidated: true, walletConnectionFeedback: { detail: 'Reconnecting wallet…', route: '#/markets' } }, { type: 'connected', account, provider, universeId: '7', walletClient })
}

describe('wallet session transitions', () => {
	test('connecting records the wallet identity and restarts the balance summary', () => {
		const state = connectedState()
		expect(state.account).toBe(account)
		expect(state.walletProvider).toBe(provider)
		expect(state.walletClient).toBe(walletClient)
		expect(state.walletContextInvalidated).toBeFalse()
		expect(state.walletConnectionFeedback).toBeUndefined()
		expect(state.walletSummaryStatus).toBe('loading')
		expect(state.walletSummaryUniverseId).toBe('7')
	})

	test('invalidating the identity disconnects the wallet but keeps the observed chain', () => {
		const loaded = walletSessionReducer(walletSessionReducer(connectedState(), { type: 'chainObserved', chainId: 11155111 }), { type: 'balancesLoaded', ethAttoEth: 1n, repAttoRep: 2n })
		const state = walletSessionReducer(loaded, { type: 'identityInvalidated', detail: 'Wallet account changed', route: '#/markets', universeId: '7' })
		expect(state.account).toBeUndefined()
		expect(state.walletClient).toBeUndefined()
		expect(state.walletProvider).toBeUndefined()
		expect(state.walletChainId).toBe(11155111)
		expect(state.walletEthAttoEth).toBeUndefined()
		expect(state.walletRepAttoRep).toBeUndefined()
		expect(state.walletSummaryStatus).toBe('disconnected')
		expect(state.walletContextInvalidated).toBeTrue()
		expect(state.walletConnectionFeedback).toEqual({ detail: 'Wallet account changed', route: '#/markets' })
	})

	test('a receipt refresh clears the summary and bumps the receipt nonce', () => {
		const loaded = walletSessionReducer(connectedState(), { type: 'balancesLoaded', ethAttoEth: 1n, repAttoRep: 2n })
		const state = walletSessionReducer(loaded, { type: 'receiptRefreshRequested', status: 'loading', universeId: '8' })
		expect(state.walletEthAttoEth).toBeUndefined()
		expect(state.walletRepAttoRep).toBeUndefined()
		expect(state.walletSummaryStatus).toBe('loading')
		expect(state.walletSummaryUniverseId).toBe('8')
		expect(state.walletSummaryReceiptNonce).toBe(loaded.walletSummaryReceiptNonce + 1)
	})

	test('summary resolutions replace the status, error, and label together', () => {
		const failed = walletSessionReducer(connectedState(), { type: 'balancesFailed', error: 'read failed', errorLabel: 'Wallet balance read failed' })
		expect(failed.walletSummaryStatus).toBe('error')
		const resolved = walletSessionReducer(failed, { type: 'summaryStatusResolved', status: 'loading', universeId: '7' })
		expect(resolved.walletSummaryStatus).toBe('loading')
		expect(resolved.walletSummaryError).toBeUndefined()
		expect(resolved.walletSummaryErrorLabel).toBeUndefined()
	})

	test('unchanged transitions keep the current state so they do not re-render', () => {
		const state = initialWalletSessionState
		expect(walletSessionReducer(state, { type: 'balancesCleared' })).toBe(state)
		expect(walletSessionReducer(state, { type: 'chainObserved', chainId: undefined })).toBe(state)
		expect(walletSessionReducer(state, { type: 'routeChanged', route: '#/markets' })).toBe(state)
	})

	test('a route change keeps connection feedback only for the route that raised it', () => {
		const withFeedback = walletSessionReducer(initialWalletSessionState, { type: 'identityInvalidated', detail: 'Wallet network changed', route: '#/markets', universeId: undefined })
		expect(walletSessionReducer(withFeedback, { type: 'routeChanged', route: '#/markets' })).toBe(withFeedback)
		expect(walletSessionReducer(withFeedback, { type: 'routeChanged', route: '#/portfolio' }).walletConnectionFeedback).toBeUndefined()
	})
})
