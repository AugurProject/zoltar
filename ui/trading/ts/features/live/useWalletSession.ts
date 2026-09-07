import type { Address, WalletClient } from '@zoltar/shared/ethereum'
import type { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { getInjectedEthereum, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../../protocol/injected.js'
import { publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import { walletSummaryAvailability, walletSummaryRefreshState, type GuardedWalletWrite, type WorkflowOwner } from '../liveTradingControllerHelpers.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'
import type { usePortfolioQueries } from './usePortfolioQueries.js'
import type { useTransactionWorkflow } from './useTransactionWorkflow.js'

export function useWalletSession() {
	const [account, setAccount] = useState<Address>()
	const accountRef = useRef(account)
	accountRef.current = account
	const [walletClient, setWalletClient] = useState<WalletClient>()
	const [walletProvider, setWalletProvider] = useState<InjectedEthereum>()
	const [walletContextInvalidated, setWalletContextInvalidated] = useState(false)
	const [walletSummaryStatus, setWalletSummaryStatus] = useState<WalletSummaryState['status']>('disconnected')
	const [walletEthAttoEth, setWalletEthAttoEth] = useState<bigint>()
	const [walletRepAttoRep, setWalletRepAttoRep] = useState<bigint>()
	const [walletSummaryError, setWalletSummaryError] = useState<string>()
	const [walletSummaryErrorLabel, setWalletSummaryErrorLabel] = useState<string>()
	const [walletSummaryUniverseId, setWalletSummaryUniverseId] = useState<string>()
	const [walletSummaryReceiptNonce, setWalletSummaryReceiptNonce] = useState(0)
	const [walletConnectionFeedback, setWalletConnectionFeedback] = useState<{ route: string; detail: string }>()

	return {
		account,
		setAccount,
		accountRef,
		walletClient,
		setWalletClient,
		walletProvider,
		setWalletProvider,
		walletContextInvalidated,
		setWalletContextInvalidated,
		walletSummaryStatus,
		setWalletSummaryStatus,
		walletEthAttoEth,
		setWalletEthAttoEth,
		walletRepAttoRep,
		setWalletRepAttoRep,
		walletSummaryError,
		setWalletSummaryError,
		walletSummaryErrorLabel,
		setWalletSummaryErrorLabel,
		walletSummaryUniverseId,
		setWalletSummaryUniverseId,
		walletSummaryReceiptNonce,
		setWalletSummaryReceiptNonce,
		walletConnectionFeedback,
		setWalletConnectionFeedback,
	}
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
	connectionRequests,
	balanceRequests,
	portfolioBalanceRequests,
	walletSummaryRequests,
	simulationRequests,
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
	connectionRequests: RequestGuard
	balanceRequests: RequestGuard
	portfolioBalanceRequests: RequestGuard
	walletSummaryRequests: RequestGuard
	simulationRequests: RequestGuard
	refresh(configuration?: DeploymentConfiguration, start?: bigint, owner?: WorkflowOwner): Promise<void>
}) {
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
			connectionRequests.invalidate()
			balanceRequests.invalidate()
			portfolioBalanceRequests.invalidate()
			walletSummaryRequests.invalidate()
			simulationRequests.invalidate()
			session.accountRef.current = undefined
			session.setWalletEthAttoEth(undefined)
			session.setWalletRepAttoRep(undefined)
			session.setWalletSummaryError(undefined)
			session.setWalletSummaryErrorLabel(undefined)
			session.setWalletSummaryUniverseId(selectedUniverseId)
			session.setWalletSummaryStatus('disconnected')
			onWalletSummaryChange(walletSummaryRefreshState(undefined, selectedUniverseId))
			session.setWalletClient(undefined)
			session.setWalletProvider(undefined)
			session.setAccount(undefined)
			portfolio.setBalances(undefined)
			portfolio.setBalanceState('error')
			portfolio.setBalanceError('Wallet context changed; reconnect to refresh balances and approvals')
			portfolio.setPortfolioBalanceError('Wallet context changed; reconnect before loading portfolio positions')
			session.setWalletContextInvalidated(true)
			transaction.setQuote(undefined)
			session.setWalletConnectionFeedback({ route, detail })
			transaction.dispatchWorkflow(transaction.positionWorkflowLockedRef.current ? { type: 'context-invalidated', message: detail } : { type: 'failed', message: detail })
		},
		[balanceRequests, connectionRequests, onWalletSummaryChange, portfolioBalanceRequests, route, selectedUniverseId, simulationRequests, walletSummaryRequests],
	)

	const executeWithCurrentWalletContext = useCallback(
		async <T>(expectedAccount: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T> => {
			const expectedRevision = walletContextRevision.current
			const provider = getInjectedEthereum()
			if (provider === undefined || provider !== session.walletProvider) {
				const detail = provider === undefined ? 'No injected wallet was found; reconnect before continuing' : 'Wallet provider changed; reconnect before continuing'
				invalidateIdentity(detail)
				throw new Error(detail)
			}
			const requireCurrent = () => {
				if (!mounted.current || walletContextRevision.current !== expectedRevision || getInjectedEthereum() !== provider || session.accountRef.current !== expectedAccount) {
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
		session.setWalletEthAttoEth(undefined)
		session.setWalletRepAttoRep(undefined)
		session.setWalletSummaryError(undefined)
		session.setWalletSummaryErrorLabel(undefined)
		session.setWalletSummaryUniverseId(selectedUniverseId)
		session.setWalletSummaryStatus(currentAccount === undefined ? 'disconnected' : 'loading')
		onWalletSummaryChange(walletSummaryRefreshState(currentAccount, selectedUniverseId))
		session.setWalletSummaryReceiptNonce(current => current + 1)
	}, [onWalletSummaryChange, selectedUniverseId, walletSummaryRequests])

	async function establish(provider: InjectedEthereum, expectedContext: string, requestIsCurrent: () => boolean, eventName?: WalletContextChangeEvent) {
		const requireCurrent = () => {
			if (!mounted.current || !requestIsCurrent() || getInjectedEthereum() !== provider) return false
			if (renderContextKeyRef.current !== expectedContext) {
				connectHandler.current()
				return false
			}
			return true
		}
		if (configuration === undefined) throw new Error('Deployment configuration is unavailable')
		let chainId = await services.walletChainId(provider)
		if (!requireCurrent()) return
		if (chainId !== configuration.chainId && eventName === undefined) {
			await services.switchWalletChain(provider, configuration.chainId)
			if (!requireCurrent()) return
			chainId = await services.walletChainId(provider)
		}
		if (!requireCurrent()) return
		if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
		const connected = await services.connectWallet(provider)
		if (!requireCurrent()) return
		subscriptionCleanup.current?.()
		subscriptionCleanup.current = subscribeToWalletContextChanges(provider, changedEvent => contextChangeHandler.current(provider, changedEvent, false))
		const confirmedChainId = await services.walletChainId(provider)
		if (!requireCurrent()) return
		const confirmedAccount = await services.connectWallet(provider)
		if (!requireCurrent()) return
		if (confirmedChainId !== configuration.chainId || confirmedAccount !== connected) throw new Error(eventName === undefined ? 'Wallet account changed while connecting; reconnect to continue' : 'Wallet account changed while refreshing; reconnect to continue')
		balanceRequests.invalidate()
		walletSummaryRequests.invalidate()
		simulationRequests.invalidate()
		session.accountRef.current = connected
		session.setWalletEthAttoEth(undefined)
		session.setWalletRepAttoRep(undefined)
		session.setWalletSummaryError(undefined)
		session.setWalletSummaryErrorLabel(undefined)
		session.setWalletSummaryUniverseId(selectedUniverseId)
		session.setWalletSummaryStatus('loading')
		onWalletSummaryChange(walletSummaryRefreshState(connected, selectedUniverseId))
		portfolio.setBalances(undefined)
		portfolio.setBalanceState('loading')
		portfolio.setBalanceError(undefined)
		session.setWalletContextInvalidated(false)
		walletContextRevision.current++
		session.setAccount(connected)
		session.setWalletClient(services.createTradingWalletClient(provider, connected))
		session.setWalletProvider(provider)
		session.setWalletConnectionFeedback(undefined)
		transaction.dispatchWorkflow({ type: 'reset' })
		await refresh(configuration)
	}

	async function connect() {
		if (transaction.positionWorkflowLockedRef.current || transaction.liquidityWorkflowLockedRef.current) return
		if (session.accountRef.current !== undefined || session.walletClient !== undefined) invalidateIdentity('Reconnecting wallet…')
		const request = connectionRequests.begin()
		const expectedContext = renderContextKey
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined) throw new Error('No injected wallet was found')
			await establish(provider, expectedContext, () => connectionRequests.isCurrent(request))
		} catch (error) {
			if (!connectionRequests.isCurrent(request) || renderContextKeyRef.current !== expectedContext) return
			invalidateIdentity(publicErrorMessage(error, 'Wallet connection failed'))
		}
	}
	connectHandler.current = () => void connect()

	async function refreshAfterEvent(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) {
		const label = eventName === 'accountsChanged' ? 'Wallet account changed' : 'Wallet network changed'
		if ((!allowDisconnectedRefresh && session.accountRef.current === undefined) || transaction.positionWorkflowLockedRef.current || transaction.liquidityWorkflowLockedRef.current) {
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
	useEffect(() => {
		onWalletSummaryChange({ account: session.account, ethAttoEth: session.walletEthAttoEth, repAttoRep: session.walletRepAttoRep, status: session.walletSummaryStatus, error: session.walletSummaryError, errorLabel: session.walletSummaryErrorLabel, universeId: session.walletSummaryUniverseId })
	}, [session.account, onWalletSummaryChange, session.walletEthAttoEth, session.walletRepAttoRep, session.walletSummaryError, session.walletSummaryErrorLabel, session.walletSummaryStatus, session.walletSummaryUniverseId])

	useEffect(() => {
		const request = requests.begin()
		session.setWalletEthAttoEth(undefined)
		session.setWalletRepAttoRep(undefined)
		session.setWalletSummaryError(undefined)
		session.setWalletSummaryErrorLabel(undefined)
		session.setWalletSummaryUniverseId(selectedUniverseId)
		if (session.account === undefined) {
			session.setWalletSummaryStatus('disconnected')
			return
		}
		const availability = walletSummaryAvailability(configuration !== undefined, configurationError, discoveryState, discoveryError, selected !== undefined)
		if (availability !== undefined) {
			session.setWalletSummaryStatus(availability.status)
			session.setWalletSummaryError(availability.error)
			session.setWalletSummaryErrorLabel(availability.errorLabel)
			return
		}
		if (configuration === undefined || selected === undefined) throw new Error('Wallet summary availability was resolved without a SecurityPool configuration')
		if (selected.loadError !== undefined) {
			session.setWalletSummaryStatus('error')
			session.setWalletSummaryError(`Wallet balances could not be loaded because the selected SecurityPool is unavailable: ${selected.loadError}`)
			session.setWalletSummaryErrorLabel('SecurityPool unavailable')
			return
		}
		session.setWalletSummaryStatus('loading')
		void services.loadWalletHeaderBalances(services.createTradingPublicClient(configuration), selected, session.account).then(
			loaded => {
				if (!requests.isCurrent(request) || session.accountRef.current !== session.account) return
				session.setWalletEthAttoEth(loaded.ethAttoEth)
				session.setWalletRepAttoRep(loaded.repAttoRep)
				session.setWalletSummaryStatus('ready')
			},
			error => {
				if (!requests.isCurrent(request) || session.accountRef.current !== session.account) return
				session.setWalletSummaryStatus('error')
				session.setWalletSummaryError(publicErrorMessage(error, 'Wallet ETH and REP balances could not be loaded'))
				session.setWalletSummaryErrorLabel('Wallet balance read failed')
			},
		)
		return () => requests.invalidate()
	}, [session.account, configuration, configurationError, discoveryError, discoveryState, selected, session.walletSummaryReceiptNonce, requests, retryNonce])
}
