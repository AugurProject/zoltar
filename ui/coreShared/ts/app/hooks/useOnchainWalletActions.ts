import { batch, useSignal } from '@preact/signals'
import { useLayoutEffect, useRef } from 'preact/hooks'

import type { ChainBackend } from '../../wallet/chainBackend.js'
import { getErrorMessage, isWalletRejection } from '../../lib/errors.js'

import { getActiveBackend } from '../../lib/activeEnvironment.js'

import { beginWalletAction, createWalletManagementActions } from './walletManagementActions.js'

export function useOnchainWalletActions({ activeEnvironmentNonce, refreshState, onError }: { activeEnvironmentNonce: number; refreshState: () => Promise<void>; onError: (message: string | undefined) => void }) {
	const isConnectingWallet = useSignal(false)
	const isManagingWallet = useSignal(false)
	const renderedBackend = getActiveBackend()
	const walletActionContextRef = useRef({ activeEnvironmentNonce, backend: renderedBackend })
	const connectWalletGenerationRef = useRef(0)
	const manageWalletGenerationRef = useRef(0)
	if (walletActionContextRef.current.activeEnvironmentNonce !== activeEnvironmentNonce || walletActionContextRef.current.backend !== renderedBackend) {
		walletActionContextRef.current = { activeEnvironmentNonce, backend: renderedBackend }
		connectWalletGenerationRef.current += 1
		manageWalletGenerationRef.current += 1
	}
	useLayoutEffect(() => {
		batch(() => {
			isConnectingWallet.value = false
			isManagingWallet.value = false
		})
	}, [activeEnvironmentNonce, renderedBackend])
	const connectWallet = async () => {
		const backend = getActiveBackend()
		if (!backend.hasWallet()) {
			onError('No wallet detected. Install or enable a wallet to continue.')
			return
		}
		if (isConnectingWallet.value) return
		const isCurrentAction = beginWalletAction(connectWalletGenerationRef, walletActionContextRef, activeEnvironmentNonce, backend)
		try {
			batch(() => {
				isConnectingWallet.value = true
				onError(undefined)
			})
			await backend.requestAccounts()
			if (!isCurrentAction()) return
			await refreshState()
		} catch (error) {
			if (!isCurrentAction()) return
			// Declining the wallet prompt is the user's choice, not an application error.
			if (isWalletRejection(error)) return
			onError(getErrorMessage(error, 'Wallet connection failed'))
		} finally {
			if (isCurrentAction()) isConnectingWallet.value = false
		}
	}
	const runWalletManagementAction = async (action: (backend: ChainBackend) => Promise<void>, fallbackMessage: string) => {
		if (isManagingWallet.value) return
		const backend = getActiveBackend()
		const isCurrentAction = beginWalletAction(manageWalletGenerationRef, walletActionContextRef, activeEnvironmentNonce, backend)
		try {
			batch(() => {
				isManagingWallet.value = true
				onError(undefined)
			})
			await action(backend)
			if (!isCurrentAction()) return
			await refreshState()
		} catch (error) {
			if (!isCurrentAction()) return
			if (isWalletRejection(error)) return
			onError(getErrorMessage(error, fallbackMessage))
		} finally {
			if (isCurrentAction()) isManagingWallet.value = false
		}
	}
	const { changeWallet, disconnectWallet, switchNetwork } = createWalletManagementActions(runWalletManagementAction)

	return {
		isConnectingWallet: isConnectingWallet.value,
		isManagingWallet: isManagingWallet.value,
		connectWallet,
		changeWallet,
		disconnectWallet,
		switchNetwork,
	}
}
