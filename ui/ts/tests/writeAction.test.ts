/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import type { ChainBackend } from '../lib/chainBackend.js'
import { MAINNET_NETWORK_PROFILE } from '../lib/networkProfile.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFinished, markTransactionRequested } from '../lib/transactionTray.js'
import { buildWriteActionConfig, runWriteAction } from '../lib/writeAction.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'

const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
const nextWalletAddress = getAddress('0x00000000000000000000000000000000000000b2')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000a1'

describe('runWriteAction', () => {
	let restoreActiveEnvironment: (() => void) | undefined

	function installWalletBackend({ accounts = [walletAddress], chainId = MAINNET_NETWORK_PROFILE.chainIdHex }: { accounts?: readonly (typeof walletAddress)[]; chainId?: string } = {}) {
		const backend: ChainBackend = {
			bootstrapError: undefined,
			bootstrapLabel: undefined,
			bootstrapProgress: undefined,
			createReadClient: () => {
				throw new Error('read client not used')
			},
			createWriteClient: () => {
				throw new Error('write client not used')
			},
			getAccounts: async () => accounts,
			getChainId: async () => chainId,
			getProvider: () => undefined,
			hasWallet: () => true,
			id: 'injected',
			profile: MAINNET_NETWORK_PROFILE,
			requestAccounts: async () => accounts,
			subscribe: undefined,
			subscribeAccountsChanged: () => () => undefined,
			subscribeChainChanged: () => () => undefined,
		}
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting(backend)
	}

	beforeEach(() => {
		installWalletBackend()
	})

	afterEach(() => {
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
	})

	test('uses the provided missing-wallet message when no wallet is connected', async () => {
		let errorMessage: string | undefined

		await runWriteAction(
			{
				accountAddress: undefined,
				missingWalletMessage: 'Connect a wallet before creating a question',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to create question',
		)

		expect(errorMessage).toBe('Connect a wallet before creating a question')
	})

	test('uses the action fallback when the write action fails', async () => {
		let errorMessage: string | undefined
		let transactionFailureMessage: string | undefined

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFailed: message => {
					transactionFailureMessage = message
				},
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => {
				throw new Error('execution reverted')
			},
			'Failed to report on outcome',
		)

		expect(errorMessage).toBe('Transaction failed while attempting to report on outcome.')
		expect(transactionFailureMessage).toBe('Transaction failed while attempting to report on outcome.')
	})

	test('fails before requesting a transaction when the active wallet account changed', async () => {
		let errorMessage: string | undefined
		let transactionRequested = false
		installWalletBackend({ accounts: [nextWalletAddress] })

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => {
					transactionRequested = true
				},
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
		)

		expect(transactionRequested).toBe(false)
		expect(errorMessage).toBe('Wallet account changed. Review the action with the connected account and try again')
	})

	test('fails before requesting a transaction when the wallet disconnects', async () => {
		let errorMessage: string | undefined
		let transactionRequested = false
		installWalletBackend({ accounts: [] })

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => {
					transactionRequested = true
				},
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
		)

		expect(transactionRequested).toBe(false)
		expect(errorMessage).toBe('Wallet account is no longer connected. Reconnect your wallet and try again')
	})

	test('fails before requesting a transaction when the wallet network changes', async () => {
		let errorMessage: string | undefined
		let transactionRequested = false
		installWalletBackend({ chainId: '0x5' })

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => {
					transactionRequested = true
				},
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
		)

		expect(transactionRequested).toBe(false)
		expect(errorMessage).toBe('Transaction failed while attempting to report on outcome. Reason: Wallet network changed. Switch to Ethereum Mainnet and try again')
	})

	test('passes the validated active chain to the write action', async () => {
		let activeChainId: string | undefined

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				setErrorMessage: () => undefined,
			},
			async (_walletAddress, activeWallet) => {
				activeChainId = activeWallet.chainId
				return { hash: transactionHash }
			},
			'Failed to report on outcome',
		)

		expect(activeChainId).toBe(MAINNET_NETWORK_PROFILE.chainIdHex)
	})

	test('uses simulation transaction copy through the shared write action config', async () => {
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: walletAddress, profile: createFakeSimulationProfile() }))
		let transactionState = createInitialTransactionTrayState()
		const errorSignal: { value: string | undefined } = { value: undefined }
		const writeActionConfig = buildWriteActionConfig(
			{
				accountAddress: walletAddress,
				onTransactionCanceled: () => {
					transactionState = markTransactionCanceled(transactionState)
				},
				onTransactionFailed: undefined,
				onTransactionFinished: () => {
					transactionState = markTransactionFinished(transactionState)
				},
				onTransactionPresented: () => undefined,
				onTransactionPrepared: undefined,
				onTransactionRequested: intent => {
					transactionState = markTransactionRequested(transactionState, intent)
				},
				refreshState: async () => undefined,
			},
			errorSignal,
			'Connect wallet',
			{
				action: 'createMarket',
				source: 'zoltar',
				submittedDetail: 'Question creation transaction submitted.',
				submittedTitle: 'Creating Question',
			},
		)

		await runWriteAction(writeActionConfig, async () => ({ hash: transactionHash }), 'Failed to create question')

		expect(transactionState.active?.tone).toBe('preparing')
		expect(transactionState.active?.detail).toBe('Submitting in browser simulation. No wallet confirmation is required.')
		expect(transactionState.pendingIntent?.requiresWalletConfirmation).toBe(false)
		expect(transactionState.inFlightCount).toBe(0)
		expect(errorSignal.value).toBeUndefined()
	})

	test('clears pending transaction state when the write action cancels before submission', async () => {
		let transactionState = createInitialTransactionTrayState()
		let writeCanceled = false

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionCanceled: () => {
					transactionState = markTransactionCanceled(transactionState)
				},
				onTransactionFinished: () => {
					transactionState = markTransactionFinished(transactionState)
				},
				onTransactionRequested: () => {
					transactionState = markTransactionRequested(transactionState, {
						action: 'createMarket',
						source: 'zoltar',
						submittedDetail: 'Question creation transaction submitted.',
						submittedTitle: 'Creating Question',
					})
				},
				onWriteCanceled: () => {
					writeCanceled = true
				},
				refreshState: async () => undefined,
				setErrorMessage: () => undefined,
			},
			async () => undefined,
			'Failed to create question',
		)

		expect(writeCanceled).toBe(true)
		expect(transactionState.active).toBeUndefined()
		expect(transactionState.pendingIntent).toBeUndefined()
		expect(transactionState.inFlightCount).toBe(0)
	})

	test('delegates missing-wallet errors to onWriteError when provided', async () => {
		let onWriteErrorMessage: string | undefined

		await runWriteAction(
			{
				accountAddress: undefined,
				missingWalletMessage: 'Please connect your wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				onWriteError: message => {
					onWriteErrorMessage = message
				},
				setErrorMessage: () => undefined,
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
		)

		expect(onWriteErrorMessage).toBe('Please connect your wallet')
	})

	test('prefers onWriteError over setErrorMessage when provided', async () => {
		let errorMessage: string | undefined
		let onWriteErrorMessage: string | undefined
		let transactionFinished = false

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => {
					transactionFinished = true
				},
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				formatErrorMessage: (error, fallback) => {
					void error
					return `custom-${fallback}`
				},
				onWriteError: message => {
					onWriteErrorMessage = message
				},
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => {
				throw new Error('reverted')
			},
			'Failed to report on outcome',
		)

		expect(onWriteErrorMessage).toBe('custom-Failed to report on outcome')
		expect(errorMessage).toBeUndefined()
		expect(transactionFinished).toBe(true)
	})

	test('uses the refresh fallback when post-transaction refresh fails', async () => {
		let errorMessage: string | undefined
		let onSuccessCalled = false

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshErrorFallback: 'Reporting transaction succeeded, but refreshing reporting details failed',
				refreshState: async () => {
					throw new Error('RPC unavailable')
				},
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
			async () => {
				onSuccessCalled = true
			},
		)

		expect(onSuccessCalled).toBe(true)
		expect(errorMessage).toBe('Reporting transaction succeeded, but refreshing reporting details failed. Reason: RPC unavailable')
	})

	test('reports refresh errors to the refresh callback without using setErrorMessage', async () => {
		let refreshErrorMessage: string | undefined
		let refreshErrorHash: string | undefined

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshErrorFallback: 'Refresh failure fallback',
				refreshState: async () => {
					throw new Error('RPC unavailable')
				},
				onRefreshError: (message, hash) => {
					refreshErrorMessage = message
					refreshErrorHash = hash
				},
				setErrorMessage: () => undefined,
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
			async () => undefined,
		)

		expect(refreshErrorMessage).toBe('Refresh failure fallback. Reason: RPC unavailable')
		expect(refreshErrorHash).toBe(transactionHash)
	})
})
