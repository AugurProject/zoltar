import { withReadTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { requireInjectedAccount } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { useCallback, useEffect, useReducer, useRef } from 'preact/hooks'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import { formatNetworkRequiredReason } from '../../copy/availability.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { getActiveInjectedProvider, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../../protocol/injected.js'
import { publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import { walletSummaryAvailability, walletSummaryRefreshState, type WorkflowOwner } from '../liveTradingControllerHelpers.js'
import type { GuardedWalletWrite } from '../../protocol/tradeQuote.js'
import { liveCopy } from '../../copy/live.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'
import type { usePortfolioQueries } from './usePortfolioQueries.js'
import type { useTransactionWorkflow } from './useTransactionWorkflow.js'
import { initialWalletSessionState, walletSessionReducer } from './walletSessionState.js'

/** The reason a wallet on another chain cannot transact, or undefined when the wallet chain is unknown or matches the deployment. */
export function walletNetworkMismatchReason(walletChainId: number | undefined, configuration: Pick<DeploymentConfiguration, 'chainId' | 'chainName'> | undefined) {
	if (walletChainId === undefined || configuration === undefined || walletChainId === configuration.chainId) return undefined
	return formatNetworkRequiredReason(configuration.chainName)
}

export function useWalletSession() {
	const [state, dispatch] = useReducer(walletSessionReducer, initialWalletSessionState)
	const accountRef = useRef(state.account)
	accountRef.current = state.account
	return { ...state, accountRef, dispatch }
}

type RequestGuard = ReturnType<typeof createLatestRequestGuard>

export function useWalletSessionController({
	route,
	configuration,
	selectedUniverseId,
	onWalletSummaryChange,
	services,
	session,
	portfolio,
	transaction,
	requests,
	refresh,
}: {
	route: string
	configuration: DeploymentConfiguration | undefined
	selectedUniverseId: string | undefined
	onWalletSummaryChange(summary: WalletSummaryState): void
	services: LiveTradingControllerServices
	session: ReturnType<typeof useWalletSession>
	portfolio: ReturnType<typeof usePortfolioQueries>
	transaction: ReturnType<typeof useTransactionWorkflow>
	requests: { balance: RequestGuard; connection: RequestGuard; portfolioBalance: RequestGuard; walletSummary: RequestGuard }
	refresh(configuration?: DeploymentConfiguration, start?: bigint, owner?: WorkflowOwner): Promise<void>
}) {
	const { balance: balanceRequests, connection: connectionRequests, portfolioBalance: portfolioBalanceRequests, walletSummary: walletSummaryRequests } = requests
	const { dispatch } = session
	const walletContextRevision = useRef(0)
	const subscriptionCleanup = useRef<(() => void) | undefined>()
	const contextChangeHandler = useRef<(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) => void>(() => undefined)
	const connectHandler = useRef<() => void>(() => undefined)
	const mounted = useRef(true)
	const renderContextKey = `${route}\u0000${selectedUniverseId ?? ''}\u0000${configuration?.chainId.toString() ?? ''}\u0000${configuration?.router ?? ''}`
	const renderContextKeyRef = useRef(renderContextKey)
	renderContextKeyRef.current = renderContextKey

	const invalidateIdentity = useCallback(
		(detail: string) => {
			walletContextRevision.current++
			subscriptionCleanup.current?.()
			subscriptionCleanup.current = undefined
			// Keep watching the wallet chain so a later switch back clears the network reason without a reconnect,
			// including when the connect attempt itself rejected the chain before a session provider was recorded.
			const observedProvider = session.walletProvider ?? getActiveInjectedProvider()
			if (observedProvider !== undefined) {
				subscriptionCleanup.current = subscribeToWalletContextChanges(observedProvider, changedEvent => {
					if (changedEvent !== 'chainChanged') return
					services
						.walletChainId(observedProvider)
						.then(chainId => {
							if (mounted.current) dispatch({ type: 'chainObserved', chainId })
						})
						.catch(() => {
							if (mounted.current) dispatch({ type: 'chainObserved', chainId: undefined })
						})
				})
			}
			connectionRequests.invalidate()
			balanceRequests.invalidate()
			portfolioBalanceRequests.invalidate()
			walletSummaryRequests.invalidate()
			session.accountRef.current = undefined
			dispatch({ type: 'identityInvalidated', detail, route, universeId: selectedUniverseId })
			onWalletSummaryChange(walletSummaryRefreshState(undefined, selectedUniverseId))
			portfolio.setBalances(undefined)
			portfolio.setBalanceState('error')
			portfolio.setBalanceError('Wallet context changed; reconnect to refresh balances')
			portfolio.setPortfolioBalanceError('Wallet context changed; reconnect before loading portfolio positions')
			transaction.invalidateWalletContext(detail)
		},
		[balanceRequests, connectionRequests, onWalletSummaryChange, portfolioBalanceRequests, route, selectedUniverseId, services, session.walletProvider, walletSummaryRequests],
	)

	const executeWithCurrentWalletContext = useCallback(
		async <T>(expectedAccount: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T> => {
			const expectedRevision = walletContextRevision.current
			const provider = getActiveInjectedProvider()
			if (provider === undefined || provider !== session.walletProvider) {
				const detail = provider === undefined ? 'No injected wallet was found; reconnect before continuing' : 'Wallet provider changed; reconnect before continuing'
				if (provider === undefined) dispatch({ type: 'chainObserved', chainId: undefined })
				invalidateIdentity(detail)
				throw new Error(detail)
			}
			const requireCurrent = () => {
				if (!mounted.current || walletContextRevision.current !== expectedRevision || getActiveInjectedProvider() !== provider || session.accountRef.current !== expectedAccount) {
					const detail = 'Wallet context changed; reconnect before continuing'
					invalidateIdentity(detail)
					throw new Error(detail)
				}
			}
			let chainId: number
			try {
				chainId = await services.walletChainId(provider)
			} catch (error) {
				invalidateIdentity(networkFailure)
				throw new Error(networkFailure, { cause: error })
			}
			requireCurrent()
			dispatch({ type: 'chainObserved', chainId })
			if (configuration === undefined || chainId !== configuration.chainId) {
				invalidateIdentity(networkFailure)
				throw new Error(networkFailure)
			}
			let connectedAccount: Address
			try {
				connectedAccount = await services.connectWallet(provider)
			} catch (error) {
				invalidateIdentity(accountFailure)
				throw new Error(accountFailure, { cause: error })
			}
			requireCurrent()
			if (connectedAccount !== expectedAccount) {
				invalidateIdentity(accountFailure)
				throw new Error(accountFailure)
			}
			return await action()
		},
		[configuration, invalidateIdentity, session.walletProvider],
	)

	const createGuardedWalletWrite = useCallback(
		(expectedAccount: Address, networkFailure: string, accountFailure: string) => {
			const expectedRevision = walletContextRevision.current
			const guardedWrite: GuardedWalletWrite = async write => {
				if (!mounted.current || walletContextRevision.current !== expectedRevision) throw new Error('Wallet context changed during transaction revalidation; reconnect and simulate again')
				return await executeWithCurrentWalletContext(expectedAccount, networkFailure, accountFailure, async () => {
					if (!mounted.current || walletContextRevision.current !== expectedRevision) throw new Error('Wallet context changed during transaction revalidation; reconnect and simulate again')
					return await write()
				})
			}
			return guardedWrite
		},
		[executeWithCurrentWalletContext],
	)

	const refreshWalletSummaryAfterReceipt = useCallback(() => {
		walletSummaryRequests.invalidate()
		const currentAccount = session.accountRef.current
		dispatch({ type: 'receiptRefreshRequested', status: currentAccount === undefined ? 'disconnected' : 'loading', universeId: selectedUniverseId })
		onWalletSummaryChange(walletSummaryRefreshState(currentAccount, selectedUniverseId))
	}, [onWalletSummaryChange, selectedUniverseId, walletSummaryRequests])

	async function establish(provider: InjectedEthereum, expectedContext: string, requestIsCurrent: () => boolean, eventName?: WalletContextChangeEvent, restoreExisting = false) {
		const requireCurrent = () => {
			if (!mounted.current || !requestIsCurrent() || getActiveInjectedProvider() !== provider) return false
			if (renderContextKeyRef.current !== expectedContext) {
				connectHandler.current()
				return false
			}
			return true
		}
		if (configuration === undefined) throw new Error('Deployment configuration is unavailable')
		let chainId = await services.walletChainId(provider)
		if (!requireCurrent()) return
		if (chainId !== configuration.chainId && eventName === undefined && !restoreExisting) {
			await services.switchWalletChain(provider, configuration.chainId)
			if (!requireCurrent()) return
			chainId = await services.walletChainId(provider)
		}
		if (!requireCurrent()) return
		dispatch({ type: 'chainObserved', chainId })
		if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
		const connected = await (restoreExisting ? requireInjectedAccount(provider) : services.connectWallet(provider))
		if (!requireCurrent()) return
		subscriptionCleanup.current?.()
		const backend = getActiveBackend()
		if (backend.getProvider() === provider) {
			const unsubscribeAccounts = backend.subscribeAccountsChanged(() => contextChangeHandler.current(provider, 'accountsChanged', false))
			const unsubscribeChain = backend.subscribeChainChanged(() => contextChangeHandler.current(provider, 'chainChanged', false))
			subscriptionCleanup.current = () => {
				unsubscribeAccounts()
				unsubscribeChain()
			}
		} else {
			subscriptionCleanup.current = subscribeToWalletContextChanges(provider, changedEvent => contextChangeHandler.current(provider, changedEvent, false))
		}
		const confirmedChainId = await services.walletChainId(provider)
		if (!requireCurrent()) return
		const confirmedAccount = await (restoreExisting ? requireInjectedAccount(provider) : services.connectWallet(provider))
		if (!requireCurrent()) return
		if (confirmedChainId !== configuration.chainId || confirmedAccount !== connected) throw new Error(eventName === undefined ? 'Wallet account changed while connecting; reconnect to continue' : 'Wallet account changed while refreshing; reconnect to continue')
		balanceRequests.invalidate()
		walletSummaryRequests.invalidate()
		session.accountRef.current = connected
		dispatch({ type: 'connected', account: connected, provider, universeId: selectedUniverseId, walletClient: services.createTradingWalletClient(provider, connected) })
		onWalletSummaryChange(walletSummaryRefreshState(connected, selectedUniverseId))
		portfolio.setBalances(undefined)
		portfolio.setBalanceState('loading')
		portfolio.setBalanceError(undefined)
		walletContextRevision.current++
		transaction.resetUnlocked()
		await refresh(configuration)
	}

	async function connect() {
		if (transaction.anyWorkflowLocked()) return
		if (session.accountRef.current !== undefined || session.walletClient !== undefined) invalidateIdentity('Reconnecting wallet…')
		const request = connectionRequests.begin()
		const expectedContext = renderContextKey
		try {
			const provider = getActiveInjectedProvider()
			if (provider === undefined) {
				dispatch({ type: 'chainObserved', chainId: undefined })
				throw new Error('No injected wallet was found')
			}
			await establish(provider, expectedContext, () => connectionRequests.isCurrent(request))
		} catch (error) {
			if (!connectionRequests.isCurrent(request) || renderContextKeyRef.current !== expectedContext) return
			invalidateIdentity(publicErrorMessage(error, 'Wallet connection failed'))
		}
	}
	connectHandler.current = () => void connect()

	useEffect(() => {
		if (configuration === undefined || session.accountRef.current !== undefined) return
		const backend = getActiveBackend()
		const request = connectionRequests.begin()
		let active = true
		const isCurrent = () => active && connectionRequests.isCurrent(request)
		void (async () => {
			try {
				const accounts = await backend.getAccounts()
				if (!isCurrent() || accounts[0] === undefined) return
				const provider = backend.getProvider()
				if (provider === undefined) return
				await establish(provider, renderContextKeyRef.current, isCurrent, undefined, true)
			} catch (error) {
				if (isCurrent()) invalidateIdentity(publicErrorMessage(error, 'Wallet connection could not be restored'))
			}
		})()
		return () => {
			active = false
		}
	}, [configuration])

	async function refreshAfterEvent(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) {
		const label = eventName === 'accountsChanged' ? 'Wallet account changed' : 'Wallet network changed'
		if ((!allowDisconnectedRefresh && session.accountRef.current === undefined) || transaction.anyWorkflowLocked()) {
			invalidateIdentity(`${label}. Reconnect before simulating or submitting.`)
			return
		}
		invalidateIdentity(`${label}. Refreshing wallet context…`)
		const request = connectionRequests.begin()
		const expectedContext = renderContextKey
		try {
			await establish(provider, expectedContext, () => connectionRequests.isCurrent(request), eventName)
		} catch (error) {
			if (!connectionRequests.isCurrent(request) || renderContextKeyRef.current !== expectedContext) return
			invalidateIdentity(`${label}: ${publicErrorMessage(error, 'wallet refresh failed')}`)
		}
	}
	contextChangeHandler.current = (provider, eventName, allowDisconnectedRefresh) => void refreshAfterEvent(provider, eventName, allowDisconnectedRefresh)

	useEffect(
		() => () => {
			mounted.current = false
			connectionRequests.invalidate()
			walletContextRevision.current++
			subscriptionCleanup.current?.()
			subscriptionCleanup.current = undefined
		},
		[],
	)

	return { connect, invalidateIdentity, executeWithCurrentWalletContext, createGuardedWalletWrite, refreshWalletSummaryAfterReceipt, walletContextIsCurrent: (expectedAccount: Address) => mounted.current && session.accountRef.current === expectedAccount }
}

export function useWalletSummaryEffects({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
	discoveryState,
	discoveryError,
	selected,
	retryNonce,
	onWalletSummaryChange,
	session,
	services,
	requests,
}: {
	route: string
	configuration: DeploymentConfiguration | undefined
	configurationError: string | undefined
	selectedUniverseId: string | undefined
	discoveryState: 'loading' | 'ready' | 'error'
	discoveryError: string | undefined
	selected: LiveMarket | undefined
	retryNonce: number
	onWalletSummaryChange(summary: WalletSummaryState): void
	session: ReturnType<typeof useWalletSession>
	services: LiveTradingControllerServices
	requests: RequestGuard
}) {
	const networkMismatchReason = walletNetworkMismatchReason(session.walletChainId, configuration)
	useEffect(() => {
		onWalletSummaryChange({
			account: session.account,
			ethAttoEth: session.walletEthAttoEth,
			repAttoRep: session.walletRepAttoRep,
			status: session.walletSummaryStatus,
			error: session.walletSummaryError,
			errorLabel: session.walletSummaryErrorLabel,
			universeId: session.walletSummaryUniverseId,
			...(networkMismatchReason === undefined ? {} : { networkMismatchReason, walletChainId: session.walletChainId }),
		})
	}, [session.account, networkMismatchReason, session.walletChainId, onWalletSummaryChange, session.walletEthAttoEth, session.walletRepAttoRep, session.walletSummaryError, session.walletSummaryErrorLabel, session.walletSummaryStatus, session.walletSummaryUniverseId])

	useEffect(() => {
		session.dispatch({ type: 'balancesCleared' })
	}, [session.account, session.walletChainId, configuration, selectedUniverseId])

	useEffect(() => {
		const request = requests.begin()
		const resolveStatus = (status: WalletSummaryState['status'], error?: string, errorLabel?: string) => session.dispatch({ type: 'summaryStatusResolved', error, errorLabel, status, universeId: selectedUniverseId })
		if (session.account === undefined) {
			resolveStatus('disconnected')
			return
		}
		const availability = walletSummaryAvailability(configuration !== undefined, configurationError, discoveryState, discoveryError, selected !== undefined || selectedUniverseId !== undefined, liveCopy.discoveryFailureLead(route))
		if (availability !== undefined) {
			resolveStatus(availability.status, availability.error, availability.errorLabel)
			return
		}
		if (configuration === undefined) throw new Error('Wallet summary availability was resolved without a deployment configuration')
		if (selected?.loadError !== undefined) {
			resolveStatus('error', `Wallet balances could not be loaded because the selected security pool is unavailable: ${selected.loadError}`, 'Security pool unavailable')
			return
		}
		const walletMarket = selected ?? { zoltar: configuration.zoltar, universeId: BigInt(selectedUniverseId ?? '0') }
		resolveStatus('loading')
		void withReadTimeout(services.loadWalletHeaderBalances(services.createTradingPublicClient(configuration), walletMarket, session.account)).then(
			loaded => {
				if (!requests.isCurrent(request) || session.accountRef.current !== session.account) return
				session.dispatch({ type: 'balancesLoaded', ethAttoEth: loaded.ethAttoEth, repAttoRep: loaded.repAttoRep })
			},
			error => {
				if (!requests.isCurrent(request) || session.accountRef.current !== session.account) return
				session.dispatch({ type: 'balancesFailed', error: publicErrorMessage(error, 'Wallet ETH and REP balances could not be loaded'), errorLabel: 'Wallet balance read failed' })
			},
		)
		return () => requests.invalidate()
	}, [session.account, configuration, configurationError, discoveryError, discoveryState, selected, session.walletSummaryReceiptNonce, requests, retryNonce])
}
