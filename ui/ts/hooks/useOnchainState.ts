import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address } from 'viem'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot, loadErc20Balance } from '../contracts.js'
import { createConnectedReadClient, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import { getWethAddress } from '../lib/uniswapQuoter.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'
import { useLoadController } from './useLoadController.js'

type RefreshStateOptions = {
	loadWalletState?: boolean
}

type LoadWalletStateParameters = {
	chainIdPromise: Promise<string> | undefined
	connectedAddress: Address | undefined
	ethBalancePromise: Promise<bigint> | undefined
	fallbackChainId?: string
	getAccountState: () => AccountState
	isCurrent: () => boolean
	setAccountState: (state: AccountState) => void
	setErrorMessage: (message: string | undefined) => void
	trackLoad: <TResult>(work: () => Promise<TResult>) => Promise<TResult>
	wethBalancePromise: Promise<bigint> | undefined
}

export async function loadWalletState({ chainIdPromise, connectedAddress, ethBalancePromise, fallbackChainId, getAccountState, isCurrent, setAccountState, setErrorMessage, trackLoad, wethBalancePromise }: LoadWalletStateParameters) {
	if (connectedAddress === undefined || chainIdPromise === undefined || ethBalancePromise === undefined || wethBalancePromise === undefined) return
	const resolvedFallbackChainId = fallbackChainId ?? '0x1'

	void trackLoad(async () => {
		try {
			const chainId = await chainIdPromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId })
		} catch {
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), chainId: resolvedFallbackChainId })
		}
	})

	void trackLoad(async () => {
		try {
			const ethBalance = await ethBalancePromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), ethBalance })
		} catch (error) {
			if (!isCurrent()) return
			setErrorMessage(getErrorMessage(error, 'Failed to refresh wallet balances'))
		}
	})

	void trackLoad(async () => {
		try {
			const wethBalance = await wethBalancePromise
			if (!isCurrent()) return
			setAccountState({ ...getAccountState(), wethBalance })
		} catch (error) {
			if (!isCurrent()) return
			setErrorMessage(getErrorMessage(error, 'Failed to refresh wallet balances'))
		}
	})
}

export function useOnchainState() {
	const accountState = useSignal<AccountState>({
		address: undefined,
		chainId: undefined,
		ethBalance: undefined,
		wethBalance: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getActiveBackend().hasWallet())
	const walletStateLoad = useLoadController()
	const deploymentStatusLoad = useLoadController()
	const deploymentStatusesLoaded = useSignal(false)
	const augurPlaceHolderDeployed = useSignal<boolean | undefined>(undefined)
	const environmentBootstrapError = useSignal<string | undefined>(undefined)
	const environmentBootstrapLabel = useSignal(getActiveBackend().bootstrapLabel)
	const environmentBootstrapProgress = useSignal(getActiveBackend().bootstrapProgress)
	const environmentReady = useSignal(getActiveBackend().isBootstrapped ?? true)
	const environmentReadyLoad = useLoadController()
	const walletBootstrapComplete = useSignal(false)
	const isConnectingWallet = useSignal(false)
	const nextRefresh = useRequestGuard()
	const errorMessage = useSignal<string | undefined>(undefined)
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		const updated = update(deploymentStatuses.value)
		deploymentStatuses.value = updated
		if (updated.every(step => step.deployed)) augurPlaceHolderDeployed.value = true
	}

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadWalletState = options.loadWalletState ?? true
		const backend = getActiveBackend()
		const isCurrent = nextRefresh()
		hasInjectedWallet.value = backend.hasWallet()
		errorMessage.value = undefined
		backend.setReadTransportMode?.('rpc')

		if (backend.isBootstrapped === false) {
			deploymentStatusesLoaded.value = false
			augurPlaceHolderDeployed.value = undefined
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = false
			environmentBootstrapError.value = undefined
		}

		if (backend.isBootstrapped !== false) {
			void deploymentStatusLoad.track(async () => {
				try {
					const snapshot = await loadDeploymentStatusOracleSnapshot(backend.createReadClient())
					if (!isCurrent()) return
					augurPlaceHolderDeployed.value = snapshot.augurPlaceHolderDeployed
					deploymentStatuses.value = snapshot.deploymentStatuses
					deploymentStatusesLoaded.value = true
				} catch (error) {
					if (!isCurrent()) return
					errorMessage.value = getErrorMessage(error, 'Failed to refresh deployment status')
				}
			})
		}

		if (!shouldLoadWalletState) return

		await walletStateLoad.track(async () => {
			try {
				const accounts = await backend.getAccounts()
				if (!isCurrent()) return
				const connectedAddress = normalizeAccount(accounts[0])
				accountState.value = {
					address: connectedAddress,
					chainId: accountState.value.chainId,
					ethBalance: connectedAddress === accountState.value.address ? accountState.value.ethBalance : undefined,
					wethBalance: connectedAddress === accountState.value.address ? accountState.value.wethBalance : undefined,
				}

				walletBootstrapComplete.value = true

				if (connectedAddress !== undefined) {
					const chainIdPromise = backend.getChainId()
					const readClient = createConnectedReadClient()
					const ethBalancePromise = readClient.getBalance({ address: connectedAddress })
					const wethBalancePromise = loadErc20Balance(readClient, getWethAddress(), connectedAddress)
					void loadWalletState({
						chainIdPromise,
						connectedAddress,
						ethBalancePromise,
						fallbackChainId: backend.profile.chainIdHex,
						getAccountState: () => accountState.value,
						isCurrent,
						setAccountState: state => {
							accountState.value = state
						},
						setErrorMessage: message => {
							errorMessage.value = message
						},
						trackLoad: walletStateLoad.track,
						wethBalancePromise,
					})
				} else {
					accountState.value = { ...accountState.value, chainId: backend.profile.chainIdHex, ethBalance: undefined, wethBalance: undefined }
				}
			} catch (error) {
				if (!isCurrent()) return
				walletBootstrapComplete.value = true
				errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
			}
		})
	}

	const connectWallet = async () => {
		const backend = getActiveBackend()
		if (!backend.hasWallet()) {
			errorMessage.value = 'No wallet detected. Read-only mode is available until a wallet is installed.'
			return
		}
		if (isConnectingWallet.value) return

		try {
			isConnectingWallet.value = true
			errorMessage.value = undefined
			await backend.requestAccounts()
			await refreshState()
		} catch (error) {
			errorMessage.value = getErrorMessage(error, 'Wallet connection failed')
		} finally {
			isConnectingWallet.value = false
		}
	}

	useEffect(() => {
		void refreshState()
	}, [])

	useEffect(() => {
		const backend = getActiveBackend()
		if (backend.waitUntilReady === undefined || backend.isBootstrapped === true) {
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = true
			environmentBootstrapError.value = undefined
			return
		}

		environmentBootstrapLabel.value = backend.bootstrapLabel
		environmentBootstrapProgress.value = backend.bootstrapProgress
		environmentReady.value = false
		environmentBootstrapError.value = undefined
		let cancelled = false
		void environmentReadyLoad.track(async () => {
			try {
				await backend.waitUntilReady?.()
				if (cancelled) return
				environmentBootstrapLabel.value = backend.bootstrapLabel
				environmentBootstrapProgress.value = backend.bootstrapProgress
				environmentReady.value = true
				environmentBootstrapError.value = undefined
				await refreshState()
			} catch (error) {
				if (cancelled) return
				environmentBootstrapError.value = getErrorMessage(error, 'Failed to bootstrap simulation environment')
			}
		})

		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		const backend = getActiveBackend()
		const unsubscribeState = backend.subscribe?.(() => {
			environmentBootstrapError.value = backend.bootstrapError
			environmentBootstrapLabel.value = backend.bootstrapLabel
			environmentBootstrapProgress.value = backend.bootstrapProgress
			environmentReady.value = backend.isBootstrapped ?? true
		})
		const handleWalletChange = () => {
			void refreshState()
		}
		const unsubscribeAccounts = backend.subscribeAccountsChanged(handleWalletChange)
		const unsubscribeChain = backend.subscribeChainChanged(handleWalletChange)

		return () => {
			unsubscribeChain()
			unsubscribeAccounts()
			unsubscribeState?.()
		}
	}, [])

	return {
		accountState: accountState.value,
		connectWallet,
		deploymentStatuses: deploymentStatuses.value,
		errorMessage: errorMessage.value,
		environmentBootstrapError: environmentBootstrapError.value,
		environmentBootstrapLabel: environmentBootstrapLabel.value,
		environmentBootstrapProgress: environmentBootstrapProgress.value,
		environmentReady: environmentReady.value,
		isBootstrappingEnvironment: environmentReadyLoad.isLoading.value || getActiveBackend().isBootstrapping === true,
		hasInjectedWallet: hasInjectedWallet.value,
		hasLoadedDeploymentStatuses: deploymentStatusesLoaded.value,
		isConnectingWallet: isConnectingWallet.value,
		isLoadingDeploymentStatuses: deploymentStatusLoad.isLoading.value,
		isRefreshing: walletStateLoad.isLoading.value,
		augurPlaceHolderDeployed: augurPlaceHolderDeployed.value,
		refreshState,
		setDeploymentStatuses,
		walletBootstrapComplete: walletBootstrapComplete.value,
	}
}
