import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createConnectedReadClient, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { MAINNET_CHAIN_ID } from '../lib/network.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'

type RefreshStateOptions = {
	loadWalletState?: boolean
}

export function useOnchainState() {
	const accountState = useSignal<AccountState>({
		address: undefined,
		chainId: undefined,
		ethBalance: undefined,
	})
	const deploymentStatuses = useSignal<DeploymentStatus[]>(
		getDeploymentSteps().map(step => ({
			...step,
			deployed: false,
		})),
	)
	const hasInjectedWallet = useSignal(getInjectedEthereum() !== undefined)
	const walletLoadCount = useSignal(0)
	const deploymentStatusLoadCount = useSignal(0)
	const deploymentStatusesLoaded = useSignal(false)
	const augurPlaceHolderDeployed = useSignal<boolean | undefined>(undefined)
	const walletBootstrapComplete = useSignal(false)
	const isConnectingWallet = useSignal(false)
	const nextRefresh = useRequestGuard()
	const errorMessage = useSignal<string | undefined>(undefined)
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		deploymentStatuses.value = update(deploymentStatuses.value)
	}

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadWalletState = options.loadWalletState ?? true
		const ethereum = getInjectedEthereum()
		const isCurrent = nextRefresh()
		hasInjectedWallet.value = ethereum !== undefined
		errorMessage.value = undefined

		// Fire deployment status immediately — independent of wallet state
		deploymentStatusLoadCount.value += 1
		loadDeploymentStatusOracleSnapshot(createConnectedReadClient())
			.then(snapshot => {
				if (!isCurrent()) return
				augurPlaceHolderDeployed.value = snapshot.augurPlaceHolderDeployed
				deploymentStatuses.value = snapshot.deploymentStatuses
				deploymentStatusesLoaded.value = true
			})
			.catch(error => {
				if (!isCurrent()) return
				errorMessage.value = getErrorMessage(error, 'Failed to refresh deployment status')
			})
			.finally(() => {
				deploymentStatusLoadCount.value = Math.max(0, deploymentStatusLoadCount.value - 1)
			})

		if (!shouldLoadWalletState) return

		// Resolve connection state — must complete before wallet-specific reads
		walletLoadCount.value += 1
		try {
			console.debug('[useOnchainState] calling eth_accounts')
			const accounts = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' }).catch(() => [])
			console.debug('[useOnchainState] eth_accounts returned', accounts)
			if (!isCurrent()) return
			const connectedAddress = normalizeAccount(accounts[0])
			accountState.value = {
				address: connectedAddress,
				chainId: accountState.value.chainId,
				ethBalance: connectedAddress === accountState.value.address ? accountState.value.ethBalance : undefined,
			}

			if (connectedAddress !== undefined && ethereum !== undefined) {
				const readClient = createConnectedReadClient()
				ethereum
					.request({ method: 'eth_chainId' })
					.then(chainId => {
						if (!isCurrent()) return
						accountState.value = { ...accountState.value, chainId }
					})
					.catch(() => {
						if (!isCurrent()) return
						accountState.value = { ...accountState.value, chainId: MAINNET_CHAIN_ID }
					})
				readClient
					.getBalance({ address: connectedAddress })
					.then(ethBalance => {
						if (!isCurrent()) return
						accountState.value = { ...accountState.value, ethBalance }
					})
					.catch(error => {
						if (!isCurrent()) return
						errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet balances')
					})
			} else {
				accountState.value = { ...accountState.value, chainId: MAINNET_CHAIN_ID }
			}
		} catch (error) {
			if (!isCurrent()) return
			errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
		} finally {
			walletLoadCount.value = Math.max(0, walletLoadCount.value - 1)
			if (isCurrent()) walletBootstrapComplete.value = true
		}
	}

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			errorMessage.value = 'No injected wallet found'
			return
		}
		if (isConnectingWallet.value) return

		try {
			isConnectingWallet.value = true
			errorMessage.value = undefined
			await ethereum.request({ method: 'eth_requestAccounts' })
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
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) return

		const handleWalletChange = () => {
			void refreshState()
		}

		ethereum.on?.('accountsChanged', handleWalletChange)
		ethereum.on?.('chainChanged', handleWalletChange)

		return () => {
			ethereum.removeListener?.('accountsChanged', handleWalletChange)
			ethereum.removeListener?.('chainChanged', handleWalletChange)
		}
	}, [])

	return {
		accountState: accountState.value,
		connectWallet,
		deploymentStatuses: deploymentStatuses.value,
		errorMessage: errorMessage.value,
		hasInjectedWallet: hasInjectedWallet.value,
		hasLoadedDeploymentStatuses: deploymentStatusesLoaded.value,
		isLoadingDeploymentStatuses: deploymentStatusLoadCount.value > 0,
		isRefreshing: walletLoadCount.value > 0,
		augurPlaceHolderDeployed: augurPlaceHolderDeployed.value,
		isConnectingWallet: isConnectingWallet.value,
		setDeploymentStatuses,
		walletBootstrapComplete: walletBootstrapComplete.value,
		refreshState,
	}
}
