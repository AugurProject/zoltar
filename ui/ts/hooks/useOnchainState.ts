import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { getDeploymentSteps, loadDeploymentStatusOracleSnapshot } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, normalizeAccount } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { MAINNET_CHAIN_ID } from '../lib/network.js'
import { useRequestGuard } from '../lib/requestGuard.js'
import type { AccountState } from '../types/app.js'
import type { DeploymentStatus } from '../types/contracts.js'

type RefreshStateOptions = {
	loadWalletState?: boolean
}

async function loadAccountBalances(readClient: ReturnType<typeof createReadClient>, connectedAddress: AccountState['address']) {
	if (connectedAddress === undefined) {
		return {
			ethBalance: undefined,
		}
	}

	const ethBalance = await readClient.getBalance({ address: connectedAddress })

	return {
		ethBalance,
	}
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
	const nextRefresh = useRequestGuard()
	const errorMessage = useSignal<string | undefined>(undefined)
	const setDeploymentStatuses = (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => {
		deploymentStatuses.value = update(deploymentStatuses.value)
	}

	const refreshState = async (options: RefreshStateOptions = {}) => {
		const shouldLoadWalletState = options.loadWalletState ?? true
		const ethereum = getInjectedEthereum()
		const readClient = createReadClient()
		const isCurrent = nextRefresh()
		if (shouldLoadWalletState) {
			walletLoadCount.value += 1
		}
		deploymentStatusLoadCount.value += 1
		try {
			hasInjectedWallet.value = ethereum !== undefined

			const deploymentStatusSnapshot = await loadDeploymentStatusOracleSnapshot(readClient)
			if (!isCurrent()) return
			augurPlaceHolderDeployed.value = deploymentStatusSnapshot.augurPlaceHolderDeployed
			deploymentStatuses.value = deploymentStatusSnapshot.deploymentStatuses
			deploymentStatusesLoaded.value = true

			if (shouldLoadWalletState) {
				const accounts = ethereum === undefined ? [] : await ethereum.request({ method: 'eth_accounts' })
				const connectedAddress = normalizeAccount(accounts[0])
				if (!isCurrent()) return

				accountState.value = {
					address: connectedAddress,
					chainId: accountState.value.chainId,
					ethBalance: connectedAddress === accountState.value.address ? accountState.value.ethBalance : undefined,
				}
				errorMessage.value = undefined

				const pendingWalletTasks: Promise<void>[] = []

				if (ethereum !== undefined) {
					pendingWalletTasks.push(
						ethereum
							.request({ method: 'eth_chainId' })
							.then(chainId => {
								if (!isCurrent()) return
								accountState.value = {
									...accountState.value,
									chainId,
								}
							})
							.catch(error => {
								if (!isCurrent()) return
								errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet network')
							}),
					)
				} else {
					accountState.value = {
						...accountState.value,
						chainId: MAINNET_CHAIN_ID,
					}
				}

				pendingWalletTasks.push(
					loadAccountBalances(readClient, connectedAddress)
						.then(balances => {
							if (!isCurrent()) return
							accountState.value = {
								...accountState.value,
								ethBalance: balances.ethBalance,
							}
						})
						.catch(error => {
							if (!isCurrent()) return
							errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet balances')
						}),
				)

				await Promise.allSettled(pendingWalletTasks)
			}
		} catch (error) {
			if (!isCurrent()) return
			errorMessage.value = getErrorMessage(error, 'Failed to refresh wallet state')
		} finally {
			if (shouldLoadWalletState) {
				walletLoadCount.value = Math.max(0, walletLoadCount.value - 1)
				if (isCurrent()) {
					walletBootstrapComplete.value = true
				}
			}
			deploymentStatusLoadCount.value = Math.max(0, deploymentStatusLoadCount.value - 1)
		}
	}

	const connectWallet = async () => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			errorMessage.value = 'No injected wallet found'
			return
		}

		try {
			errorMessage.value = undefined
			await ethereum.request({ method: 'eth_requestAccounts' })
			await refreshState()
		} catch (error) {
			errorMessage.value = getErrorMessage(error, 'Wallet connection failed')
		}
	}

	useEffect(() => {
		refreshState({ loadWalletState: false })
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
		setDeploymentStatuses,
		walletBootstrapComplete: walletBootstrapComplete.value,
		refreshState,
	}
}
