import type { Address, WalletClient } from '@zoltar/shared/ethereum'
import type { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { InjectedEthereum } from '../../protocol/injected.js'
import { publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import { walletSummaryAvailability } from '../liveTradingControllerHelpers.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'

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
